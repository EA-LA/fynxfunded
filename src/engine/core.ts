import Decimal from "decimal.js";
import type {
  AccountMetrics, AccountState, CloseReason, Deal, EngineEvent, InstrumentSpec, OrderRequest, PendingOrder, Position, Quote, QuoteBook, RuleSet, Side, TargetReport,
} from "./types";
import { EngineError } from "./types";
import { formatUtc, isMarketOpen, marketState } from "./hours";

/**
 * FYNX trading engine core: pure, deterministic functions. Every function takes
 * the current state and returns a new state plus events; nothing is mutated and
 * nothing reads the clock. A host (Cloud Function, FYNX API worker) supplies
 * quotes, the time and ids, stores the state, and publishes the events.
 *
 * Money is computed with decimal.js and rounded to cents.
 */

export interface EngineContext {
  specs: Record<string, InstrumentSpec | undefined>;
  quotes: QuoteBook;
  rules: RuleSet;
  now: number;
  /** Quotes older than this are refused for execution. */
  maxQuoteAgeMs: number;
  newId: (prefix: string) => string;
}

export interface Step {
  state: AccountState;
  events: EngineEvent[];
}

const cash = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export function spec(ctx: Pick<EngineContext, "specs">, symbol: string): InstrumentSpec {
  const s = ctx.specs[symbol];
  if (!s) throw new EngineError("unknown_symbol", `${symbol} is not available on this account.`);
  return s;
}

/** A quote that is fresh, consistent and usable for execution. */
export function executableQuote(ctx: Pick<EngineContext, "quotes" | "now" | "maxQuoteAgeMs">, symbol: string): Quote {
  const q = ctx.quotes[symbol];
  if (!q || q.symbol !== symbol) throw new EngineError("no_quote", `No price for ${symbol} right now.`);
  if (!Number.isFinite(q.bid) || !Number.isFinite(q.ask) || q.bid <= 0 || q.ask < q.bid) throw new EngineError("bad_quote", `The ${symbol} price is not valid.`);
  if (q.time > ctx.now + 1000 || ctx.now - q.time > ctx.maxQuoteAgeMs) throw new EngineError("stale_quote", `The ${symbol} price is out of date.`);
  return q;
}

/** Refuses trading actions while the instrument's market is closed (weekend, holiday, outside its hours). */
export function assertMarketOpen(s: InstrumentSpec, now: number) {
  if (isMarketOpen(s.hours, now)) return;
  const st = marketState(s.hours, now);
  throw new EngineError("market_closed", `The ${s.symbol} market is closed${st.reason && st.reason !== "Outside trading hours" ? ` (${st.reason})` : ""}${st.nextChange ? `; it opens ${formatUtc(st.nextChange)}` : ""}. Nothing was sent.`);
}

const mid = (q: Quote) => (q.bid + q.ask) / 2;

/** How many US dollars one unit of `currency` is worth, from the quote book. */
export function usdPerUnit(quotes: QuoteBook, currency: string): number {
  if (currency === "USD") return 1;
  const direct = quotes[`${currency}USD`];
  if (direct) return mid(direct);
  const inverse = quotes[`USD${currency}`];
  if (inverse) return 1 / mid(inverse);
  throw new EngineError("no_conversion", `No ${currency}/USD price to convert profit into dollars.`);
}

/** Closing price for a position: buys close at the bid, sells at the ask. */
export const closingPrice = (side: Side, q: Quote) => (side === "buy" ? q.bid : q.ask);
/** Opening price for a market order: buys at the ask, sells at the bid. */
export const openingPrice = (side: Side, q: Quote) => (side === "buy" ? q.ask : q.bid);

export function profitUsd(s: InstrumentSpec, side: Side, lots: number, entry: number, exit: number, quotes: QuoteBook): number {
  const quoteCcy = new Decimal(exit).minus(entry).times(side === "buy" ? 1 : -1).times(s.contractSize).times(lots);
  return cash(quoteCcy.times(usdPerUnit(quotes, s.quote)));
}

export function marginUsd(s: InstrumentSpec, lots: number, quotes: QuoteBook): number {
  return cash(new Decimal(lots).times(s.contractSize).times(usdPerUnit(quotes, s.base)).div(s.leverage));
}

const commission = (s: InstrumentSpec, lots: number) => cash(new Decimal(lots).times(s.commissionPerLotPerSide));

export function tradingDayKey(now: number, resetHourUtc: number): string {
  return new Date(now - resetHourUtc * 3_600_000).toISOString().slice(0, 10);
}

export function metrics(state: AccountState, ctx: Pick<EngineContext, "specs" | "quotes" | "rules">): AccountMetrics {
  let floating = new Decimal(0), margin = new Decimal(0);
  for (const p of state.positions) {
    const s = spec(ctx, p.symbol), q = ctx.quotes[p.symbol];
    if (q) floating = floating.plus(profitUsd(s, p.side, p.lots, p.entryPrice, closingPrice(p.side, q), ctx.quotes));
    floating = floating.plus(p.swap ?? 0);
    margin = margin.plus(marginUsd(s, p.lots, ctx.quotes));
  }
  const equity = cash(new Decimal(state.balance).plus(floating));
  const { rules } = ctx;
  const dailyLossFloor = cash(new Decimal(state.dayStartBalance).times(new Decimal(1).minus(new Decimal(rules.dailyLossPercent).div(100))));
  const maxLossFloor = cash(new Decimal(rules.startingBalance).times(new Decimal(1).minus(new Decimal(rules.maxLossPercent).div(100))));
  const m = cash(margin);
  return {
    balance: state.balance,
    equity,
    floatingProfit: cash(floating),
    margin: m,
    freeMargin: cash(new Decimal(equity).minus(m)),
    marginLevel: m > 0 ? cash(new Decimal(equity).div(m).times(100)) : null,
    dailyLossFloor,
    maxLossFloor,
    roomToFloor: cash(new Decimal(equity).minus(Math.max(dailyLossFloor, maxLossFloor))),
    profitTargetBalance: rules.profitTargetPercent === null ? null : cash(new Decimal(rules.startingBalance).times(new Decimal(1).plus(new Decimal(rules.profitTargetPercent).div(100)))),
  };
}

function checkLots(s: InstrumentSpec, lots: number) {
  if (!Number.isFinite(lots) || lots < s.minLots || lots > s.maxLots) throw new EngineError("bad_volume", `Volume must be between ${s.minLots} and ${s.maxLots} lots.`);
  if (!new Decimal(lots).div(s.lotStep).isInteger()) throw new EngineError("bad_volume", `Volume must be in steps of ${s.lotStep} lots.`);
}

function checkPrice(s: InstrumentSpec, value: number | undefined, label: string) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) throw new EngineError("bad_price", `${label} must be a positive price.`);
  if (!new Decimal(value).div(s.tickSize).isInteger()) throw new EngineError("bad_price", `${label} must be in steps of ${s.tickSize}.`);
}

/** Stop loss below / take profit above the reference price for buys (and the reverse for sells). */
function checkProtection(side: Side, reference: number, sl?: number, tp?: number) {
  if (sl !== undefined && (side === "buy" ? sl >= reference : sl <= reference)) throw new EngineError("bad_stop", `Stop loss must be ${side === "buy" ? "below" : "above"} ${reference}.`);
  if (tp !== undefined && (side === "buy" ? tp <= reference : tp >= reference)) throw new EngineError("bad_target", `Take profit must be ${side === "buy" ? "above" : "below"} ${reference}.`);
}

/** Buy limit below the market, buy stop above; the reverse for sells. */
function checkPendingSide(side: Side, type: "limit" | "stop", price: number, market: number) {
  const below = price < market;
  if ((type === "limit") !== (side === "buy" ? below : !below)) throw new EngineError("bad_price", `A ${side} ${type} must be ${(type === "limit") === (side === "buy") ? "below" : "above"} the current price.`);
}

function assertActive(state: AccountState) {
  if (state.status !== "active") throw new EngineError("account_closed", state.status === "breached" ? "This account broke a loss limit; trading is closed." : state.status === "passed" ? "This phase is passed; trading is closed on this account." : "Trading is disabled on this account.");
}

function open(state: AccountState, ctx: EngineContext, req: { symbol: string; side: Side; lots: number; stopLoss?: number; takeProfit?: number; clientId?: string }, price: number): Step {
  const s = spec(ctx, req.symbol);
  const fee = commission(s, req.lots);
  const position: Position = { id: ctx.newId("pos"), symbol: req.symbol, side: req.side, lots: req.lots, entryPrice: price, openedAt: ctx.now, stopLoss: req.stopLoss, takeProfit: req.takeProfit, commission: fee, ...(req.clientId ? { clientId: req.clientId } : {}) };
  const day = tradingDayKey(ctx.now, ctx.rules.resetHourUtc);
  const next: AccountState = {
    ...state,
    balance: cash(new Decimal(state.balance).minus(fee)),
    positions: [...state.positions, position],
    tradingDays: state.tradingDays.includes(day) ? state.tradingDays : [...state.tradingDays, day],
    sequence: state.sequence + 1,
  };
  return { state: next, events: [{ type: "position_opened", position }] };
}

/** Validates and executes an order request. Market orders fill at the current bid/ask. */
export function placeOrder(state: AccountState, req: OrderRequest, ctx: EngineContext): Step {
  assertActive(state);
  if (req.clientId && (state.positions.some(p => p.clientId === req.clientId) || state.orders.some(o => o.clientId === req.clientId) || state.history.some(d => d.clientId === req.clientId))) {
    return { state, events: [] }; // idempotent replay
  }
  const s = spec(ctx, req.symbol);
  assertMarketOpen(s, ctx.now);
  checkLots(s, req.lots);
  checkPrice(s, req.stopLoss, "Stop loss");
  checkPrice(s, req.takeProfit, "Take profit");
  const q = executableQuote(ctx, req.symbol);
  const m = metrics(state, ctx);
  const required = marginUsd(s, req.lots, ctx.quotes);
  if (required > m.freeMargin) throw new EngineError("no_margin", `Not enough free margin: this order needs ${required.toFixed(2)} USD.`);
  if (req.type === "market") {
    const price = openingPrice(req.side, q);
    checkProtection(req.side, price, req.stopLoss, req.takeProfit);
    return open(state, ctx, req, price);
  }
  checkPrice(s, req.price, "Order price");
  if (req.price === undefined) throw new EngineError("bad_price", "Pending orders need a price.");
  checkPendingSide(req.side, req.type, req.price, openingPrice(req.side, q));
  checkProtection(req.side, req.price, req.stopLoss, req.takeProfit);
  const order: PendingOrder = { id: ctx.newId("ord"), symbol: req.symbol, side: req.side, type: req.type, lots: req.lots, price: req.price, stopLoss: req.stopLoss, takeProfit: req.takeProfit, createdAt: ctx.now, ...(req.clientId ? { clientId: req.clientId } : {}) };
  return { state: { ...state, orders: [...state.orders, order], sequence: state.sequence + 1 }, events: [{ type: "order_placed", order }] };
}

function closeAt(state: AccountState, ctx: Pick<EngineContext, "specs" | "quotes" | "now">, positionId: string, lots: number, price: number, reason: CloseReason): Step {
  const p = state.positions.find(x => x.id === positionId);
  if (!p) throw new EngineError("no_position", "That position is not open.");
  const s = spec(ctx, p.symbol);
  if (!(lots > 0) || lots > p.lots || !new Decimal(lots).div(s.lotStep).isInteger()) throw new EngineError("bad_volume", `Close between ${s.lotStep} and ${p.lots} lots.`);
  const gross = profitUsd(s, p.side, lots, p.entryPrice, price, ctx.quotes);
  const fee = commission(s, lots);
  const openFee = cash(new Decimal(p.commission).times(lots).div(p.lots));
  const swap = p.swap ? cash(new Decimal(p.swap).times(lots).div(p.lots)) : 0;
  const deal: Deal = { id: `${p.id}:${state.history.length + 1}`, positionId: p.id, symbol: p.symbol, side: p.side, lots, entryPrice: p.entryPrice, exitPrice: price, openedAt: p.openedAt, closedAt: ctx.now, grossProfit: gross, commission: cash(new Decimal(fee).plus(openFee)), ...(swap ? { swap } : {}), netProfit: cash(new Decimal(gross).minus(fee).minus(openFee).plus(swap)), reason, ...(p.clientId ? { clientId: p.clientId } : {}) };
  const remaining = new Decimal(p.lots).minus(lots).toNumber();
  const positions = remaining > 0 ? state.positions.map(x => (x.id === p.id ? { ...x, lots: remaining, commission: cash(new Decimal(x.commission).minus(openFee)), ...(x.swap ? { swap: cash(new Decimal(x.swap).minus(swap)) } : {}) } : x)) : state.positions.filter(x => x.id !== p.id);
  return { state: { ...state, balance: cash(new Decimal(state.balance).plus(gross).minus(fee).plus(swap)), positions, history: [...state.history, deal], sequence: state.sequence + 1 }, events: [{ type: "position_closed", deal }] };
}

/** Closes all or part of a position at the current market price. */
export function closePosition(state: AccountState, positionId: string, lots: number | undefined, ctx: EngineContext): Step {
  const p = state.positions.find(x => x.id === positionId);
  if (!p) throw new EngineError("no_position", "That position is not open.");
  assertMarketOpen(spec(ctx, p.symbol), ctx.now);
  const q = executableQuote(ctx, p.symbol);
  return closeAt(state, ctx, positionId, lots ?? p.lots, closingPrice(p.side, q), "manual");
}

export function modifyPosition(state: AccountState, positionId: string, protection: { stopLoss?: number | null; takeProfit?: number | null }, ctx: EngineContext): Step {
  assertActive(state);
  const p = state.positions.find(x => x.id === positionId);
  if (!p) throw new EngineError("no_position", "That position is not open.");
  const s = spec(ctx, p.symbol);
  assertMarketOpen(s, ctx.now);
  const sl = protection.stopLoss === null ? undefined : protection.stopLoss ?? p.stopLoss;
  const tp = protection.takeProfit === null ? undefined : protection.takeProfit ?? p.takeProfit;
  checkPrice(s, sl, "Stop loss"); checkPrice(s, tp, "Take profit");
  checkProtection(p.side, closingPrice(p.side, executableQuote(ctx, p.symbol)), sl, tp);
  return { state: { ...state, positions: state.positions.map(x => (x.id === p.id ? { ...x, stopLoss: sl, takeProfit: tp } : x)), sequence: state.sequence + 1 }, events: [{ type: "position_modified", positionId }] };
}

export interface OrderChange {
  /** New trigger price of the pending order. */
  price?: number;
  /** A number sets the level, null removes it, leaving it out keeps it. */
  stopLoss?: number | null;
  takeProfit?: number | null;
}

/**
 * Changes the price, stop loss or take profit of a pending order. The same
 * checks as a new order apply: the price must still be on the right side of
 * the market for its type, and stop loss / take profit on the right side of
 * the (new) order price. Volume, side and type cannot change; cancel and place
 * a new order for that.
 */
export function modifyOrder(state: AccountState, orderId: string, change: OrderChange, ctx: EngineContext): Step {
  assertActive(state);
  const o = state.orders.find(x => x.id === orderId);
  if (!o) throw new EngineError("no_order", "That order is not pending.");
  const s = spec(ctx, o.symbol);
  assertMarketOpen(s, ctx.now);
  const price = change.price ?? o.price;
  const sl = change.stopLoss === null ? undefined : change.stopLoss ?? o.stopLoss;
  const tp = change.takeProfit === null ? undefined : change.takeProfit ?? o.takeProfit;
  checkPrice(s, price, "Order price"); checkPrice(s, sl, "Stop loss"); checkPrice(s, tp, "Take profit");
  if (change.price !== undefined) checkPendingSide(o.side, o.type, price, openingPrice(o.side, executableQuote(ctx, o.symbol)));
  checkProtection(o.side, price, sl, tp);
  if (price === o.price && sl === o.stopLoss && tp === o.takeProfit) return { state, events: [] };
  const next: PendingOrder = { ...o, price, stopLoss: sl, takeProfit: tp };
  return { state: { ...state, orders: state.orders.map(x => (x.id === o.id ? next : x)), sequence: state.sequence + 1 }, events: [{ type: "order_modified", order: next }] };
}

export function cancelOrder(state: AccountState, orderId: string): Step {
  if (!state.orders.some(o => o.id === orderId)) throw new EngineError("no_order", "That order is not pending.");
  return { state: { ...state, orders: state.orders.filter(o => o.id !== orderId), sequence: state.sequence + 1 }, events: [{ type: "order_cancelled", orderId }] };
}

/**
 * Runs on every price update and on a timer: rolls the trading day, fills
 * pending orders, closes positions at stop loss / take profit, enforces the
 * daily and maximum loss limits (closing everything on a breach) and marks a
 * reached profit target once the minimum trading days are met.
 */
export function tick(state: AccountState, ctx: EngineContext): Step {
  let current = state;
  const events: EngineEvent[] = [];
  const apply = (step: Step) => { current = step.state; events.push(...step.events); };
  const day = tradingDayKey(ctx.now, ctx.rules.resetHourUtc);
  if (day !== current.tradingDay) {
    const swaps = applySwaps(current, ctx, day);
    current = { ...swaps.state, tradingDay: day, dayStartBalance: current.balance, sequence: current.sequence + 1 };
    events.push(...swaps.events, { type: "day_reset", tradingDay: day, dayStartBalance: current.balance });
  }
  if (current.status !== "active") return { state: current, events };
  // Closed markets do not fill or stop out. When they reopen, the first fresh
  // price decides: a stop or stop order beyond a weekend gap fills at that
  // price (not at the level), a limit fills at its price or better.
  const tradable = (symbol: string) => { const s = ctx.specs[symbol]; return !s || isMarketOpen(s.hours, ctx.now); };

  for (const o of current.orders) {
    const q = ctx.quotes[o.symbol];
    if (!q || ctx.now - q.time > ctx.maxQuoteAgeMs || !tradable(o.symbol)) continue;
    const market = openingPrice(o.side, q);
    const hit = o.type === "limit" ? (o.side === "buy" ? market <= o.price : market >= o.price) : (o.side === "buy" ? market >= o.price : market <= o.price);
    if (!hit) continue;
    current = { ...current, orders: current.orders.filter(x => x.id !== o.id) };
    // Limits fill at their price or better; stops fill at the market (slippage is real).
    const price = o.type === "limit" ? (o.side === "buy" ? Math.min(o.price, market) : Math.max(o.price, market)) : market;
    const step = open(current, ctx, o, price);
    apply(step);
    const opened = step.events[0];
    if (opened.type === "position_opened") events.push({ type: "order_triggered", orderId: o.id, positionId: opened.position.id });
  }

  for (const p of current.positions) {
    const q = ctx.quotes[p.symbol];
    if (!q || ctx.now - q.time > ctx.maxQuoteAgeMs || !tradable(p.symbol)) continue;
    const price = closingPrice(p.side, q);
    const stopHit = p.stopLoss !== undefined && (p.side === "buy" ? price <= p.stopLoss : price >= p.stopLoss);
    const targetHit = p.takeProfit !== undefined && (p.side === "buy" ? price >= p.takeProfit : price <= p.takeProfit);
    if (stopHit) apply(closeAt(current, ctx, p.id, p.lots, price, "stop_loss"));
    else if (targetHit) apply(closeAt(current, ctx, p.id, p.lots, price, "take_profit"));
  }

  // Loss limits are checked on tradable prices only: while an open position's
  // market is closed its last price cannot be dealt on, so the check waits for
  // the first price after the reopen (and closes at that price if breached).
  if (current.positions.some(p => !tradable(p.symbol))) return { state: current, events };
  const m = metrics(current, ctx);
  const breach: CloseReason | null = m.equity <= m.maxLossFloor ? "maximum_loss_limit" : m.equity <= m.dailyLossFloor ? "daily_loss_limit" : null;
  if (breach) {
    for (const p of current.positions) {
      const q = ctx.quotes[p.symbol];
      if (q) apply(closeAt(current, ctx, p.id, p.lots, closingPrice(p.side, q), breach));
    }
    current = { ...current, orders: [], status: "breached", breachReason: breach, sequence: current.sequence + 1 };
    events.push({ type: "account_breached", reason: breach });
    return { state: current, events };
  }

  // Reaching the target is reported once; passing a phase stays an official review (KYC, trade review…).
  if (!current.targetReachedAt && targetReport(current, ctx.rules).ready) {
    current = { ...current, targetReachedAt: ctx.now, sequence: current.sequence + 1 };
    events.push({ type: "target_reached" });
  }
  return { state: current, events };
}

/**
 * Daily resets (rollovers) after the trading day `fromDay` up to and including
 * the one that opened `toDay`, with how many nights of swap each one charges:
 * Saturday/Sunday resets 0, the triple weekday 3, other days 1 (weekday of the
 * reset instant in UTC).
 */
export function rollovers(fromDay: string, toDay: string, resetHourUtc: number, tripleWeekday = 3): { at: number; nights: number }[] {
  const out: { at: number; nights: number }[] = [];
  const start = Date.parse(`${fromDay}T00:00:00Z`), end = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return out;
  for (let d = start + 86_400_000; d <= end; d += 86_400_000) {
    const at = d + resetHourUtc * 3_600_000, wd = new Date(at).getUTCDay();
    out.push({ at, nights: wd === 0 || wd === 6 ? 0 : wd === tripleWeekday ? 3 : 1 });
  }
  return out;
}

/** Charges (or pays) overnight swap on positions held through each reset between the stored trading day and `day`. */
function applySwaps(state: AccountState, ctx: Pick<EngineContext, "specs" | "rules">, day: string): Step {
  const events: EngineEvent[] = [];
  const positions = state.positions.map(p => {
    const s = ctx.specs[p.symbol];
    if (!s?.swap) return p;
    const rate = p.side === "buy" ? s.swap.longPerLot : s.swap.shortPerLot;
    if (!Number.isFinite(rate) || rate === 0) return p;
    let total = new Decimal(0), nights = 0, last = 0;
    for (const r of rollovers(state.tradingDay, day, ctx.rules.resetHourUtc, s.swap.tripleWeekday ?? 3)) {
      if (r.at <= p.openedAt || r.nights === 0) continue;
      total = total.plus(new Decimal(rate).times(p.lots).times(r.nights)); nights += r.nights; last = r.at;
    }
    const amount = cash(total);
    if (!nights || amount === 0) return p;
    events.push({ type: "swap_applied", positionId: p.id, amount, nights, at: last });
    return { ...p, swap: cash(new Decimal(p.swap ?? 0).plus(amount)) };
  });
  return { state: events.length ? { ...state, positions } : state, events };
}

/** Closed results per trading day (22:00 UTC days by default), from the account's deals. */
export function dailyResults(state: Pick<AccountState, "history">, resetHourUtc: number): Record<string, number> {
  const days: Record<string, Decimal> = {};
  for (const d of state.history) {
    const key = tradingDayKey(d.closedAt, resetHourUtc);
    days[key] = (days[key] ?? new Decimal(0)).plus(d.netProfit);
  }
  return Object.fromEntries(Object.entries(days).map(([k, v]) => [k, cash(v)]));
}

/**
 * Where the account stands against its target, minimum days and consistency
 * rule. Same arithmetic as the server rule engine: best day = the largest
 * positive closed day, share = best day ÷ (balance − starting balance).
 */
export function targetReport(state: AccountState, rules: RuleSet): TargetReport {
  const profit = cash(new Decimal(state.balance).minus(rules.startingBalance));
  const targetProfit = rules.profitTargetPercent === null ? null : cash(new Decimal(rules.startingBalance).times(rules.profitTargetPercent).div(100));
  const targetMet = targetProfit !== null && profit >= targetProfit;
  const daysMet = state.tradingDays.length >= rules.minTradingDays;
  let bestDay: TargetReport["bestDay"] = null;
  for (const [day, result] of Object.entries(dailyResults(state, rules.resetHourUtc)).sort(([a], [b]) => a.localeCompare(b))) {
    if (!bestDay || result > bestDay.profit) bestDay = { day, profit: result };
  }
  const best = bestDay && bestDay.profit > 0 ? bestDay.profit : 0;
  const bestDayShare = profit > 0 ? cash(new Decimal(best).div(profit).times(100)) : null;
  const limit = rules.consistencyPercent ?? null;
  const consistencyMet = limit === null || (bestDayShare !== null && new Decimal(best).div(profit).times(100).lte(limit));
  const profitForConsistency = limit === null || limit <= 0 || best <= 0 ? null : cash(new Decimal(best).times(100).div(limit).toDecimalPlaces(2, Decimal.ROUND_UP));
  const missing: string[] = [];
  if (state.status === "breached") missing.push("A loss limit was broken; this account cannot pass.");
  if (targetProfit === null) missing.push("Funded accounts have no profit target.");
  else if (!targetMet) missing.push(`${cash(new Decimal(targetProfit).minus(profit)).toFixed(2)} USD more closed profit for the target.`);
  if (!daysMet) missing.push(`${rules.minTradingDays - state.tradingDays.length} more trading day${rules.minTradingDays - state.tradingDays.length === 1 ? "" : "s"}.`);
  if (!consistencyMet && limit !== null) missing.push(profit > 0 && profitForConsistency !== null
    ? `Best day is ${bestDayShare}% of the profit (limit ${limit}%): total profit needs to reach ${profitForConsistency.toFixed(2)} USD.`
    : `Total profit must be positive for the ${limit}% best-day rule.`);
  if (state.positions.length) missing.push(`Close ${state.positions.length} open position${state.positions.length === 1 ? "" : "s"}.`);
  return {
    profit, targetProfit, profitToGo: targetProfit === null ? null : Math.max(0, cash(new Decimal(targetProfit).minus(profit))), targetMet,
    tradingDays: state.tradingDays.length, minTradingDays: rules.minTradingDays, daysMet,
    bestDay, bestDayShare, consistencyLimit: limit, consistencyMet, profitForConsistency,
    openPositions: state.positions.length,
    ready: state.status !== "breached" && targetMet && daysMet && consistencyMet && state.positions.length === 0,
    missing,
  };
}

export function newAccount(accountId: string, rules: RuleSet, now: number): AccountState {
  return { accountId, currency: "USD", status: "active", balance: rules.startingBalance, dayStartBalance: rules.startingBalance, tradingDay: tradingDayKey(now, rules.resetHourUtc), tradingDays: [], positions: [], orders: [], history: [], sequence: 0 };
}


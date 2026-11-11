import Decimal from "decimal.js";
import type {
  AccountMetrics, AccountState, AlertRequest, CloseReason, Deal, EngineEvent, EntryRisk, ExpiredOrder, InstrumentSpec, OcoCancelledOrder, OrderRequest, PendingOrder, Position, NoticeKind, NoticePrefs, PriceAlert, Quote, QuoteBook, RuleSet, Side, TargetReport, TriggeredAlert,
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

/**
 * Dollars the stop loss puts at risk from the fill price (before costs), with
 * the balance the trade opens on. null without a stop loss, when the stop is
 * not on the losing side of the fill, or when no conversion price exists.
 */
export function entryRiskFor(s: InstrumentSpec, side: Side, lots: number, price: number, stopLoss: number | undefined, takeProfit: number | undefined, balance: number, quotes: QuoteBook): EntryRisk | null {
  if (stopLoss === undefined || !(balance > 0)) return null;
  let loss: number;
  try { loss = profitUsd(s, side, lots, price, stopLoss, quotes); } catch { return null; }
  if (!(loss < 0)) return null;
  return { stopLoss, ...(takeProfit !== undefined ? { takeProfit } : {}), amount: -loss, balance };
}

/** Entry risk for `part` of `whole` lots; null if it rounds to nothing (a sliver of a lot). */
const scaleRisk = (r: EntryRisk, part: number, whole: number): EntryRisk | null => {
  const amount = cash(new Decimal(r.amount).times(part).div(whole));
  return amount > 0 ? { ...r, amount } : null;
};

function open(state: AccountState, ctx: EngineContext, req: { symbol: string; side: Side; lots: number; stopLoss?: number; takeProfit?: number; trailingPips?: number; clientId?: string }, price: number): Step {
  const s = spec(ctx, req.symbol);
  const fee = commission(s, req.lots);
  const risk = entryRiskFor(s, req.side, req.lots, price, req.stopLoss, req.takeProfit, state.balance, ctx.quotes);
  const position: Position = { id: ctx.newId("pos"), symbol: req.symbol, side: req.side, lots: req.lots, entryPrice: price, openedAt: ctx.now, stopLoss: req.stopLoss, takeProfit: req.takeProfit, commission: fee, ...(req.trailingPips !== undefined ? { trailingStop: { pips: req.trailingPips } } : {}), ...(req.clientId ? { clientId: req.clientId } : {}), ...(risk ? { entryRisk: risk } : {}) };
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

/** Newest OCO-cancelled orders kept on the account for the terminal. */
export const OCO_CANCELLED_KEPT = 20;

/** The partner of a new OCO link must be pending, not the order itself and not linked with a third order. */
function checkOcoPartner(state: AccountState, partnerId: string, selfId: string | undefined) {
  if (typeof partnerId !== "string" || !partnerId) throw new EngineError("bad_oco", "Choose the pending order to link with.");
  if (partnerId === selfId) throw new EngineError("bad_oco", "An order cannot be linked with itself.");
  const partner = state.orders.find(o => o.id === partnerId);
  if (!partner) throw new EngineError("bad_oco", "The order to link with is no longer pending.");
  if (partner.ocoWith !== undefined && partner.ocoWith !== selfId) throw new EngineError("bad_oco", `Order ${partner.id} is already linked with order ${partner.ocoWith}. Unlink it first.`);
}

/** Removes the OCO link that points at any of `ids` from the remaining orders (their partner left without filling). */
function unlinkPartners(orders: PendingOrder[], ids: Set<string>): { orders: PendingOrder[]; changed: PendingOrder[] } {
  const changed: PendingOrder[] = [];
  const next = orders.map(o => {
    if (o.ocoWith === undefined || !ids.has(o.ocoWith)) return o;
    const { ocoWith: _gone, ...rest } = o;
    changed.push(rest);
    return rest;
  });
  return { orders: next, changed };
}

/** Validates and executes an order request. Market orders fill at the current bid/ask. */
export function placeOrder(state: AccountState, req: OrderRequest, ctx: EngineContext): Step {
  assertActive(state);
  if (req.clientId && (state.positions.some(p => p.clientId === req.clientId) || state.orders.some(o => o.clientId === req.clientId) || state.history.some(d => d.clientId === req.clientId) || !!state.archived?.clientIds.includes(req.clientId))) {
    return { state, events: [] }; // idempotent replay
  }
  const s = spec(ctx, req.symbol);
  assertMarketOpen(s, ctx.now);
  checkLots(s, req.lots);
  checkPrice(s, req.stopLoss, "Stop loss");
  checkPrice(s, req.takeProfit, "Take profit");
  checkTrailing(req.trailingPips);
  if (req.expiresAt !== undefined && req.type === "market") throw new EngineError("bad_expiry", "Only pending orders can have an expiry time.");
  checkExpiry(req.expiresAt, ctx.now);
  checkDeviation(s, req);
  if (req.ocoWith !== undefined) {
    if (req.type === "market") throw new EngineError("bad_oco", "Only pending orders can be linked (one cancels the other).");
    checkOcoPartner(state, req.ocoWith, undefined);
  }
  const q = executableQuote(ctx, req.symbol);
  const m = metrics(state, ctx);
  const required = marginUsd(s, req.lots, ctx.quotes);
  if (required > m.freeMargin) throw new EngineError("no_margin", `Not enough free margin: this order needs ${required.toFixed(2)} USD.`);
  if (req.type === "market") {
    const price = openingPrice(req.side, q);
    if (req.expectedPrice !== undefined && req.maxDeviationPips !== undefined) {
      const moved = adverseMovePips(s, req.side, req.expectedPrice, price);
      if (moved > req.maxDeviationPips) throw new EngineError("price_moved", `The ${req.symbol} price moved ${moved.toFixed(1)} pips against you (from ${req.expectedPrice.toFixed(s.digits)} to ${price.toFixed(s.digits)}), ${req.maxDeviationPips === 0 ? "and you allowed no move against you" : `more than the ${req.maxDeviationPips.toFixed(1)} pips you allowed`}. Nothing was opened.`);
    }
    checkProtection(req.side, price, req.stopLoss, req.takeProfit);
    return open(state, ctx, req, price);
  }
  checkPrice(s, req.price, "Order price");
  if (req.price === undefined) throw new EngineError("bad_price", "Pending orders need a price.");
  checkPendingSide(req.side, req.type, req.price, openingPrice(req.side, q));
  checkProtection(req.side, req.price, req.stopLoss, req.takeProfit);
  const order: PendingOrder = { id: ctx.newId("ord"), symbol: req.symbol, side: req.side, type: req.type, lots: req.lots, price: req.price, stopLoss: req.stopLoss, takeProfit: req.takeProfit, ...(req.trailingPips !== undefined ? { trailingPips: req.trailingPips } : {}), ...(req.expiresAt !== undefined ? { expiresAt: req.expiresAt } : {}), ...(req.ocoWith !== undefined ? { ocoWith: req.ocoWith } : {}), createdAt: ctx.now, ...(req.clientId ? { clientId: req.clientId } : {}) };
  if (req.ocoWith === undefined) return { state: { ...state, orders: [...state.orders, order], sequence: state.sequence + 1 }, events: [{ type: "order_placed", order }] };
  const partner: PendingOrder = { ...state.orders.find(o => o.id === req.ocoWith)!, ocoWith: order.id };
  return { state: { ...state, orders: [...state.orders.map(o => (o.id === partner.id ? partner : o)), order], sequence: state.sequence + 1 }, events: [{ type: "order_placed", order }, { type: "order_modified", order: partner }] };
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
  const dealRisk = p.entryRisk ? (lots === p.lots ? p.entryRisk : scaleRisk(p.entryRisk, lots, p.lots)) : null;
  const deal: Deal = { id: `${p.id}:${(state.archived?.deals ?? 0) + state.history.length + 1}`, positionId: p.id, symbol: p.symbol, side: p.side, lots, entryPrice: p.entryPrice, exitPrice: price, openedAt: p.openedAt, closedAt: ctx.now, grossProfit: gross, commission: cash(new Decimal(fee).plus(openFee)), ...(swap ? { swap } : {}), netProfit: cash(new Decimal(gross).minus(fee).minus(openFee).plus(swap)), reason, ...(p.clientId ? { clientId: p.clientId } : {}), ...(dealRisk ? { entryRisk: dealRisk } : {}) };
  const remaining = new Decimal(p.lots).minus(lots).toNumber();
  // The lots left keep the rest of the entry risk (or lose it if nothing meaningful is left).
  const rest = p.entryRisk && remaining > 0 ? scaleRisk(p.entryRisk, remaining, p.lots) : null;
  const keptRisk = { entryRisk: rest ?? undefined };
  const positions = remaining > 0 ? state.positions.map(x => (x.id === p.id ? { ...x, lots: remaining, commission: cash(new Decimal(x.commission).minus(openFee)), ...(x.swap ? { swap: cash(new Decimal(x.swap).minus(swap)) } : {}), ...keptRisk } : x)) : state.positions.filter(x => x.id !== p.id);
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

/** Earliest and latest expiry the engine accepts for a pending order, counted from now. */
export const EXPIRY_MIN_MS = 60_000;
export const EXPIRY_MAX_MS = 366 * 86_400_000;
/** How many expired orders the account keeps for the terminal (newest first). */
export const EXPIRED_ORDERS_KEPT = 20;

function checkExpiry(at: number | undefined, now: number) {
  if (at === undefined) return;
  if (!Number.isInteger(at)) throw new EngineError("bad_expiry", "The expiry must be a time in whole milliseconds.");
  if (at < now + EXPIRY_MIN_MS) throw new EngineError("bad_expiry", "The expiry must be at least one minute from now.");
  if (at > now + EXPIRY_MAX_MS) throw new EngineError("bad_expiry", "The expiry can be at most 366 days from now.");
}

/**
 * End of the trading day that contains `now`: the next daily reset
 * (resetHourUtc, 22:00 UTC on FYNX accounts), strictly after `now`. This is
 * the "Today" expiry of a pending order.
 */
export function tradingDayEnd(now: number, resetHourUtc: number): number {
  const shifted = now - resetHourUtc * 3_600_000;
  return Math.floor(shifted / 86_400_000) * 86_400_000 + 86_400_000 + resetHourUtc * 3_600_000;
}

/** Shortest and longest trailing-stop distance the engine accepts, in pips. */
export const TRAILING_MIN_PIPS = 5;
export const TRAILING_MAX_PIPS = 5000;

/**
 * A change to an open position. A number sets the level (trailing distance in
 * pips), null removes it, leaving a field out keeps it.
 */
export interface PositionChange {
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Trailing stop distance in pips; null switches the trailing stop off. */
  trailingPips?: number | null;
}

function checkTrailing(pips: number | undefined) {
  if (pips === undefined) return;
  if (!Number.isFinite(pips) || pips < TRAILING_MIN_PIPS || pips > TRAILING_MAX_PIPS) throw new EngineError("bad_trailing", `Trailing stop must be between ${TRAILING_MIN_PIPS} and ${TRAILING_MAX_PIPS} pips.`);
  if (!new Decimal(pips).times(10).isInteger()) throw new EngineError("bad_trailing", "Trailing stop goes in steps of 0.1 pips.");
}

/** Largest price protection ("maximum deviation") a market order can carry, in pips. */
export const DEVIATION_MAX_PIPS = 500;

function checkDeviation(s: InstrumentSpec, req: OrderRequest) {
  const hasExpected = req.expectedPrice !== undefined, hasMax = req.maxDeviationPips !== undefined;
  if (!hasExpected && !hasMax) return;
  if (req.type !== "market") throw new EngineError("bad_deviation", "Price protection is for market orders only; a limit or stop order already fills at its own price.");
  if (!hasExpected || !hasMax) throw new EngineError("bad_deviation", "Price protection needs both the price you saw and the largest move you accept.");
  const pips = req.maxDeviationPips!;
  if (!Number.isFinite(pips) || pips < 0 || pips > DEVIATION_MAX_PIPS) throw new EngineError("bad_deviation", `Price protection must be between 0 and ${DEVIATION_MAX_PIPS} pips.`);
  if (!new Decimal(pips).times(10).isInteger()) throw new EngineError("bad_deviation", "Price protection goes in steps of 0.1 pips.");
  checkPrice(s, req.expectedPrice, "Expected price");
}

/**
 * How many pips the fill is worse than the price the trader saw (0 when it is
 * the same or better). Buys are worse when the fill is higher, sells when lower.
 */
export function adverseMovePips(s: Pick<InstrumentSpec, "pipSize">, side: Side, expected: number, fill: number): number {
  const diff = side === "buy" ? new Decimal(fill).minus(expected) : new Decimal(expected).minus(fill);
  return diff.lte(0) ? 0 : diff.div(s.pipSize).toDecimalPlaces(1, Decimal.ROUND_UP).toNumber();
}

export function modifyPosition(state: AccountState, positionId: string, protection: PositionChange, ctx: EngineContext): Step {
  assertActive(state);
  const p = state.positions.find(x => x.id === positionId);
  if (!p) throw new EngineError("no_position", "That position is not open.");
  const s = spec(ctx, p.symbol);
  assertMarketOpen(s, ctx.now);
  const sl = protection.stopLoss === null ? undefined : protection.stopLoss ?? p.stopLoss;
  const tp = protection.takeProfit === null ? undefined : protection.takeProfit ?? p.takeProfit;
  const trail = protection.trailingPips === null ? undefined : protection.trailingPips ?? p.trailingStop?.pips;
  checkPrice(s, sl, "Stop loss"); checkPrice(s, tp, "Take profit"); checkTrailing(trail);
  checkProtection(p.side, closingPrice(p.side, executableQuote(ctx, p.symbol)), sl, tp);
  if (sl === p.stopLoss && tp === p.takeProfit && trail === p.trailingStop?.pips) return { state, events: [] };
  const next = (x: Position): Position => {
    const { trailingStop: _old, ...rest } = x;
    return { ...rest, stopLoss: sl, takeProfit: tp, ...(trail !== undefined ? { trailingStop: { pips: trail } } : {}) };
  };
  return { state: { ...state, positions: state.positions.map(x => (x.id === p.id ? next(x) : x)), sequence: state.sequence + 1 }, events: [{ type: "position_modified", positionId }] };
}

/**
 * Where a trailing stop would put the stop loss at `closing`, or null while it
 * has not started (price not yet `pips` beyond the entry) or would not improve
 * the current stop by at least one pip. Buys round down and sells round up to
 * the tick, so the stop is never closer to the price than the distance.
 */
export function trailedStop(s: Pick<InstrumentSpec, "pipSize" | "tickSize">, p: Pick<Position, "side" | "entryPrice" | "stopLoss" | "trailingStop">, closing: number): number | null {
  if (!p.trailingStop) return null;
  const dist = new Decimal(p.trailingStop.pips).times(s.pipSize);
  const raw = p.side === "buy" ? new Decimal(closing).minus(dist) : new Decimal(closing).plus(dist);
  const ticks = raw.div(s.tickSize);
  const level = (p.side === "buy" ? ticks.floor() : ticks.ceil()).times(s.tickSize).toNumber();
  if (p.side === "buy" ? level < p.entryPrice : level > p.entryPrice) return null;
  if (p.stopLoss !== undefined && new Decimal(level).minus(p.stopLoss).times(p.side === "buy" ? 1 : -1).lt(s.pipSize)) return null;
  return level;
}

export interface OrderChange {
  /** New trigger price of the pending order. */
  price?: number;
  /** A number sets the level, null removes it, leaving it out keeps it. */
  stopLoss?: number | null;
  takeProfit?: number | null;
  /**
   * Trailing stop distance in pips the position gets when the order fills;
   * null removes it, leaving it out keeps it.
   */
  trailingPips?: number | null;
  /** Expiry time (ms since epoch); null makes the order good till cancelled, leaving it out keeps it. */
  expiresAt?: number | null;
  /**
   * "One cancels the other": the id of another pending order to link with,
   * null to unlink (both orders), leaving it out keeps the link. Linking to a
   * new order unlinks the previous partner.
   */
  ocoWith?: string | null;
}

/**
 * Changes the price, stop loss, take profit or trailing distance of a pending order. The same
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
  const trail = change.trailingPips === null ? undefined : change.trailingPips ?? o.trailingPips;
  const expires = change.expiresAt === null ? undefined : change.expiresAt ?? o.expiresAt;
  checkPrice(s, price, "Order price"); checkPrice(s, sl, "Stop loss"); checkPrice(s, tp, "Take profit"); checkTrailing(trail);
  if (change.expiresAt != null && change.expiresAt !== o.expiresAt) checkExpiry(change.expiresAt, ctx.now);
  if (change.price !== undefined) checkPendingSide(o.side, o.type, price, openingPrice(o.side, executableQuote(ctx, o.symbol)));
  checkProtection(o.side, price, sl, tp);
  const oco = change.ocoWith === null ? undefined : change.ocoWith ?? o.ocoWith;
  if (change.ocoWith != null && change.ocoWith !== o.ocoWith) checkOcoPartner(state, change.ocoWith, o.id);
  if (price === o.price && sl === o.stopLoss && tp === o.takeProfit && trail === o.trailingPips && expires === o.expiresAt && oco === o.ocoWith) return { state, events: [] };
  const { trailingPips: _oldTrail, expiresAt: _oldExpiry, ocoWith: _oldOco, ...rest } = o;
  const next: PendingOrder = { ...rest, price, stopLoss: sl, takeProfit: tp, ...(trail !== undefined ? { trailingPips: trail } : {}), ...(expires !== undefined ? { expiresAt: expires } : {}), ...(oco !== undefined ? { ocoWith: oco } : {}) };
  let orders = state.orders.map(x => (x.id === o.id ? next : x));
  const partners: PendingOrder[] = [];
  if (oco !== o.ocoWith) {
    // The old partner loses its link; the new partner points back at this order.
    if (o.ocoWith !== undefined) orders = orders.map(x => { if (x.id !== o.ocoWith || x.ocoWith !== o.id) return x; const { ocoWith: _x, ...r } = x; partners.push(r); return r; });
    if (oco !== undefined) orders = orders.map(x => { if (x.id !== oco) return x; const linked = { ...x, ocoWith: o.id }; partners.push(linked); return linked; });
  }
  return { state: { ...state, orders, sequence: state.sequence + 1 }, events: [{ type: "order_modified", order: next }, ...partners.map(order => ({ type: "order_modified" as const, order }))] };
}

export const MAX_ALERTS = 50;
export const TRIGGERED_ALERTS_KEPT = 20;
export const ALERT_NOTE_MAX = 80;

/** True when the bid meets the alert's level (at or beyond it). */
export function alertHit(a: Pick<PriceAlert, "condition" | "price">, bid: number): boolean {
  return a.condition === "above" ? bid >= a.price : bid <= a.price;
}

/**
 * Sets a price alert. Alerts are checked on the bid (the price you sell at),
 * like most trading terminals, and fire once. They never trade. An alert whose
 * level the current fresh bid already meets is refused so it cannot fire at
 * once by mistake. Markets may be closed: the alert waits for the next price.
 */
export function addAlert(state: AccountState, req: AlertRequest, ctx: EngineContext): Step {
  assertActive(state);
  const s = spec(ctx, req.symbol);
  if (req.condition !== "above" && req.condition !== "below") throw new EngineError("bad_alert", "Choose whether the price should go above or below the level.");
  if (typeof req.price !== "number") throw new EngineError("bad_price", "Alert price must be a positive price.");
  checkPrice(s, req.price, "Alert price");
  const note = typeof req.note === "string" ? req.note.trim() : "";
  if (req.note !== undefined && typeof req.note !== "string") throw new EngineError("bad_alert", "The note must be text.");
  if (note.length > ALERT_NOTE_MAX) throw new EngineError("bad_alert", `Keep the note to ${ALERT_NOTE_MAX} characters.`);
  const alerts = state.alerts ?? [];
  if (alerts.length >= MAX_ALERTS) throw new EngineError("too_many_alerts", `You can keep up to ${MAX_ALERTS} price alerts. Delete one first.`);
  const q = ctx.quotes[req.symbol];
  if (q && ctx.now - q.time <= ctx.maxQuoteAgeMs && alertHit(req, q.bid)) {
    throw new EngineError("bad_alert", `The ${req.symbol} bid is already ${req.condition} ${req.price} (now ${q.bid.toFixed(s.digits)}). Pick a level the price has not reached yet.`);
  }
  if (alerts.some(a => a.symbol === req.symbol && a.condition === req.condition && a.price === req.price)) throw new EngineError("bad_alert", "You already have this alert.");
  const alert: PriceAlert = { id: ctx.newId("alr"), symbol: req.symbol, condition: req.condition, price: req.price, createdAt: ctx.now, ...(note ? { note } : {}) };
  return { state: { ...state, alerts: [...alerts, alert], sequence: state.sequence + 1 }, events: [{ type: "alert_added", alert }] };
}

export const NOTICE_KINDS: readonly NoticeKind[] = ["alert", "fill", "stop", "limit", "target", "expiry"];
/**
 * Defaults before a trader chooses: service messages about things the trader
 * asked for or must know (alerts they set, loss limits, the target) are on;
 * routine trade messages are off.
 */
export const DEFAULT_NOTICES: NoticePrefs = { alert: true, fill: false, stop: false, limit: true, target: true, expiry: false };

/** The account's notice choices with the defaults filled in. */
export function noticePrefs(state: Pick<AccountState, "notices">): NoticePrefs {
  const out = { ...DEFAULT_NOTICES };
  for (const k of NOTICE_KINDS) if (typeof state.notices?.[k] === "boolean") out[k] = state.notices[k]!;
  return out;
}

/**
 * Changes which notices the trader receives. Only the given kinds change. It
 * never trades, so it works on any account status (also after a loss limit).
 */
export function setNotices(state: AccountState, change: Partial<NoticePrefs>): Step {
  if (typeof change !== "object" || change === null || Array.isArray(change)) throw new EngineError("bad_notices", "Send the notices to change, e.g. { alert: true }.");
  const keys = Object.keys(change);
  if (!keys.length) throw new EngineError("bad_notices", "Nothing to change.");
  const unknown = keys.filter(k => !(NOTICE_KINDS as readonly string[]).includes(k));
  if (unknown.length) throw new EngineError("bad_notices", `Unknown notice: ${unknown.join(", ")}.`);
  if (keys.some(k => typeof change[k as NoticeKind] !== "boolean")) throw new EngineError("bad_notices", "Each notice is on (true) or off (false).");
  const notices = { ...noticePrefs(state), ...change };
  return { state: { ...state, notices, sequence: state.sequence + 1 }, events: [{ type: "notices_changed", notices }] };
}

/** Deletes a waiting price alert. Works on any account status (it only removes). */
export function removeAlert(state: AccountState, alertId: string): Step {
  if (!(state.alerts ?? []).some(a => a.id === alertId)) throw new EngineError("no_alert", "That alert is not waiting any more.");
  return { state: { ...state, alerts: state.alerts!.filter(a => a.id !== alertId), sequence: state.sequence + 1 }, events: [{ type: "alert_removed", alertId }] };
}

export function cancelOrder(state: AccountState, orderId: string): Step {
  if (!state.orders.some(o => o.id === orderId)) throw new EngineError("no_order", "That order is not pending.");
  // A linked (OCO) partner stays pending on its own.
  const { orders, changed } = unlinkPartners(state.orders.filter(o => o.id !== orderId), new Set([orderId]));
  return { state: { ...state, orders, sequence: state.sequence + 1 }, events: [{ type: "order_cancelled", orderId }, ...changed.map(order => ({ type: "order_modified" as const, order }))] };
}

/**
 * Runs on every price update and on a timer: rolls the trading day, removes
 * pending orders past their expiry (order_expired), fills pending orders, closes positions at stop loss / take profit, enforces the
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
  // Expiry is by time only: an order past its expiry is removed before it can
  // fill, also while its market is closed or without a fresh price.
  const expired: ExpiredOrder[] = current.orders.filter(o => o.expiresAt !== undefined && o.expiresAt <= ctx.now).map(o => ({ ...o, expiresAt: o.expiresAt!, expiredAt: ctx.now }));
  if (expired.length) {
    const gone = new Set(expired.map(o => o.id));
    const unlinked = unlinkPartners(current.orders.filter(o => !gone.has(o.id)), gone);
    current = { ...current, orders: unlinked.orders, expiredOrders: [...[...expired].reverse(), ...(current.expiredOrders ?? [])].slice(0, EXPIRED_ORDERS_KEPT), sequence: current.sequence + 1 };
    events.push(...expired.map(order => ({ type: "order_expired" as const, order })), ...unlinked.changed.map(order => ({ type: "order_modified" as const, order })));
  }
  // Price alerts fire once on the first fresh bid at or beyond their level.
  if (current.alerts?.length) {
    const fired: TriggeredAlert[] = [];
    for (const a of current.alerts) {
      const q = ctx.quotes[a.symbol];
      if (q && ctx.now - q.time <= ctx.maxQuoteAgeMs && alertHit(a, q.bid)) fired.push({ ...a, triggeredAt: ctx.now, triggerPrice: q.bid });
    }
    if (fired.length) {
      const gone = new Set(fired.map(a => a.id));
      current = { ...current, alerts: current.alerts.filter(a => !gone.has(a.id)), triggeredAlerts: [...[...fired].reverse(), ...(current.triggeredAlerts ?? [])].slice(0, TRIGGERED_ALERTS_KEPT), sequence: current.sequence + 1 };
      events.push(...fired.map(alert => ({ type: "alert_triggered" as const, alert })));
    }
  }
  // Closed markets do not fill or stop out. When they reopen, the first fresh
  // price decides: a stop or stop order beyond a weekend gap fills at that
  // price (not at the level), a limit fills at its price or better.
  const tradable = (symbol: string) => { const s = ctx.specs[symbol]; return !s || isMarketOpen(s.hours, ctx.now); };

  for (const o of current.orders) {
    // Skip an order its linked (OCO) partner cancelled earlier in this step.
    if (!current.orders.some(x => x.id === o.id)) continue;
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
    if (opened.type === "position_opened") {
      events.push({ type: "order_triggered", orderId: o.id, positionId: opened.position.id });
      // One cancels the other: the linked order goes in the same step.
      const partner = o.ocoWith !== undefined ? current.orders.find(x => x.id === o.ocoWith) : undefined;
      if (partner) {
        const order: OcoCancelledOrder = { ...partner, ocoWith: o.id, cancelledAt: ctx.now, positionId: opened.position.id };
        current = { ...current, orders: current.orders.filter(x => x.id !== partner.id), ocoCancelled: [order, ...(current.ocoCancelled ?? [])].slice(0, OCO_CANCELLED_KEPT), sequence: current.sequence + 1 };
        events.push({ type: "order_cancelled", orderId: partner.id, reason: "oco", order });
      }
    }
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

  // Trailing stops follow the price that was just checked; a trailed stop is
  // hit on a later price, like any stop loss.
  for (const p of current.positions) {
    if (!p.trailingStop) continue;
    const q = ctx.quotes[p.symbol], s = ctx.specs[p.symbol];
    if (!q || !s || ctx.now - q.time > ctx.maxQuoteAgeMs || !tradable(p.symbol)) continue;
    const level = trailedStop(s, p, closingPrice(p.side, q));
    if (level === null) continue;
    current = { ...current, positions: current.positions.map(x => (x.id === p.id ? { ...x, stopLoss: level } : x)), sequence: current.sequence + 1 };
    events.push({ type: "stop_trailed", positionId: p.id, stopLoss: level, ...(p.stopLoss !== undefined ? { previousStopLoss: p.stopLoss } : {}) });
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

/**
 * Closed results per trading day (22:00 UTC days by default), from the account's
 * deals, including the daily results of deals already moved to the archive.
 */
export function dailyResults(state: Pick<AccountState, "history" | "archived">, resetHourUtc: number): Record<string, number> {
  const days: Record<string, Decimal> = {};
  const a = state.archived;
  if (a) {
    if (a.resetHourUtc !== resetHourUtc) throw new EngineError("bad_state", "Archived daily results use a different reset hour than the account rules.");
    for (const [k, v] of Object.entries(a.dailyResults)) days[k] = new Decimal(v);
  }
  for (const d of state.history) {
    const key = tradingDayKey(d.closedAt, resetHourUtc);
    days[key] = (days[key] ?? new Decimal(0)).plus(d.netProfit);
  }
  return Object.fromEntries(Object.entries(days).map(([k, v]) => [k, cash(v)]));
}

export interface ArchiveOptions {
  /** Most recent deals kept in `history`. */
  keep: number;
  /** The account's daily reset hour (UTC), used to key the archived daily results. */
  resetHourUtc: number;
  /** Deals per archive chunk. Default 250. */
  chunkSize?: number;
  /** How many recent client order ids of moved deals are remembered. Default 1000. */
  maxClientIds?: number;
}

/**
 * Moves the oldest deals out of `history`, keeping the newest `keep`, and folds
 * them into `archived` (count, net profit, daily results, client ids) so the
 * best-day rule, idempotent replays and deal numbering keep working. Returns the
 * moved deals as numbered chunks for the store to write elsewhere. Balance,
 * trading days, positions, orders and `sequence` are untouched: this is storage
 * housekeeping, not a trading change.
 */
export function archiveHistory(state: AccountState, opts: ArchiveOptions): { state: AccountState; chunks: { index: number; deals: Deal[] }[] } {
  const keep = Math.max(0, Math.floor(opts.keep));
  const size = Math.max(1, Math.floor(opts.chunkSize ?? 250));
  const maxIds = Math.max(0, Math.floor(opts.maxClientIds ?? 1000));
  if (state.history.length <= keep) return { state, chunks: [] };
  const cut = state.history.length - keep;
  const moved = state.history.slice(0, cut);
  const prev = state.archived;
  const days = dailyResults({ history: moved, archived: prev }, opts.resetHourUtc);
  const first = prev?.chunks ?? 0;
  const chunks = Array.from({ length: Math.ceil(moved.length / size) }, (_, i) => ({ index: first + i, deals: moved.slice(i * size, (i + 1) * size) }));
  const ids = [...(prev?.clientIds ?? []), ...moved.flatMap(d => (d.clientId ? [d.clientId] : []))];
  const archived = {
    deals: (prev?.deals ?? 0) + moved.length,
    chunks: first + chunks.length,
    netProfit: cash(moved.reduce((t, d) => t.plus(d.netProfit), new Decimal(prev?.netProfit ?? 0))),
    dailyResults: days,
    resetHourUtc: opts.resetHourUtc,
    clientIds: maxIds ? ids.slice(-maxIds) : [],
    firstClosedAt: prev ? Math.min(prev.firstClosedAt, moved[0].closedAt) : moved[0].closedAt,
    lastClosedAt: moved.reduce((m, d) => Math.max(m, d.closedAt), prev?.lastClosedAt ?? 0),
  };
  return { state: { ...state, history: state.history.slice(cut), archived }, chunks };
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


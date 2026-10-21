import Decimal from 'decimal.js';
import { instrument, Quote, SymbolName } from './market';
export type Side = 'buy' | 'sell';
export type OrderKind = 'market' | 'limit' | 'stop';
export interface Order { id: string; symbol: SymbolName; side: Side; kind: OrderKind; lots: number; price?: number; sl?: number; tp?: number; createdAt: number }
export interface Position extends Order { entry: number; openedAt: number }
export interface Fill { id: string; positionId: string; symbol: SymbolName; side: Side; lots: number; entry: number; exit: number; grossPnl: number; commission: number; netPnl: number; closedAt: number; reason: string }
export interface Event { type: string; at: number; detail: string }
export interface TradeAccount {
  accountId: string; userId: string; orderId: string; challengeId: string; phase: 1 | 2;
  status: 'active' | 'passed' | 'failed'; environment: 'development'; provider: 'fynx-synthetic';
  initialBalance: number; balance: number; equity: number; margin: number; freeMargin: number;
  day: string; dayStartEquity: number; tradingDays: string[]; rulesVersion: 'dev-25k-v1';
  positions: Position[]; orders: Order[]; history: Fill[]; revision: number; updatedAt: number;
  failureReason?: string; nextAccountId?: string;
  activationStatus?: 'pending' | 'active';
}
export type Command = { action: 'place'; order: Omit<Order, 'createdAt'> } | { action: 'close'; positionId: string; lots: number } | { action: 'cancel'; orderId: string } | { action: 'protect'; positionId: string; sl?: number | null; tp?: number | null } | { action: 'tick' };
export const devRules = { initialBalance: 25000, dailyLossPercent: 5, maximumLossPercent: 10, phaseOneTarget: 8, phaseTwoTarget: 5, minimumTradingDays: 1, commissionPerLotPerSide: 3.5, slippageTicks: 1, maxQuoteAgeMs: 5000 } as const;
const cash = (n: Decimal.Value) => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const dateKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const pnl = (p: Position, price: number, lots = p.lots) => cash(new Decimal(price).minus(p.entry).times(p.side === 'buy' ? 1 : -1).times(instrument(p.symbol).contractSize).times(lots));
const fee = (lots: number) => cash(new Decimal(lots).times(devRules.commissionPerLotPerSide));
function validLots(lots: number, max = 10) {
  if (!Number.isFinite(lots) || lots < 0.01 || lots > max || !new Decimal(lots).times(100).isInteger()) throw Error('Use lot sizes from 0.01 to 10 in steps of 0.01.');
}
function getQuote(quotes: Record<SymbolName, Quote>, symbol: SymbolName, now: number) {
  const q = quotes[symbol];
  if (!q || q.symbol !== symbol || q.source !== 'synthetic' || !q.open || !Number.isFinite(q.time) || now - q.time > devRules.maxQuoteAgeMs || q.time > now || !Number.isFinite(q.bid) || !Number.isFinite(q.ask) || q.bid <= 0 || q.ask <= q.bid) throw Error('Market prices are stale or unavailable. Trading is paused.');
  return q;
}
function fillPrice(order: Pick<Order, 'symbol' | 'side'>, q: Quote, opening: boolean) {
  const buy = opening ? order.side === 'buy' : order.side === 'sell';
  return new Decimal(buy ? q.ask : q.bid).plus(new Decimal(instrument(order.symbol).tickSize).times(buy ? 1 : -1)).toNumber();
}
function mark(a: TradeAccount, quotes: Record<SymbolName, Quote>, now: number) {
  a.equity = cash(a.positions.reduce((total, p) => total.plus(pnl(p, p.side === 'buy' ? getQuote(quotes, p.symbol, now).bid : getQuote(quotes, p.symbol, now).ask)), new Decimal(a.balance)));
  a.margin = cash(a.positions.reduce((total, p) => total.plus(new Decimal(p.entry).times(p.lots).times(instrument(p.symbol).contractSize).div(instrument(p.symbol).leverage)), new Decimal(0)));
  a.freeMargin = cash(new Decimal(a.equity).minus(a.margin));
}
function close(a: TradeAccount, p: Position, lots: number, quotes: Record<SymbolName, Quote>, now: number, events: Event[], reason: string) {
  validLots(lots, p.lots);
  const price = fillPrice(p, getQuote(quotes, p.symbol, now), false), grossPnl = pnl(p, price, lots), commission = fee(lots), netPnl = cash(new Decimal(grossPnl).minus(commission));
  a.balance = cash(new Decimal(a.balance).plus(netPnl));
  a.history.push({ id: `${p.id}-${a.revision}-${a.history.length}`, positionId: p.id, symbol: p.symbol, side: p.side, lots, entry: p.entry, exit: price, grossPnl, commission, netPnl, closedAt: now, reason });
  p.lots = new Decimal(p.lots).minus(lots).toNumber();
  a.positions = a.positions.filter(x => x.lots > 0);
  events.push({ type: 'position_closed', at: now, detail: `${p.id}: ${lots} lots at ${price}; ${reason}` });
}
function risk(a: TradeAccount, quotes: Record<SymbolName, Quote>, now: number, events: Event[]) {
  mark(a, quotes, now);
  const totalFloor = a.initialBalance * (1 - devRules.maximumLossPercent / 100);
  const dailyFloor = a.dayStartEquity - a.initialBalance * devRules.dailyLossPercent / 100;
  if (a.status === 'active' && (a.equity <= totalFloor || a.equity <= dailyFloor || a.equity <= 0)) {
    a.failureReason = a.equity <= totalFloor ? 'Maximum loss limit reached' : 'Daily loss limit reached';
    for (const position of [...a.positions]) close(a, position, position.lots, quotes, now, events, 'risk_liquidation');
    a.orders = []; a.status = 'failed';
    events.push({ type: 'challenge_failed', at: now, detail: a.failureReason }); mark(a, quotes, now);
  }
}
function protectPositions(a: TradeAccount, quotes: Record<SymbolName, Quote>, now: number, events: Event[]) {
  for (const p of [...a.positions]) {
    const q = getQuote(quotes, p.symbol, now), price = p.side === 'buy' ? q.bid : q.ask;
    if (p.sl && (p.side === 'buy' ? price <= p.sl : price >= p.sl)) close(a, p, p.lots, quotes, now, events, 'stop_loss');
    else if (p.tp && (p.side === 'buy' ? price >= p.tp : price <= p.tp)) close(a, p, p.lots, quotes, now, events, 'take_profit');
  }
}
function open(a: TradeAccount, order: Order, quotes: Record<SymbolName, Quote>, now: number, events: Event[]) {
  const q = getQuote(quotes, order.symbol, now), spec = instrument(order.symbol);
  let entry = fillPrice(order, q, true);
  // Limit orders fill at their requested price or better, including simulated slippage.
  if (order.kind === 'limit') entry = order.side === 'buy' ? Math.min(entry, order.price!) : Math.max(entry, order.price!);
  const commission = fee(order.lots), margin = new Decimal(entry).times(order.lots).times(spec.contractSize).div(spec.leverage);
  const immediateLoss = pnl({ ...order, entry, openedAt: now }, order.side === 'buy' ? q.bid : q.ask);
  if (new Decimal(a.freeMargin).plus(immediateLoss).minus(commission).lessThan(margin)) throw Error('Insufficient free margin.');
  a.balance = cash(new Decimal(a.balance).minus(commission));
  a.positions.push({ ...order, entry, openedAt: now });
  if (!a.tradingDays.includes(dateKey(now))) a.tradingDays.push(dateKey(now));
  events.push({ type: 'order_filled', at: now, detail: `${order.id}: ${order.side} ${order.lots} ${order.symbol} at ${entry}; entry commission ${commission}` });
  mark(a, quotes, now);
}
export function newAccount(input: Pick<TradeAccount, 'accountId' | 'userId' | 'orderId' | 'challengeId' | 'phase'>, now: number): TradeAccount {
  return { ...input, status: 'active', environment: 'development', provider: 'fynx-synthetic', initialBalance: 25000, balance: 25000, equity: 25000, margin: 0, freeMargin: 25000, day: dateKey(now), dayStartEquity: 25000, tradingDays: [], rulesVersion: 'dev-25k-v1', positions: [], orders: [], history: [], revision: 0, updatedAt: now };
}
export function execute(previous: TradeAccount, command: Command, quotes: Record<SymbolName, Quote>, now: number, captureRejection = false) {
  let a: TradeAccount = structuredClone(previous);
  const events: Event[] = [];
  let rejection: string | undefined;
  if (a.environment !== 'development' || a.provider !== 'fynx-synthetic' || a.rulesVersion !== 'dev-25k-v1') throw Error('Development account required.');
  if (a.activationStatus === 'pending') { if (command.action === 'tick') return { account: a, events }; throw Error('Activate this development account before trading.'); }
  if (a.status !== 'active') { if (command.action === 'tick') return { account: a, events }; throw Error('This account is history-only.'); }
  if (a.history.length > 400 || a.revision > 1000000) throw Error('Development history limit reached.');
  if (now < a.updatedAt) throw Error('Out-of-order market update.');
  if (dateKey(now) !== a.day) { a.day = dateKey(now); a.dayStartEquity = a.equity; }
  risk(a, quotes, now, events);
  if (a.status === 'active') {
    protectPositions(a, quotes, now, events);
    risk(a, quotes, now, events);
  }
  if (a.status === 'active') {
    for (const order of [...a.orders]) {
      const q = getQuote(quotes, order.symbol, now), price = order.side === 'buy' ? q.ask : q.bid;
      const triggered = order.kind === 'limit' ? (order.side === 'buy' ? price <= order.price! : price >= order.price!) : (order.side === 'buy' ? price >= order.price! : price <= order.price!);
      if (!triggered) continue;
      a.orders = a.orders.filter(x => x.id !== order.id);
      try { open(a, order, quotes, now, events); protectPositions(a, quotes, now, events); }
      catch (e) { events.push({ type: 'order_rejected', at: now, detail: `${order.id}: ${(e as Error).message}` }); }
      risk(a, quotes, now, events); if (a.status !== 'active') break;
    }
  }
  // Automatic market/risk effects must survive rejection of a customer command.
  const afterMarket = structuredClone(a), marketEventCount = events.length;
  try {
  if (a.status !== 'active' && command.action !== 'tick') {
    // Preserve the authoritative risk outcome; never roll it back due to a new order.
    throw Error('Account failed its risk checks before this command.');
  } else if (command.action === 'place') {
    const o: Order = { ...command.order, createdAt: now }; const spec = instrument(o.symbol);
    if (!['buy', 'sell'].includes(o.side) || !['market', 'limit', 'stop'].includes(o.kind)) throw Error('Invalid order direction or type.');
    validLots(o.lots, spec.maxLots);
    if (a.positions.length + a.orders.length >= 20) throw Error('Development account supports at most 20 open positions and pending orders.');
    if (a.positions.some(p => p.id === o.id) || a.orders.some(p => p.id === o.id) || a.history.some(p => p.positionId === o.id)) throw Error('Order ID has already been used.');
    const q = getQuote(quotes, o.symbol, now), market = o.side === 'buy' ? q.ask : q.bid;
    for (const value of [o.price, o.sl, o.tp]) if (value !== undefined && (!Number.isFinite(value) || value <= 0 || !new Decimal(value).div(spec.tickSize).isInteger())) throw Error('Prices must be positive multiples of the instrument tick size.');
    if (o.kind !== 'market' && !o.price) throw Error('Enter an order price.');
    const reference = o.kind === 'market' ? market : o.price!;
    if (o.sl && (o.side === 'buy' ? o.sl >= reference : o.sl <= reference)) throw Error('Stop loss must be on the loss side of the entry price.');
    if (o.tp && (o.side === 'buy' ? o.tp <= reference : o.tp >= reference)) throw Error('Take profit must be on the profit side of the entry price.');
    if (o.kind === 'market') open(a, o, quotes, now, events);
    else {
      const wrongSide = o.kind === 'limit' ? (o.side === 'buy' ? reference >= market : reference <= market) : (o.side === 'buy' ? reference <= market : reference >= market);
      if (wrongSide) throw Error('Pending order price is on the wrong side of the market.');
      a.orders.push(o); events.push({ type: 'order_pending', at: now, detail: `${o.id}: ${o.kind} ${o.symbol} at ${o.price}` });
    }
  } else if (command.action === 'close') {
    const p = a.positions.find(x => x.id === command.positionId); if (!p) throw Error('Position already closed or unavailable.');
    close(a, p, command.lots, quotes, now, events, 'customer');
  } else if (command.action === 'protect') {
    const p = a.positions.find(x => x.id === command.positionId);
    if (!p) throw Error('Position already closed or unavailable.');
    if (command.sl === undefined && command.tp === undefined) throw Error('Choose a stop loss or take profit to update.');
    const q = getQuote(quotes, p.symbol, now), reference = p.side === 'buy' ? q.bid : q.ask;
    for (const key of ['sl', 'tp'] as const) {
      const value = command[key];
      if (value === undefined) continue;
      if (value === null) { delete p[key]; continue; }
      if (!Number.isFinite(value) || value <= 0 || !new Decimal(value).div(instrument(p.symbol).tickSize).isInteger()) throw Error('Prices must be positive multiples of the instrument tick size.');
      const below = key === 'sl' ? p.side === 'buy' : p.side === 'sell';
      if (below ? value >= reference : value <= reference) throw Error('Protection must be on the correct side of the current executable price.');
      p[key] = value;
    }
    events.push({ type: 'position_protection_updated', at: now, detail: `${p.id}: SL ${p.sl ?? 'none'}; TP ${p.tp ?? 'none'}` });
  } else if (command.action === 'cancel') {
    if (!a.orders.some(x => x.id === command.orderId)) throw Error('Pending order is unavailable.');
    a.orders = a.orders.filter(x => x.id !== command.orderId); events.push({ type: 'order_cancelled', at: now, detail: command.orderId });
  }
  } catch (error) {
    if (!captureRejection) throw error;
    a = afterMarket; events.splice(marketEventCount);
    rejection = error instanceof Error ? error.message : 'Order rejected.';
    events.push({ type: 'command_rejected', at: now, detail: rejection });
  }
  // A gap can fill a pending order beyond its protection; do not leave it open until another tick.
  if (a.status === 'active') protectPositions(a, quotes, now, events);
  risk(a, quotes, now, events);
  const target = a.initialBalance * (1 + (a.phase === 1 ? devRules.phaseOneTarget : devRules.phaseTwoTarget) / 100);
  if (a.status === 'active' && a.positions.length === 0 && a.orders.length === 0 && a.balance >= target && a.tradingDays.length >= devRules.minimumTradingDays) {
    a.status = 'passed'; events.push({ type: 'challenge_passed', at: now, detail: `Development phase ${a.phase}; closed balance ${a.balance}; rule ${a.rulesVersion}` });
  }
  a.revision++; a.updatedAt = now;
  return { account: a, events, ...(rejection ? { rejection } : {}) };
}

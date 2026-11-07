/**
 * FYNX trading engine: shared types. The engine is plain TypeScript with no
 * browser or Firebase dependencies so the same code can run in the web app,
 * in Cloud Functions or behind the FYNX API.
 */

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type CloseReason = "manual" | "stop_loss" | "take_profit" | "daily_loss_limit" | "maximum_loss_limit" | "target_reached";

export interface InstrumentSpec {
  symbol: string;
  base: string;
  quote: string;
  /** Price step that counts as one pip. */
  pipSize: number;
  /** Smallest price step quoted. */
  tickSize: number;
  digits: number;
  /** Units of the base currency in 1.00 lot. */
  contractSize: number;
  minLots: number;
  lotStep: number;
  maxLots: number;
  /** Account leverage for margin (e.g. 30 for 1:30). Set by the venue. */
  leverage: number;
  /** Commission in account currency per lot per side. */
  commissionPerLotPerSide: number;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  /** Milliseconds since epoch when the provider produced the quote. */
  time: number;
}

export type QuoteBook = Record<string, Quote | undefined>;

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  lots: number;
  /** Entry price for limit and stop orders. */
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Client idempotency key: the same key never opens two positions. */
  clientId?: string;
}

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  lots: number;
  entryPrice: number;
  openedAt: number;
  stopLoss?: number;
  takeProfit?: number;
  commission: number;
  clientId?: string;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  side: Side;
  type: Exclude<OrderType, "market">;
  lots: number;
  price: number;
  stopLoss?: number;
  takeProfit?: number;
  createdAt: number;
  clientId?: string;
}

export interface Deal {
  id: string;
  positionId: string;
  symbol: string;
  side: Side;
  lots: number;
  entryPrice: number;
  exitPrice: number;
  openedAt: number;
  closedAt: number;
  grossProfit: number;
  commission: number;
  netProfit: number;
  reason: CloseReason;
  clientId?: string;
}

export interface RuleSet {
  startingBalance: number;
  /** Daily loss limit as % of the balance at the daily reset. */
  dailyLossPercent: number;
  /** Static maximum loss as % of the starting balance. */
  maxLossPercent: number;
  /** Profit target as % of the starting balance; null for funded accounts. */
  profitTargetPercent: number | null;
  minTradingDays: number;
  /** Hour (UTC) when the trading day resets. */
  resetHourUtc: number;
}

export type AccountStatus = "active" | "passed" | "breached" | "disabled";

export interface AccountState {
  accountId: string;
  currency: "USD";
  status: AccountStatus;
  balance: number;
  /** Balance at the start of the current trading day (after the reset). */
  dayStartBalance: number;
  /** Trading-day key (YYYY-MM-DD of the reset that opened it). */
  tradingDay: string;
  /** Trading days on which at least one position was opened. */
  tradingDays: string[];
  positions: Position[];
  orders: PendingOrder[];
  history: Deal[];
  breachReason?: CloseReason;
  /** When the profit target was first met with the minimum trading days (pending official review). */
  targetReachedAt?: number;
  sequence: number;
}

export interface AccountMetrics {
  balance: number;
  equity: number;
  floatingProfit: number;
  margin: number;
  freeMargin: number;
  /** Equity / margin × 100, null without open positions. */
  marginLevel: number | null;
  dailyLossFloor: number;
  maxLossFloor: number;
  /** Equity left before the closer of the two floors. */
  roomToFloor: number;
  profitTargetBalance: number | null;
}

export type EngineEvent =
  | { type: "position_opened"; position: Position }
  | { type: "order_placed"; order: PendingOrder }
  | { type: "order_triggered"; orderId: string; positionId: string }
  | { type: "order_cancelled"; orderId: string }
  | { type: "position_modified"; positionId: string }
  | { type: "position_closed"; deal: Deal }
  | { type: "account_breached"; reason: CloseReason }
  | { type: "target_reached" }
  | { type: "day_reset"; tradingDay: string; dayStartBalance: number };

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EngineError";
  }
}

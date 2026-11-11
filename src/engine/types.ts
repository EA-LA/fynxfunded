import type { TradingHours } from "./hours";

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
  /** When the instrument can be traded. Missing = at all times. */
  hours?: TradingHours;
  /** Overnight financing. Missing = no swap is charged or paid. */
  swap?: SwapRates;
}

/**
 * Overnight financing (swap/rollover) in account currency (USD) per 1.00 lot
 * per night, as the broker or liquidity provider publishes it. Negative is a
 * charge, positive is paid to the trader. Applied to positions open at the
 * engine's daily reset (rules.resetHourUtc). Saturday and Sunday resets charge
 * nothing; the reset on `tripleWeekday` (default 3 = Wednesday) charges three
 * nights to cover the weekend, the market convention.
 */
export interface SwapRates {
  longPerLot: number;
  shortPerLot: number;
  /** 0 = Sunday … 6 = Saturday. Default 3 (Wednesday). */
  tripleWeekday?: number;
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
  /**
   * Trailing stop distance in pips, set on the position the moment it opens
   * (market orders at once, pending orders when they fill). Same limits as
   * `modifyPosition`: TRAILING_MIN_PIPS–TRAILING_MAX_PIPS in 0.1 pip steps.
   */
  trailingPips?: number;
  /**
   * Pending orders only: when the order is cancelled by the engine if it has
   * not filled (milliseconds since epoch, "good till date"). Missing = good
   * till cancelled. At least EXPIRY_MIN_MS ahead and at most EXPIRY_MAX_MS.
   */
  expiresAt?: number;
  /**
   * Market orders only, price protection ("maximum deviation"): the price the
   * trader saw (ask for a buy, bid for a sell) and the most it may move against
   * them before the fill, in pips (0–DEVIATION_MAX_PIPS, 0.1 steps). A worse
   * fill is refused with `price_moved` and nothing opens; the same or a better
   * price fills normally. Both fields together or neither.
   */
  expectedPrice?: number;
  maxDeviationPips?: number;
  /**
   * Pending orders only, "one cancels the other" (OCO): the id of a pending
   * order already on the account that this order is linked with. When either
   * of the two fills, the engine cancels the other one in the same step. A
   * pending order can be linked with one other order at a time. Cancelling or
   * expiring one of them leaves the other pending, unlinked.
   */
  ocoWith?: string;
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
  /** Swap accumulated while open (USD, negative = charged). Settled into the balance on close. */
  swap?: number;
  clientId?: string;
  /**
   * Risk as it stood when the position opened (kept when the stop loss is
   * moved later), so the ledger can report risk % and R-multiples. Missing
   * when the position opened without a stop loss.
   */
  entryRisk?: EntryRisk;
  /**
   * Trailing stop: once the closing price is `pips` in profit, the stop loss
   * follows the price at that distance and never moves back. Missing = off.
   */
  trailingStop?: TrailingStop;
}

/**
 * Trailing stop settings of an open position (MT5 convention). It starts
 * when the closing price (bid for buys, ask for sells) is at least `pips`
 * beyond the entry, so the first trailed stop sits at break-even or better.
 * From then on the stop is kept `pips` behind the best closing price, moved in
 * steps of at least one pip, and only ever towards profit. The engine moves
 * it on the server's timer step and on every price, so it works with the
 * terminal closed. Hitting a trailed stop closes the position as `stop_loss`.
 */
export interface TrailingStop {
  /** Distance from the closing price in pips (0.1 pip steps, between TRAILING_MIN_PIPS and TRAILING_MAX_PIPS). */
  pips: number;
}

/**
 * The trade's risk at entry: the stop loss and take profit it opened with,
 * the dollars that stop loss put at risk for the position's current lots
 * (before commission and swap) and the balance it opened on.
 */
export interface EntryRisk {
  stopLoss: number;
  takeProfit?: number;
  /** USD lost if the entry stop loss is hit, for the current lots (scaled on partial closes). */
  amount: number;
  /** Account balance just before the position opened (USD). */
  balance: number;
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
  /** Trailing stop distance in pips the position gets when this order fills. */
  trailingPips?: number;
  /** Expiry time (ms since epoch); missing = good till cancelled. See OrderRequest.expiresAt. */
  expiresAt?: number;
  /** Id of the pending order this one is linked with ("one cancels the other"); both point at each other. */
  ocoWith?: string;
  createdAt: number;
  clientId?: string;
}

/** A pending order the engine cancelled because the order it was linked with (OCO) filled. */
export interface OcoCancelledOrder extends PendingOrder {
  ocoWith: string;
  cancelledAt: number;
  /** The position the linked order opened. */
  positionId: string;
}

/** A pending order that reached its expiry time without filling. */
export interface ExpiredOrder extends PendingOrder {
  expiresAt: number;
  /** When the engine removed it (its first check at or after expiresAt). */
  expiredAt: number;
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
  /** Swap settled with this deal (USD, negative = charged). Included in netProfit. */
  swap?: number;
  netProfit: number;
  reason: CloseReason;
  clientId?: string;
  /** Risk at entry for the lots of this deal (see Position.entryRisk). Missing without an entry stop loss. */
  entryRisk?: EntryRisk;
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
  /**
   * Consistency rule: the best trading day may be at most this % of the total
   * profit (FYNX Funded uses 40). null or missing = no consistency rule.
   */
  consistencyPercent?: number | null;
}

/** Where an account stands against its profit target, minimum days and consistency rule. */
export interface TargetReport {
  /** Closed profit: balance minus the starting balance. */
  profit: number;
  /** Profit the target needs in dollars; null for funded accounts. */
  targetProfit: number | null;
  /** Profit still missing (0 once met); null for funded accounts. */
  profitToGo: number | null;
  targetMet: boolean;
  tradingDays: number;
  minTradingDays: number;
  daysMet: boolean;
  /** Best trading day by closed result (22:00 UTC days), null before any closed trade. */
  bestDay: { day: string; profit: number } | null;
  /** Best day as % of total profit; null while the total profit is not positive. */
  bestDayShare: number | null;
  consistencyLimit: number | null;
  consistencyMet: boolean;
  /**
   * Total profit at which the best day would fit the consistency rule (best day ÷ limit);
   * null when there is no rule or no positive best day.
   */
  profitForConsistency: number | null;
  openPositions: number;
  /** Every condition met with nothing open: ready for the official review. */
  ready: boolean;
  /** Plain reasons the target is not reported yet. */
  missing: string[];
}

/** What the engine still needs to know about deals that were moved out of `history`. */
export interface ArchivedHistory {
  /** Number of deals moved out. */
  deals: number;
  /** Number of archive chunks written (chunk indexes 0 … chunks − 1). */
  chunks: number;
  /** Sum of the moved deals' net profit (USD). */
  netProfit: number;
  /** Closed result per trading day of the moved deals, for the best-day (consistency) rule. */
  dailyResults: Record<string, number>;
  /** Reset hour the daily results were keyed with; must stay the account's reset hour. */
  resetHourUtc: number;
  /** Most recent client order ids of moved deals, so a retried request is still recognised. */
  clientIds: string[];
  firstClosedAt: number;
  lastClosedAt: number;
}

/** One archived chunk of old deals (oldest first), as a store keeps it. */
export interface ArchiveChunk { accountId: string; index: number; firstClosedAt: number; lastClosedAt: number; deals: Deal[] }

/** One page of archived history for the terminal: a chunk plus how many chunks the account has. */
export interface HistoryPage extends ArchiveChunk {
  /** Number of archive chunks (indexes 0 … chunks − 1, 0 is the oldest). */
  chunks: number;
}

/** "above": fires when the bid reaches the price or higher; "below": when the bid reaches it or lower. */
export type AlertCondition = "above" | "below";

/** What a trader sends to set a price alert. Alerts never place, change or close an order. */
export interface AlertRequest {
  symbol: string;
  condition: AlertCondition;
  price: number;
  /** Optional short note shown with the alert (at most ALERT_NOTE_MAX characters). */
  note?: string;
}

/** A price alert waiting on the server; checked on every fresh bid, also with the terminal closed. */
export interface PriceAlert extends AlertRequest {
  id: string;
  createdAt: number;
}

/** An alert that fired: the time and the bid that crossed the level. */
export interface TriggeredAlert extends PriceAlert {
  triggeredAt: number;
  triggerPrice: number;
}

/**
 * What a trader can be told by email (or another channel the host connects)
 * when it happens on the server, also with the terminal closed:
 *  - alert:  a price alert fired
 *  - fill:   a pending order was filled
 *  - stop:   a position closed at its stop loss or take profit
 *  - limit:  the daily or maximum loss limit closed the account's trades
 *  - target: the profit target was reached with the minimum trading days
 *  - expiry: a pending order was cancelled at its expiry time
 */
export type NoticeKind = "alert" | "fill" | "stop" | "limit" | "target" | "expiry";
export type NoticePrefs = Record<NoticeKind, boolean>;

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
  /**
   * Pending orders the engine removed at their expiry time, newest first
   * (at most EXPIRED_ORDERS_KEPT), so the terminal can say what happened to
   * them. Missing until the first expiry.
   */
  expiredOrders?: ExpiredOrder[];
  /**
   * Pending orders cancelled because their linked (OCO) order filled, newest
   * first (at most OCO_CANCELLED_KEPT). Missing until the first one.
   */
  ocoCancelled?: OcoCancelledOrder[];
  /** Price alerts waiting to fire (at most MAX_ALERTS). Missing until the first alert. */
  alerts?: PriceAlert[];
  /** Alerts that fired, newest first (at most TRIGGERED_ALERTS_KEPT). */
  triggeredAlerts?: TriggeredAlert[];
  /**
   * Summary of older deals moved out of `history` to keep the stored account
   * small (see `archiveHistory`). Absent until the first archive.
   */
  archived?: ArchivedHistory;
  /** The trader's choices of which notices to receive (see NoticeKind). Missing means the defaults (DEFAULT_NOTICES). */
  notices?: Partial<NoticePrefs>;
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
  | { type: "order_cancelled"; orderId: string; reason?: "oco"; order?: OcoCancelledOrder }
  | { type: "order_modified"; order: PendingOrder }
  | { type: "order_expired"; order: ExpiredOrder }
  | { type: "position_modified"; positionId: string }
  | { type: "stop_trailed"; positionId: string; stopLoss: number; previousStopLoss?: number }
  | { type: "position_closed"; deal: Deal }
  | { type: "account_breached"; reason: CloseReason }
  | { type: "target_reached" }
  | { type: "day_reset"; tradingDay: string; dayStartBalance: number }
  | { type: "alert_added"; alert: PriceAlert }
  | { type: "alert_removed"; alertId: string }
  | { type: "alert_triggered"; alert: TriggeredAlert }
  | { type: "notices_changed"; notices: NoticePrefs }
  | { type: "swap_applied"; positionId: string; amount: number; nights: number; at: number };

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EngineError";
  }
}

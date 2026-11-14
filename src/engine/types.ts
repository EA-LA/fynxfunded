import type { TradingHours } from "./hours";

/**
 * FYNX trading engine: shared types. The engine is plain TypeScript with no
 * browser or Firebase dependencies so the same code can run in the web app,
 * in Cloud Functions or behind the FYNX API.
 */

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type CloseReason = "manual" | "stop_loss" | "take_profit" | "daily_loss_limit" | "maximum_loss_limit" | "target_reached" | "weekend_close" | "stop_out";

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
  /**
   * "No weekend holding": minutes before the market closes for the weekend
   * (any closure of a day or more, see src/engine/weekend.ts) at which open
   * trades are closed (`weekend_close`) and new market orders refused.
   * null or missing = trades may be held over the weekend.
   */
  weekendCloseMinutes?: number | null;
  /**
   * Open-exposure limits (src/engine/exposure.ts): most lots / most trades
   * open at once, counting open trades and waiting pending orders (a linked
   * OCO pair counts once). Missing = no limit.
   */
  maxOpenLots?: number;
  maxOpenTrades?: number;
  /**
   * Margin stop out (src/engine/stop-out.ts): when the margin level falls to
   * this percent (10–100), open trades are closed at the market, largest loss
   * first, until it is above again (`stop_out`). Missing = no stop out.
   */
  stopOutPercent?: number;
  /**
   * Stop loss required / maximum risk per trade (src/engine/trade-risk.ts):
   * new orders need a stop loss, stops can be moved but not removed, and with
   * `maxRiskPercent` (0.1–10) a trade may lose at most that share of the
   * balance at its stop loss (`risk_limit`). Missing = no such rule.
   */
  stopLossRequired?: boolean;
  maxRiskPercent?: number;
  /**
   * No hedging (src/engine/hedging.ts): `false` = a pair may not hold buy and
   * sell trades at once. New orders against an open trade are refused
   * (`hedging`); waiting orders in the other direction do not fill while it
   * is open. Missing = hedging allowed (no such rule).
   */
  hedgingAllowed?: boolean;
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
 *  - near:   equity came within the trader's chosen distance of a loss limit
 *            (once per limit per trading day; see NearLimitWarning)
 */
export type NoticeKind = "alert" | "fill" | "stop" | "limit" | "target" | "expiry" | "near";
export type NoticePrefs = Record<NoticeKind, boolean>;
/**
 * A change to the notice choices: kinds on/off, and optionally the distance
 * for the "near a loss limit" warning as the share (whole percent, 5–90) of
 * the limit's allowance still left.
 */
export type NoticeChange = Partial<NoticePrefs> & { nearPercent?: number };

/**
 * "Close to a loss limit" warning: equity came within the trader's chosen
 * share of a limit's allowance. Written at most once per limit per trading
 * day, only while the trader has the "near" notice on, on fresh and fully
 * priced equity. It never trades.
 */
export interface NearLimitWarning {
  /** Trading-day key it belongs to. */
  tradingDay: string;
  /** Which limit: the daily loss limit or the maximum loss limit. */
  limit: "daily" | "maximum";
  /** When it was seen (ms). */
  at: number;
  /** Equity at that moment. */
  equity: number;
  /** The limit's equity level. */
  floor: number;
  /** Equity minus that level: dollars left before the limit. */
  room: number;
  /** The limit's whole allowance in dollars (from the day's start balance or the starting balance). */
  allowance: number;
  /** room / allowance × 100, one decimal. */
  roomPercent: number;
  /** The trader's setting at that moment (warn at or below this share left). */
  thresholdPercent: number;
}

export type AccountStatus = "active" | "passed" | "breached" | "disabled";

/**
 * What one trading day ended with, written by the engine at the daily reset
 * (22:00 UTC by default). Figures come from the account itself; nothing is
 * estimated. When the engine was not running at the reset, the record is
 * written on the first check after it and `late` is true: balances are still
 * exact, but the equity is taken at that later moment.
 */
export interface DayClose {
  /** Trading-day key (YYYY-MM-DD) of the day that ended. */
  tradingDay: string;
  /** Balance at the start of that day (the daily loss limit is measured from it). */
  startBalance: number;
  /** Balance when the day ended (closed trades only). */
  closingBalance: number;
  /** Equity when the day ended (open trades at the last prices, swap included); null when an open trade had no price. */
  closingEquity: number | null;
  /** Oldest price time used for closingEquity (ms); null without open trades or without prices. */
  pricesAt: number | null;
  /** Net result of the trades closed that day (commission and swap included), archived trades included. */
  closedResult: number;
  /** Trades closed that day (from the deals still in the account history). */
  trades: number;
  /** Equity level of the daily loss limit that applied that day. */
  dailyLossFloor: number;
  /** Equity level of the maximum loss limit. */
  maxLossFloor: number;
  /** closingEquity minus the higher of the two floors; null without closingEquity. */
  roomAtClose: number | null;
  /** Positions held through the reset and their total lots. */
  openPositions: number;
  openLots: number;
  /** Swap charged (negative) or paid on those positions at this reset, all nights included. */
  swapAtRollover: number;
  /** Account status when the day ended. */
  status: AccountStatus;
  /** When the record was written (ms). */
  recordedAt: number;
  /** True when it was written more than 5 minutes after the reset (the engine was not running then). */
  late: boolean;
  /**
   * Lowest equity the engine recorded during that day (see `DayLow`), the
   * closing equity included; null when no priced equity was seen. Missing on
   * records written before this was tracked.
   */
  lowestEquity?: number | null;
  /** When that lowest equity was seen (ms); null with lowestEquity null. */
  lowestEquityAt?: number | null;
  /** lowestEquity minus the higher of the two loss levels: how close the day came to a limit. */
  roomAtLow?: number | null;
}

/**
 * Lowest equity seen during the current trading day. Write-light: a lower
 * value is stored at once when it is at least DAY_LOW_STEP_PERCENT of the
 * day's starting balance below the stored one, when the account is changing
 * anyway (a fill, a close, a reset, a breach) or when it has no open trades;
 * smaller dips at most once every DAY_LOW_INTERVAL_MS. Only tradable, fresh,
 * fully priced equity counts.
 */
export interface DayLow {
  /** Trading-day key the low belongs to. */
  tradingDay: string;
  equity: number;
  /** When it was seen (ms). */
  at: number;
}

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
  /**
   * End-of-day records, newest first (at most DAY_CLOSES_KEPT): one per
   * trading day the account was open at its daily reset. Missing until the
   * first reset.
   */
  dayCloses?: DayClose[];
  /** Lowest equity so far in the current trading day; missing until the first priced check of the day. */
  dayLow?: DayLow;
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
  /** Distance for the "near a loss limit" warning: share of the allowance left, whole percent (missing: DEFAULT_NEAR_LIMIT_PERCENT). */
  nearLimitPercent?: number;
  /** "Close to a loss limit" warnings, newest first (at most NEAR_WARNINGS_KEPT). Missing until the first one. */
  nearWarnings?: NearLimitWarning[];
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
  /**
   * Open positions' symbols whose profit/loss could not be valued in dollars
   * (no price for the pair, or no conversion price yet). Present only when not
   * empty; equity, free margin, margin level and room to floor then leave them
   * out and are not complete.
   */
  unpriced?: string[];
  /** Open positions' symbols whose margin could not be valued (no conversion price yet). Present only when not empty. */
  marginUnpriced?: string[];
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
  | { type: "notices_changed"; notices: NoticePrefs; nearLimitPercent?: number }
  | { type: "limit_near"; warning: NearLimitWarning }
  | { type: "swap_applied"; positionId: string; amount: number; nights: number; at: number };

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EngineError";
  }
}

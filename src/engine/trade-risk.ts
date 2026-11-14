/**
 * FYNX trading engine: the optional "stop loss required" and "maximum risk
 * per trade" rules.
 *
 * Many prop-firm agreements ask that every trade carries a stop loss, and some
 * cap what one trade may lose at its stop loss as a share of the balance. When
 * an account's purchased rules carry `stop_loss_required: true` and/or
 * `max_risk_per_trade_percent` (0.1–10 %), the engine:
 *
 * - refuses a new market or pending order without a stop loss (`risk_limit`,
 *   nothing is sent);
 * - with a maximum risk, refuses a new order whose loss at the stop loss
 *   (from the fill price for a market order, from the order price for a
 *   pending order, before commission) is more than the percent of the balance;
 * - refuses removing the stop loss of an open trade or a waiting order (it can
 *   still be moved), and moving it so the trade risks more than the cap
 *   (tightening, break-even and profit-locking stops are always allowed);
 * - never refuses a fill, a close, a cancel or a trailing-stop step.
 *
 * A maximum risk always implies a required stop loss: an order without a stop
 * cannot be measured. Missing rules = today's behaviour (nothing changes).
 *
 * Pure: no clock, no I/O. The server and the terminal use the same functions.
 */

export const RISK_MIN_PERCENT = 0.1;
export const RISK_MAX_PERCENT = 10;

/** A maximum risk per trade the engine accepts: a percent from 0.1 to 10, at most two decimals. */
export const validRiskPercent = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= RISK_MIN_PERCENT && v <= RISK_MAX_PERCENT && Math.abs(Math.round(v * 100) - v * 100) < 1e-9;

export interface TradeRiskRule {
  /** Every new order needs a stop loss; open trades and waiting orders keep theirs. Always true when a rule exists. */
  stopLossRequired: true;
  /** Most a trade may lose at its stop loss, in percent of the balance. Missing = no cap. */
  maxRiskPercent?: number;
}

/**
 * The rule from a RuleSet or a snapshot (`{ stopLossRequired, maxRiskPercent }`),
 * or null when the account has neither. Invalid values are ignored here (the
 * venue refuses them when reading the purchase).
 */
export function tradeRiskRule(src: { stopLossRequired?: unknown; maxRiskPercent?: unknown } | null | undefined): TradeRiskRule | null {
  if (!src) return null;
  const cap = validRiskPercent(src.maxRiskPercent) ? src.maxRiskPercent : undefined;
  if (src.stopLossRequired !== true && cap === undefined) return null;
  return { stopLossRequired: true, ...(cap !== undefined ? { maxRiskPercent: cap } : {}) };
}

/** The cap in dollars for a balance, rounded down to the cent (never more than the percent allows). */
export function riskCapUsd(rule: TradeRiskRule | null, balance: number): number | null {
  if (!rule || rule.maxRiskPercent === undefined || !(balance > 0)) return null;
  // balance × percent ÷ 100 dollars = balance × percent cents.
  return Math.floor(balance * rule.maxRiskPercent + 1e-6) / 100;
}

const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Plain description of the rule, e.g. for the terminal's Account tab. */
export function tradeRiskRuleText(rule: TradeRiskRule, balance?: number): string {
  const cap = riskCapUsd(rule, balance ?? 0);
  return rule.maxRiskPercent === undefined
    ? "Every order needs a stop loss; a stop loss can be moved but not removed"
    : `Every order needs a stop loss, and a trade may lose at most ${pct(rule.maxRiskPercent)} of the balance at its stop loss${cap !== null ? ` (${usd(cap)} today)` : ""}; a stop loss can be moved closer but not removed`;
}

export interface RiskAtStop {
  /** False when the server has no price to turn the result into dollars yet. */
  priced: boolean;
  /** Dollars lost at the stop loss from the entry price (0 when the stop is at or beyond break-even). */
  amount: number;
}

const tooMuch = (rule: TradeRiskRule, risk: number, balance: number, cap: number, what: string) =>
  `${what} would lose ${usd(risk)} at its stop loss (${pct((risk / balance) * 100)} of the ${usd(balance)} balance); this account allows at most ${pct(rule.maxRiskPercent!)} (${usd(cap)}) per trade. Move the stop loss closer or lower the volume. Nothing was sent.`;

/**
 * Why a new order is refused under the rule, or null when it may go. `risk`
 * is null without a stop loss.
 */
export function newOrderRiskProblem(rule: TradeRiskRule | null, risk: RiskAtStop | null, balance: number): string | null {
  if (!rule) return null;
  if (!risk) return "This account needs a stop loss on every order. Set a stop loss and try again. Nothing was sent.";
  if (rule.maxRiskPercent === undefined) return null;
  if (!risk.priced) return "The risk at the stop loss cannot be worked out in dollars yet: the server has no price to convert it. Try again in a moment. Nothing was sent.";
  const cap = riskCapUsd(rule, balance);
  if (cap === null) return "The risk per trade cannot be checked without a positive balance. Nothing was sent.";
  return risk.amount > cap ? tooMuch(rule, risk.amount, balance, cap, "This order") : null;
}

/**
 * Why changing the stop loss of an open trade or a waiting order is refused,
 * or null when it may go. `before` / `after` are null without a stop loss.
 * Removing a stop is refused; a stop that risks more than the cap is refused
 * only when it risks more than before (so tightening is always possible).
 */
export function changeRiskProblem(rule: TradeRiskRule | null, before: RiskAtStop | null, after: RiskAtStop | null, balance: number, what: "trade" | "order"): string | null {
  if (!rule) return null;
  if (before && !after) return `This account needs a stop loss on every ${what}: it can be moved, not removed. Nothing was sent.`;
  if (!after || rule.maxRiskPercent === undefined) return null;
  if (before && before.priced && after.priced && after.amount <= before.amount) return null;
  if (!after.priced) return "The risk at the new stop loss cannot be worked out in dollars yet: the server has no price to convert it. Try again in a moment. Nothing was sent.";
  const cap = riskCapUsd(rule, balance);
  if (cap === null) return null;
  return after.amount > cap ? tooMuch(rule, after.amount, balance, cap, what === "trade" ? "With this stop loss the trade" : "With this stop loss the order") : null;
}

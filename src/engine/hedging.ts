/**
 * FYNX trading engine: the optional "no hedging" rule.
 *
 * Many prop-firm agreements do not allow a buy and a sell trade on the same
 * pair at the same time (hedging). When an account's purchased rules carry
 * `hedging_allowed: false`, the engine:
 *
 * - refuses a new market order on a pair where a trade in the other
 *   direction is open (`hedging`, HTTP 409, nothing is sent);
 * - refuses a new pending order on such a pair too (it could only ever fill
 *   into a hedge);
 * - lets a pending order that was placed earlier wait without filling while a
 *   trade in the other direction is open on its pair ("held"): it stays in the
 *   book and fills on the first price after that trade closes, if its price is
 *   still reached. A fill is never turned into a hedge, and never refused or
 *   cancelled by the rule;
 * - never refuses closing, cancelling or changing stop loss / take profit.
 *
 * Two waiting orders in opposite directions (for example a buy stop above and
 * a sell stop below the price) are allowed: whichever fills first, the other
 * waits while that trade is open. Linking them "one cancels the other" removes
 * the second one instead.
 *
 * Missing rule = today's behaviour (hedging allowed, nothing changes).
 *
 * Pure: no clock, no I/O. The server and the terminal use the same functions.
 */

export type HedgeSide = "buy" | "sell";

/** True when the account's rules (RuleSet or snapshot `{ hedgingAllowed }`) forbid hedging. Only an explicit `false` does. */
export const noHedging = (src: { hedgingAllowed?: unknown } | null | undefined): boolean => src?.hedgingAllowed === false;

export const otherSide = (side: HedgeSide): HedgeSide => (side === "buy" ? "sell" : "buy");

export interface OppositeExposure {
  symbol: string;
  /** The direction of the open trades that block `side`. */
  side: HedgeSide;
  /** How many trades and lots are open in that direction. */
  trades: number;
  lots: number;
}

/**
 * The open trades on `symbol` in the direction opposite to `side`, or null
 * when there are none (so an order on `side` would not hedge).
 */
export function oppositeOpen(positions: readonly { symbol: string; side: HedgeSide; lots: number }[], symbol: string, side: HedgeSide): OppositeExposure | null {
  const other = otherSide(side);
  let trades = 0, cents = 0;
  for (const p of positions) {
    if (p.symbol !== symbol || p.side !== other) continue;
    trades += 1;
    cents += Math.round(p.lots * 100);
  }
  return trades ? { symbol, side: other, trades, lots: cents / 100 } : null;
}

const lotsText = (o: OppositeExposure) => `${o.trades} ${o.side} trade${o.trades === 1 ? "" : "s"} (${o.lots.toFixed(2)} lots)`;

/** The plain refusal for a new order that would hedge. */
export function hedgeMessage(side: HedgeSide, o: OppositeExposure): string {
  return `This account does not allow buy and sell trades on the same pair at once: ${o.symbol} has ${lotsText(o)} open, so a new ${side} order cannot be placed. Close the ${o.side} trade${o.trades === 1 ? "" : "s"} first, or add to ${o.trades === 1 ? "it" : "them"} with another ${o.side} order. Nothing was sent.`;
}

/** Why a new order is refused under the rule, or null when it may go. */
export function hedgeProblem(rules: { hedgingAllowed?: unknown } | null | undefined, positions: readonly { symbol: string; side: HedgeSide; lots: number }[], symbol: string, side: HedgeSide): string | null {
  if (!noHedging(rules)) return null;
  const o = oppositeOpen(positions, symbol, side);
  return o ? hedgeMessage(side, o) : null;
}

/** Whether a waiting order is held (does not fill) because a trade in the other direction is open on its pair. */
export function hedgeHoldsFill(rules: { hedgingAllowed?: unknown } | null | undefined, positions: readonly { symbol: string; side: HedgeSide; lots: number }[], order: { symbol: string; side: HedgeSide }): boolean {
  return noHedging(rules) && oppositeOpen(positions, order.symbol, order.side) !== null;
}

/** Plain description of the rule, e.g. for the terminal's Account tab. */
export const HEDGING_RULE_TEXT = "Not allowed: each pair can hold buy trades or sell trades, not both at once; a waiting order in the other direction does not fill until those trades are closed";

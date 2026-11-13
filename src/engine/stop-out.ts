/**
 * FYNX trading engine: the optional margin "stop out".
 *
 * Brokers protect an account from losing more than it holds: when the margin
 * level (equity ÷ margin in use × 100) falls to the stop-out level, open
 * trades are closed at the market, the one with the largest loss first, one
 * at a time, until the margin level is back above the level (or nothing is
 * open). When an account's purchased rules carry `stop_out_level` (a percent,
 * 10–100), the engine's timer step does exactly that, with the close reason
 * `stop_out`. It is not a rule breach: the account stays open, pending orders
 * keep waiting, and the loss limits are checked first (a breach closes
 * everything anyway).
 *
 * Only decided on fresh, tradable, fully priced figures (like the loss limits),
 * so a missing or stale price never closes a trade. New orders already need
 * free margin (margin level 100 % or more after the order), so an order the
 * server accepts can never be stopped out at once.
 *
 * Pure: no clock, no I/O. The server and the terminal use the same functions.
 */

export const STOP_OUT_MIN_PERCENT = 10;
export const STOP_OUT_MAX_PERCENT = 100;
/** The terminal starts warning when the margin level is within this multiple of the stop-out level. */
export const STOP_OUT_WARN_FACTOR = 2;

/** A stop-out level the engine accepts: a percent from 10 to 100, at most one decimal. */
export const validStopOut = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= STOP_OUT_MIN_PERCENT && v <= STOP_OUT_MAX_PERCENT && Math.round(v * 10) === v * 10;

const pct = (n: number) => `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;

/** Plain description of the rule, e.g. for the terminal's Account tab. */
export function stopOutRuleText(level: number): string {
  return `If the margin level falls to ${pct(level)}, trades are closed at the market, largest loss first, until it is above ${pct(level)} again`;
}

/** True when the margin level is at or below the stop-out level (no margin in use = never). */
export function stoppedOut(marginLevel: number | null, level: number | null | undefined): boolean {
  return validStopOut(level) && marginLevel !== null && Number.isFinite(marginLevel) && marginLevel <= level;
}

/**
 * Which open trade closes first: the largest loss in dollars (open P/L plus
 * swap), then the oldest, then by id so the order never depends on storage.
 */
export function stopOutFirst<T extends { id: string; openedAt: number }>(positions: readonly { position: T; result: number }[]): T | null {
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) => a.result - b.result || a.position.openedAt - b.position.openedAt || (a.position.id < b.position.id ? -1 : a.position.id > b.position.id ? 1 : 0));
  return sorted[0].position;
}

export interface StopOutNote {
  /** At or below the level: the server is closing trades. */
  reached: boolean;
  text: string;
}

/**
 * The terminal's sentence while the margin level is close to the stop-out
 * level (within STOP_OUT_WARN_FACTOR × the level), or null when it is far
 * away, no margin is in use, or the account has no stop-out rule.
 */
export function stopOutNote(marginLevel: number | null | undefined, level: number | null | undefined): StopOutNote | null {
  if (!validStopOut(level) || marginLevel === null || marginLevel === undefined || !Number.isFinite(marginLevel)) return null;
  if (marginLevel <= level) return { reached: true, text: `Margin level ${pct(marginLevel)} has reached the stop out at ${pct(level)}: the trading server closes trades at the market, largest loss first, until it is above ${pct(level)} again.` };
  if (marginLevel > level * STOP_OUT_WARN_FACTOR) return null;
  return { reached: false, text: `Margin level ${pct(marginLevel)}, close to the stop out at ${pct(level)}. If it falls that far, the trading server closes trades at the market, largest loss first. Closing or partly closing a trade raises it.` };
}

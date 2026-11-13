import { isMarketOpen, marketState, type Schedule, type TradingHours } from "./hours";

/**
 * FYNX trading engine: the optional "no weekend holding" rule.
 *
 * Some account agreements do not allow trades to be held over the weekend.
 * When an account's purchased rules say so (`weekend_holding: false`), the
 * engine closes that account's open trades a few minutes before the market
 * closes for the weekend, and refuses new market orders in those last minutes.
 *
 * "Weekend" means any market closure of a day or more (LONG_CLOSURE_MS): the
 * usual Friday-to-Sunday break, and a long holiday closure the provider
 * publishes in `closures`. Short breaks (a daily maintenance minute, an early
 * close that reopens within the day) do not count.
 *
 * Pure: no clock, no I/O. The server and the terminal use the same functions,
 * so they agree on the cutoff time.
 */

/** A closure at least this long counts as a weekend (24 hours). */
export const LONG_CLOSURE_MS = 24 * 3_600_000;
/** Minutes before the weekend close used when the agreement does not give its own. */
export const DEFAULT_WEEKEND_CLOSE_MINUTES = 15;
export const WEEKEND_CLOSE_MIN_MINUTES = 1;
export const WEEKEND_CLOSE_MAX_MINUTES = 240;

export interface WeekendCutoff {
  /** From this moment (UTC ms) open trades are closed and new market orders refused. */
  cutoffAt: number;
  /** When the market closes for the weekend. */
  closesAt: number;
  /** When it opens again; null when no reopening is known. */
  reopensAt: number | null;
}

/** Whether `minutes` is a valid weekend close distance (whole minutes, 1–240). */
export const validWeekendMinutes = (minutes: unknown): minutes is number =>
  typeof minutes === "number" && Number.isInteger(minutes) && minutes >= WEEKEND_CLOSE_MIN_MINUTES && minutes <= WEEKEND_CLOSE_MAX_MINUTES;

/**
 * The next weekend cutoff for an instrument while its market is open, or null
 * (market closed now, no hours = trades at all times, or the next close is
 * shorter than a day). Looks at the next few market closes, up to three weeks.
 */
export function weekendCutoff(hours: TradingHours | undefined, now: number, minutesBefore: number): WeekendCutoff | null {
  if (!hours || !validWeekendMinutes(minutesBefore) || !isMarketOpen(hours, now)) return null;
  let t = now;
  for (let guard = 0; guard < 30; guard++) {
    const closesAt = marketState(hours, t).nextChange;
    if (closesAt === null) return null;
    const reopensAt = marketState(hours, closesAt).nextChange;
    if (reopensAt === null || reopensAt - closesAt >= LONG_CLOSURE_MS) return { cutoffAt: closesAt - minutesBefore * 60_000, closesAt, reopensAt };
    t = reopensAt;
  }
  return null;
}

/** True from the cutoff until the market closes: trades must be flat, no new market orders. */
export function inWeekendCutoff(hours: TradingHours | undefined, now: number, minutesBefore: number | null | undefined): WeekendCutoff | null {
  if (minutesBefore === null || minutesBefore === undefined) return null;
  const c = weekendCutoff(hours, now, minutesBefore);
  return c && now >= c.cutoffAt ? c : null;
}

/**
 * The same cutoff from a published schedule (the server's `/v1/status`
 * `schedule`: open stretches for the next days), for the terminal. Null when
 * the market is closed now, or when the schedule does not show the end of the
 * current stretch with a following one (or the end of the period).
 */
export function weekendCutoffFromSchedule(schedule: Schedule | undefined, now: number, minutesBefore: number): WeekendCutoff | null {
  if (!schedule || !validWeekendMinutes(minutesBefore)) return null;
  const sessions = [...schedule.sessions].sort((a, b) => a.from - b.from);
  const i = sessions.findIndex(s => s.from <= now && now < s.to);
  if (i < 0) return null;
  for (let j = i; j < sessions.length; j++) {
    const next = sessions[j + 1];
    // The last stretch is cut at the end of the published period: its end is not a real close.
    if (!next) return null;
    if (next.from - sessions[j].to >= LONG_CLOSURE_MS) return { cutoffAt: sessions[j].to - minutesBefore * 60_000, closesAt: sessions[j].to, reopensAt: next.from };
  }
  return null;
}

/** "New EURUSD trades … Nothing was sent." — the engine's refusal message. */
export function weekendCloseMessage(symbol: string, c: WeekendCutoff, formatUtc: (ms: number) => string): string {
  return `This account may not hold trades over the weekend: open ${symbol} trades are closed from ${formatUtc(c.cutoffAt)}, before the market closes at ${formatUtc(c.closesAt)}${c.reopensAt ? `, and new trades open again after ${formatUtc(c.reopensAt)}` : ""}. Nothing was sent; pending orders can still be placed and fill after the reopen.`;
}

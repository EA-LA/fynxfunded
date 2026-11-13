import type { GatewayStatus } from '@/engine/gateway';
import { FOREX_HOURS } from '@/engine/hours';
import { validWeekendMinutes, weekendCutoff, weekendCutoffFromSchedule, type WeekendCutoff } from '@/engine/weekend';
import { localAt, untilLabel } from './market-hours';

/** How far ahead of the cutoff the order panel starts reminding (24 h), and when the reminder turns amber (1 h). */
export const WEEKEND_NOTE_AHEAD_MS = 24 * 3_600_000;
export const WEEKEND_WARN_AHEAD_MS = 3_600_000;

/** The account's "no weekend holding" minutes from the trading server's snapshot, or null (holding allowed or unknown). */
export function weekendRule(snapshot: { weekendClose?: { minutesBefore?: unknown } } | null | undefined): number | null {
  const m = snapshot?.weekendClose?.minutesBefore;
  return validWeekendMinutes(m) ? m : null;
}

/**
 * The next weekend cutoff for a pair: from the server's published schedule
 * (with holiday closures) when it has one, otherwise the standard forex week
 * the engine uses by default.
 */
export function pairWeekendCutoff(status: GatewayStatus | null | undefined, symbol: string, now: number, minutesBefore: number): WeekendCutoff | null {
  const schedule = status?.schedule?.[symbol];
  if (schedule) return weekendCutoffFromSchedule(schedule, now, minutesBefore);
  return weekendCutoff(FOREX_HOURS, now, minutesBefore);
}

export interface WeekendNote {
  /** From the cutoff to the close: open trades are closed, new market orders refused. */
  inCutoff: boolean;
  /** Within the hour before the cutoff (or inside it). */
  warn: boolean;
  text: string;
}

const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;

/** The order panel / Positions sentence about the weekend rule, or null when the cutoff is more than a day away. */
export function weekendNote(c: WeekendCutoff | null, minutesBefore: number, symbol: string, now: number, at: (ms: number) => string = localAt): WeekendNote | null {
  if (!c || c.cutoffAt - now > WEEKEND_NOTE_AHEAD_MS) return null;
  if (now >= c.cutoffAt) {
    return {
      inCutoff: true, warn: true,
      text: `This account may not hold trades over the weekend. Open ${symbol} trades are closed now, before the market closes at ${at(c.closesAt)} your time, and new market orders are refused${c.reopensAt ? ` until it opens again ${at(c.reopensAt)}` : ''}. Pending orders can still be placed; they fill after the reopen.`,
    };
  }
  return {
    inCutoff: false, warn: c.cutoffAt - now <= WEEKEND_WARN_AHEAD_MS,
    text: `No weekend holding on this account: open ${symbol} trades close automatically at ${at(c.cutoffAt)} your time (in ${untilLabel(c.cutoffAt - now)}), ${mins(minutesBefore)} before the market closes for the weekend. Close or keep them until then as you like.`,
  };
}

/** One line for the Account tab's rules list. */
export const weekendRuleText = (minutesBefore: number) => `Not allowed · open trades close ${mins(minutesBefore)} before the weekend close`;

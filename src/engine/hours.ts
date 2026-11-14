/**
 * FYNX trading engine: trading hours per instrument.
 *
 * Pure and deterministic: no Intl, no clock. Time zones are limited to UTC and
 * America/New_York (US daylight-saving rule built in), which is what forex
 * hours are defined in. A host gives each instrument a TradingHours value
 * (buildSpecs uses FOREX_HOURS by default) and can add closures for holidays
 * or provider outages. An instrument without `hours` trades at all times.
 */

export type HoursTimeZone = "UTC" | "America/New_York";

/** Minutes from Sunday 00:00 in the schedule's time zone (0 … 10080). */
export interface WeeklyWindow { from: number; to: number }

export interface Closure {
  /** Milliseconds since epoch (UTC), inclusive. */
  from: number;
  /** Milliseconds since epoch (UTC), exclusive. */
  to: number;
  /** Plain reason shown to the trader, e.g. "Christmas Day". */
  reason: string;
}

export interface TradingHours {
  timeZone: HoursTimeZone;
  /** When the market is open each week. Windows must not wrap past Saturday 24:00. */
  weekly: WeeklyWindow[];
  /** One-off closures (holidays, provider maintenance) supplied by the host. */
  closures?: Closure[];
}

export interface MarketState {
  open: boolean;
  /** When the market next opens (if closed) or closes (if open); null if it never changes. */
  nextChange: number | null;
  /** Why it is closed, null when open. */
  reason: string | null;
}

const DAY = 1440, WEEK = 7 * DAY, MINUTE = 60_000;

/** Day (0 = Sunday) and clock time to minutes from Sunday 00:00. */
export const weekMinute = (day: number, hour: number, minute = 0) => day * DAY + hour * 60 + minute;

/**
 * The forex week: Sunday 17:00 to Friday 17:00 New York time. That is 22:00
 * UTC in US winter and 21:00 UTC in US summer, the usual interbank week.
 * Brokers and price providers can publish different hours; pass theirs.
 */
export const FOREX_HOURS: TradingHours = { timeZone: "America/New_York", weekly: [{ from: weekMinute(0, 17), to: weekMinute(5, 17) }] };

/** Open at all times (e.g. for tests or 24/7 instruments). */
export const ALWAYS_OPEN: TradingHours = { timeZone: "UTC", weekly: [{ from: 0, to: WEEK }] };

/** US daylight time: second Sunday of March 02:00 local (07:00 UTC) to first Sunday of November 02:00 local (06:00 UTC). */
function usDaylight(utc: number): boolean {
  const y = new Date(utc).getUTCFullYear();
  const sunday = (month: number, n: number, hourUtc: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return Date.UTC(y, month, 1 + ((7 - first) % 7) + (n - 1) * 7, hourUtc);
  };
  return utc >= sunday(2, 2, 7) && utc < sunday(10, 1, 6);
}

/** Offset of the zone from UTC in minutes at this instant (New York: -240 or -300). */
export function zoneOffsetMinutes(zone: HoursTimeZone, utc: number): number {
  return zone === "UTC" ? 0 : usDaylight(utc) ? -240 : -300;
}

const toLocal = (zone: HoursTimeZone, utc: number) => utc + zoneOffsetMinutes(zone, utc) * MINUTE;
const toUtc = (zone: HoursTimeZone, local: number) => {
  const guess = local - zoneOffsetMinutes(zone, local) * MINUTE;
  return local - zoneOffsetMinutes(zone, guess) * MINUTE;
};

function check(hours: TradingHours) {
  for (const w of hours.weekly) {
    if (!(Number.isFinite(w.from) && Number.isFinite(w.to) && w.from >= 0 && w.to <= WEEK && w.from < w.to)) throw new RangeError("Trading-hours windows must satisfy 0 ≤ from < to ≤ 10080 minutes.");
  }
}

function weeklyOpen(hours: TradingHours, utc: number): boolean {
  const d = new Date(toLocal(hours.timeZone, utc));
  const m = weekMinute(d.getUTCDay(), d.getUTCHours(), d.getUTCMinutes()) + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / MINUTE;
  return hours.weekly.some(w => m >= w.from && m < w.to);
}

const closureAt = (hours: TradingHours, utc: number) => hours.closures?.find(c => utc >= c.from && utc < c.to) ?? null;

/** Whether the market is open at this instant. */
export function isMarketOpen(hours: TradingHours | undefined, utc: number): boolean {
  if (!hours) return true;
  return !closureAt(hours, utc) && weeklyOpen(hours, utc);
}

/** Open/closed now, why, and when that changes next (looks up to three weeks ahead). */
export function marketState(hours: TradingHours | undefined, now: number): MarketState {
  if (!hours) return { open: true, nextChange: null, reason: null };
  check(hours);
  const open = isMarketOpen(hours, now);
  const closure = closureAt(hours, now);
  const reason = open ? null : closure ? closure.reason : "Outside trading hours";
  const local = new Date(toLocal(hours.timeZone, now));
  const weekStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - local.getUTCDay());
  const candidates: number[] = [];
  for (let week = -1; week <= 3; week++) {
    for (const w of hours.weekly) {
      for (const m of [w.from, w.to]) candidates.push(toUtc(hours.timeZone, weekStart + week * WEEK * MINUTE + m * MINUTE));
    }
  }
  for (const c of hours.closures ?? []) candidates.push(c.from, c.to);
  const next = candidates.filter(t => t > now).sort((a, b) => a - b).find(t => isMarketOpen(hours, t) !== open) ?? null;
  return { open, nextChange: next, reason };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Sun 22:00 UTC" — a short, unambiguous label for messages. */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** One open stretch of a market, in UTC milliseconds ([from, to)). */
export interface Session { from: number; to: number }

/** A pair's trading hours for a period: when it is open, and the one-off closures that fall in it. */
export interface Schedule { sessions: Session[]; closures: Closure[] }

/**
 * When the market is open between `from` and `to` (UTC ms), as a list of open
 * stretches cut at the ends of the period (periods up to a few weeks), with the closures (holidays,
 * maintenance) that overlap it. No hours means open the whole period. Pure:
 * the same answer for the same input, so the server and the terminal agree.
 */
export function scheduleBetween(hours: TradingHours | undefined, from: number, to: number): Schedule {
  if (!(Number.isFinite(from) && Number.isFinite(to)) || to <= from) throw new RangeError("The schedule period must end after it starts.");
  if (!hours) return { sessions: [{ from, to }], closures: [] };
  check(hours);
  const sessions: Session[] = [];
  let t = from;
  for (let guard = 0; t < to && guard < 500; guard++) {
    const s = marketState(hours, t);
    const end = s.nextChange === null ? to : Math.min(s.nextChange, to);
    if (s.open) {
      const last = sessions[sessions.length - 1];
      if (last && last.to === t) last.to = end; else sessions.push({ from: t, to: end });
    }
    if (s.nextChange === null) break; // no change ahead: the state holds to the end of the period
    t = end;
  }
  const closures = (hours.closures ?? []).filter(c => c.to > from && c.from < to).map(c => ({ ...c })).sort((a, b) => a.from - b.from);
  return { sessions, closures };
}

import { DAILY_RESET_UTC_HOUR } from "@/lib/ruleCalculator";
import { fold, icsText } from "@/lib/payoutCalendar";

/**
 * Trading-day clock helpers. Everything is derived from the published rule
 * that the daily loss floor resets at 22:00 UTC all year round, and from the
 * hour buckets the dashboard journal uses to label trades by session.
 * No market hours or broker schedules are implied here.
 */

export type JournalSession = "Asia" | "London" | "New York";

/** UTC hour bands used by the dashboard to label a trade (by its open time). */
export const JOURNAL_SESSION_BANDS: { session: JournalSession; fromHour: number; toHour: number }[] = [
  { session: "Asia", fromHour: 0, toHour: 8 },
  { session: "London", fromHour: 8, toHour: 13 },
  { session: "New York", fromHour: 13, toHour: 24 },
];

/** Session label the trade journal gives to a trade opened at this UTC hour. */
export function journalSessionForUtcHour(hour: number): JournalSession {
  return hour < 8 ? "Asia" : hour < 13 ? "London" : "New York";
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The most recent daily reset at or before `now`. */
export function previousReset(now: Date): Date {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_RESET_UTC_HOUR));
  return reset.getTime() > now.getTime() ? new Date(reset.getTime() - DAY) : reset;
}

/** The next daily reset strictly after `now`. */
export function nextReset(now: Date): Date {
  return new Date(previousReset(now).getTime() + DAY);
}

export interface TradingDayStatus {
  /** When the current daily-floor period started. */
  periodStart: Date;
  /** When it ends (the next reset). */
  periodEnd: Date;
  msUntilReset: number;
  /** 0–1 share of the 24-hour period already elapsed. */
  elapsed: number;
  session: JournalSession;
}

export function tradingDayStatus(now: Date): TradingDayStatus {
  const periodStart = previousReset(now);
  const periodEnd = new Date(periodStart.getTime() + DAY);
  return {
    periodStart,
    periodEnd,
    msUntilReset: periodEnd.getTime() - now.getTime(),
    elapsed: (now.getTime() - periodStart.getTime()) / DAY,
    session: journalSessionForUtcHour(now.getUTCHours()),
  };
}

/** "5h 07m" / "42m 10s" style countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Offset label such as "UTC+3:30" or "UTC−5" for the given zone at `at`. */
export function utcOffsetLabel(at: Date, timeZone?: string): string {
  let raw: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
    raw = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT";
  } catch {
    // Older browsers without "longOffset": fall back to the visitor's own offset.
    const mins = -at.getTimezoneOffset();
    const abs = Math.abs(mins);
    raw = mins === 0 ? "GMT" : `GMT${mins < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  }
  if (raw === "GMT" || /^GMT[+-]00:00$/.test(raw)) return "UTC";
  const m = raw.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return raw.replace("GMT", "UTC");
  const hours = String(Number(m[2]));
  return `UTC${m[1] === "-" ? "−" : "+"}${hours}${m[3] === "00" ? "" : `:${m[3]}`}`;
}

/** Hour (0–23.99) of the day in UTC, used to place markers on a 24-hour bar. */
export const utcHourOfDay = (d: Date) => d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;

/**
 * Parse an `<input type="datetime-local">` value ("2026-11-04T17:30") as a
 * time in the visitor's own time zone. Returns null when empty or invalid.
 */
export function parseLocalDateTime(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as a `datetime-local` value in the visitor's time zone. */
export function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Reminder choices for the daily-reset calendar event, in minutes before the reset. */
export const RESET_REMINDER_OPTIONS = [0, 15, 30, 60] as const;
export type ResetReminder = (typeof RESET_REMINDER_OPTIONS)[number];

const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * iCalendar (.ics) file with one event that repeats every day at the 22:00 UTC
 * daily reset. Times are written in UTC, so calendar apps show the reset in
 * the viewer's own time and it never shifts with daylight saving.
 * `reminderMinutes` adds an alert that many minutes before (0 = no alert).
 */
export function dailyResetIcs(stamp: Date, reminderMinutes: ResetReminder = 0): string {
  const start = nextReset(stamp);
  const end = new Date(start.getTime() + 15 * 60_000);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FYNX Funded//Daily reset//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:fynx-daily-reset@fynxfunded.com",
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    "RRULE:FREQ=DAILY",
    `SUMMARY:${icsText(`FYNX Funded daily reset (${DAILY_RESET_UTC_HOUR}:00 UTC)`)}`,
    `DESCRIPTION:${icsText(`The daily loss floor resets at ${DAILY_RESET_UTC_HOUR}:00 UTC. A new trading day starts and trades closed after this time count toward the next day. https://www.fynxfunded.com/rules#trading-day`)}`,
    "TRANSP:TRANSPARENT",
  ];
  if (reminderMinutes > 0) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:-PT${reminderMinutes}M`, `DESCRIPTION:${icsText(`FYNX Funded daily reset in ${reminderMinutes} minutes`)}`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

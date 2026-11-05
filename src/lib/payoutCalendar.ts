/**
 * Published payout calendar: two request windows a month. Dates are worked out
 * in UTC so every visitor sees the same window. This is a planning aid only;
 * eligibility and the actual payment date are confirmed during review.
 */

export interface PayoutWindow {
  requestStart: Date;
  requestEnd: Date;
  payoutStart: Date;
  payoutEnd: Date;
}

export const PAYOUT_WINDOWS = [
  { requestFrom: 1, requestTo: 3, payoutFrom: 5, payoutTo: 7 },
  { requestFrom: 16, requestTo: 18, payoutFrom: 20, payoutTo: 22 },
] as const;

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));

function windowFor(year: number, month: number, index: number): PayoutWindow {
  const w = PAYOUT_WINDOWS[index];
  return {
    requestStart: utc(year, month, w.requestFrom),
    requestEnd: utc(year, month, w.requestTo),
    payoutStart: utc(year, month, w.payoutFrom),
    payoutEnd: utc(year, month, w.payoutTo),
  };
}

export interface PayoutWindowStatus {
  /** True when today (UTC) is inside a request window. */
  open: boolean;
  /** The window that is open now, or the next one to open. */
  window: PayoutWindow;
  /** Whole days until the window opens (0 when open). */
  daysUntilOpen: number;
  /** Whole days left including today when open, otherwise 0. */
  daysLeft: number;
  /** The window after this one, for planning ahead. */
  following: PayoutWindow;
}

const DAY_MS = 86_400_000;

export function payoutWindowStatus(now: Date): PayoutWindowStatus {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = utc(year, month, now.getUTCDate());
  const candidates = [
    windowFor(year, month, 0),
    windowFor(year, month, 1),
    windowFor(year, month + 1, 0),
    windowFor(year, month + 1, 1),
    windowFor(year, month + 2, 0),
  ];
  const index = candidates.findIndex((w) => w.requestEnd.getTime() >= today.getTime());
  const window = candidates[index];
  const open = window.requestStart.getTime() <= today.getTime();
  return {
    open,
    window,
    daysUntilOpen: open ? 0 : Math.round((window.requestStart.getTime() - today.getTime()) / DAY_MS),
    daysLeft: open ? Math.round((window.requestEnd.getTime() - today.getTime()) / DAY_MS) + 1 : 0,
    following: candidates[index + 1],
  };
}

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Nov 16 – 18" or "Nov 30 – Dec 2" style range. */
export function formatRange(start: Date, end: Date) {
  const a = monthDay.format(start);
  const b = monthDay.format(end);
  return start.getUTCMonth() === end.getUTCMonth() ? `${a} – ${end.getUTCDate()}` : `${a} – ${b}`;
}

/** "Nov 18" style day. */
export const formatDay = (date: Date) => monthDay.format(date);

const icsDate = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

const nextDay = (date: Date) => new Date(date.getTime() + DAY_MS);

/** Escapes iCalendar TEXT values (RFC 5545 §3.3.11). */
export const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/**
 * Folds long content lines (RFC 5545 §3.1 allows 75 octets). Folding at 60
 * characters keeps lines under the limit even with multi-byte dashes.
 */
export function fold(line: string): string {
  if (line.length <= 60) return line;
  const parts = [line.slice(0, 60)];
  for (let i = 60; i < line.length; i += 59) parts.push(` ${line.slice(i, i + 59)}`);
  return parts.join("\r\n");
}

/**
 * Builds an iCalendar (.ics) file with all-day reminders for the given request
 * windows so traders can add them to Google, Apple or Outlook calendars.
 * `stamp` is the creation time written into DTSTAMP.
 */
export function payoutWindowsIcs(windows: PayoutWindow[], stamp: Date): string {
  const dtstamp = `${icsDate(stamp)}T${String(stamp.getUTCHours()).padStart(2, "0")}${String(stamp.getUTCMinutes()).padStart(2, "0")}00Z`;
  const events = windows.flatMap((w) => [
    "BEGIN:VEVENT",
    `UID:fynx-payout-request-${icsDate(w.requestStart)}@fynxfunded.com`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${icsDate(w.requestStart)}`,
    // All-day DTEND is exclusive, so it is the day after the last request day.
    `DTEND;VALUE=DATE:${icsDate(nextDay(w.requestEnd))}`,
    `SUMMARY:${icsText(`FYNX Funded payout request window (${formatRange(w.requestStart, w.requestEnd)})`)}`,
    `DESCRIPTION:${icsText(`Request window for eligible funded accounts. Approved requests are scheduled for ${formatRange(w.payoutStart, w.payoutEnd)} (UTC). Eligibility and the final payment date are confirmed when your request is reviewed. https://www.fynxfunded.com/payouts#calendar`)}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ]);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FYNX Funded//Payout calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...events, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}

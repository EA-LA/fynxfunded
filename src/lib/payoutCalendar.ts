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

import type { DayClose } from "@/engine/types";

/**
 * Daily statement for a FYNX Trade account: the end-of-day records the
 * trading engine writes at each daily reset (`state.dayCloses`). Plain
 * figures only; nothing is estimated when the engine did not record it.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DailySummary {
  days: number;
  /** Days whose balance ended above / below / level with where it started. */
  up: number;
  down: number;
  flat: number;
  /** Sum of the days' balance changes. */
  net: number;
  best: { day: string; change: number } | null;
  worst: { day: string; change: number } | null;
  /** The smallest equity room above the loss limits at a day's close, when known. */
  closestCall: { day: string; room: number } | null;
  /** Days recorded after the reset because the engine was not running then. */
  late: number;
  firstDay: string | null;
  lastDay: string | null;
}

/** Balance change of one day (closing minus starting balance). */
export const dayChange = (d: Pick<DayClose, "startBalance" | "closingBalance">) => round2(d.closingBalance - d.startBalance);

/** Newest first, one per trading day (the newest record wins if a day appears twice). */
export function sortedDays(closes: readonly DayClose[] | undefined): DayClose[] {
  const seen = new Set<string>();
  return [...(closes ?? [])].sort((a, b) => b.tradingDay.localeCompare(a.tradingDay) || b.recordedAt - a.recordedAt).filter(d => !seen.has(d.tradingDay) && !!seen.add(d.tradingDay));
}

export function dailySummary(closes: readonly DayClose[] | undefined): DailySummary {
  const days = sortedDays(closes);
  let up = 0, down = 0, flat = 0, net = 0, late = 0;
  let best: DailySummary["best"] = null, worst: DailySummary["worst"] = null, closest: DailySummary["closestCall"] = null;
  for (const d of days) {
    const c = dayChange(d);
    net += c;
    if (c > 0) up++; else if (c < 0) down++; else flat++;
    if (c > 0 && (!best || c > best.change)) best = { day: d.tradingDay, change: c };
    if (c < 0 && (!worst || c < worst.change)) worst = { day: d.tradingDay, change: c };
    if (d.roomAtClose !== null && (!closest || d.roomAtClose < closest.room)) closest = { day: d.tradingDay, room: d.roomAtClose };
    if (d.late) late++;
  }
  return { days: days.length, up, down, flat, net: round2(net), best, worst, closestCall: closest, late, firstDay: days.at(-1)?.tradingDay ?? null, lastDay: days[0]?.tradingDay ?? null };
}

/** "Tue 10 Nov" style label for a trading-day key, in UTC (the key is a date, not a moment). */
export function dayLabel(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** When the trading day `day` ended (its reset), in ms. */
export const dayEndsAt = (day: string, resetHourUtc: number) => Date.parse(`${day}T00:00:00Z`) + (24 + resetHourUtc) * 3_600_000;

function field(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const DAILY_HEADERS = ["Trading day", "Ended (UTC)", "Start balance (USD)", "Closing balance (USD)", "Change (USD)", "Closing equity (USD)", "Closed trades", "Closed result (USD)", "Daily loss level (USD)", "Maximum loss level (USD)", "Room above limits at close (USD)", "Positions held overnight", "Lots held", "Swap at rollover (USD)", "Status", "Recorded late"];

/** CSV of the daily statement, oldest day first, with totals at the end. */
export function dailyStatementCsv(accountId: string, closes: readonly DayClose[] | undefined, resetHourUtc = 22): string {
  const days = sortedDays(closes).reverse();
  const rows: (string | number | null)[][] = [DAILY_HEADERS];
  for (const d of days) rows.push([d.tradingDay, new Date(dayEndsAt(d.tradingDay, resetHourUtc)).toISOString().replace(".000Z", "Z"), d.startBalance, d.closingBalance, dayChange(d), d.closingEquity, d.trades, d.closedResult, d.dailyLossFloor, d.maxLossFloor, d.roomAtClose, d.openPositions, d.openLots, d.swapAtRollover, d.status, d.late ? "yes" : "no"]);
  const s = dailySummary(closes);
  rows.push([]);
  rows.push(["Account", accountId], ["Trading days", s.days], ["Up days", s.up], ["Down days", s.down], ["Flat days", s.flat], ["Net change (USD)", s.net]);
  rows.push(["Source", "FYNX Trade trading server end-of-day records"]);
  return rows.map(r => r.map(field).join(",")).join("\r\n") + "\r\n";
}

export function dailyStatementFileName(accountId: string, now: number): string {
  return `fynx-trade-daily-${accountId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "account"}-${new Date(now).toISOString().slice(0, 10)}.csv`;
}

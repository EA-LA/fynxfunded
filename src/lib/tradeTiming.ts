import type { Trade } from "@/lib/tradingData";
import { previousReset } from "@/lib/tradingDayClock";
import { checkConsistency, type ConsistencyResult } from "@/lib/ruleCalculator";

/**
 * Read-only views of recorded closed trades grouped by time: weekday, hour of
 * day and trading day (the 22:00 UTC daily reset). Nothing here changes how an
 * evaluation is scored; it only re-groups the trades the journal already shows.
 */

export type TimeZoneMode = "local" | "utc";
export const TIME_ZONE_STORAGE_KEY = "fynx.tradeTimeZone";

export function readTimeZoneMode(): TimeZoneMode {
  try { return globalThis.localStorage?.getItem(TIME_ZONE_STORAGE_KEY) === "utc" ? "utc" : "local"; } catch { return "local"; }
}
export function saveTimeZoneMode(mode: TimeZoneMode) {
  try { globalThis.localStorage?.setItem(TIME_ZONE_STORAGE_KEY, mode); } catch { /* storage unavailable: keep the in-page choice */ }
}

/** Short name of the viewer's time zone, e.g. "GMT+1" or "PST"; "UTC" in UTC mode. */
export function timeZoneLabel(mode: TimeZoneMode, at: Date = new Date()): string {
  if (mode === "utc") return "UTC";
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(at).find(p => p.type === "timeZoneName");
    return part?.value || "local time";
  } catch { return "local time"; }
}

/** "Nov 3, 10:05" in the chosen zone; "—" for a missing or invalid time. */
export function formatTradeTime(iso: string, mode: TimeZoneMode): string {
  const ms = Date.parse(iso);
  if (!iso || !Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(mode === "utc" ? { timeZone: "UTC" } : {}),
  }).format(new Date(ms));
}

/** The moment used to place a trade in a weekday/hour bucket: when it was opened (or closed, if no open time). */
export const tradeMoment = (t: Trade) => Date.parse(t.openTime) || Date.parse(t.closeTime);

export interface TimingBucket {
  key: number;
  label: string;
  count: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function bucketize(trades: Trade[], size: number, keyOf: (d: Date) => number, labelOf: (k: number) => string): TimingBucket[] {
  const buckets: TimingBucket[] = Array.from({ length: size }, (_, key) => ({ key, label: labelOf(key), count: 0, wins: 0, losses: 0, pnl: 0, winRate: 0 }));
  for (const t of trades) {
    const ms = tradeMoment(t);
    if (!Number.isFinite(ms)) continue;
    const b = buckets[keyOf(new Date(ms))];
    b.count++; b.pnl += t.pnl;
    if (t.pnl > 0) b.wins++; else if (t.pnl < 0) b.losses++;
  }
  return buckets.map(b => ({ ...b, pnl: round2(b.pnl), winRate: b.count ? round2((b.wins / b.count) * 100) : 0 }));
}

/** Monday-first weekday buckets in the chosen zone. */
export function performanceByWeekday(trades: Trade[], mode: TimeZoneMode): TimingBucket[] {
  return bucketize(trades, 7, d => ((mode === "utc" ? d.getUTCDay() : d.getDay()) + 6) % 7, k => WEEKDAY_LABELS[k]);
}

/** 24 hour-of-day buckets (00–23) in the chosen zone. */
export function performanceByHour(trades: Trade[], mode: TimeZoneMode): TimingBucket[] {
  return bucketize(trades, 24, d => (mode === "utc" ? d.getUTCHours() : d.getHours()), k => `${String(k).padStart(2, "0")}:00`);
}

/** Minimum trades in a bucket before it is called out as a "best" or "weakest" time. */
export const MIN_SAMPLE = 3;

export interface TimingHighlights {
  best: TimingBucket | null;
  worst: TimingBucket | null;
  /** True when no bucket reaches MIN_SAMPLE trades. */
  smallSample: boolean;
}

export function timingHighlights(buckets: TimingBucket[]): TimingHighlights {
  const eligible = buckets.filter(b => b.count >= MIN_SAMPLE);
  if (!eligible.length) return { best: null, worst: null, smallSample: buckets.some(b => b.count > 0) };
  const byPnl = eligible.slice().sort((a, b) => b.pnl - a.pnl || b.count - a.count);
  const best = byPnl[0].pnl > 0 ? byPnl[0] : null;
  const last = byPnl[byPnl.length - 1];
  const worst = last.pnl < 0 && last !== best ? last : null;
  return { best, worst, smallSample: false };
}

export interface TradingDayResult {
  /** UTC start of the trading day (the 22:00 UTC reset that opened it). */
  start: string;
  /** Calendar date the trading day mostly falls on (the day after the 22:00 reset), YYYY-MM-DD. */
  date: string;
  count: number;
  pnl: number;
}

const DAY_MS = 86_400_000;

/**
 * Closed P/L per trading day. A trading day runs from 22:00 UTC to the next
 * 22:00 UTC, matching the daily loss reset; trades count on the day they closed.
 * Oldest first.
 */
export function pnlByTradingDay(trades: Trade[]): TradingDayResult[] {
  const days = new Map<number, TradingDayResult>();
  for (const t of trades) {
    const ms = Date.parse(t.closeTime);
    if (!Number.isFinite(ms)) continue;
    const start = previousReset(new Date(ms)).getTime();
    const day = days.get(start) ?? { start: new Date(start).toISOString(), date: new Date(start + DAY_MS).toISOString().slice(0, 10), count: 0, pnl: 0 };
    day.count++; day.pnl += t.pnl;
    days.set(start, day);
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => ({ ...d, pnl: round2(d.pnl) }));
}

export interface TradingDaySummary {
  days: number;
  greenDays: number;
  redDays: number;
  flatDays: number;
  bestDay: TradingDayResult | null;
  worstDay: TradingDayResult | null;
  averageDay: number;
  /** Best-day share of total profit, using the same arithmetic as the published 40% rule. */
  consistency: ConsistencyResult;
}

export function summarizeTradingDays(days: TradingDayResult[]): TradingDaySummary {
  const sorted = days.slice().sort((a, b) => b.pnl - a.pnl);
  const total = days.reduce((s, d) => s + d.pnl, 0);
  return {
    days: days.length,
    greenDays: days.filter(d => d.pnl > 0).length,
    redDays: days.filter(d => d.pnl < 0).length,
    flatDays: days.filter(d => d.pnl === 0).length,
    bestDay: sorted[0] && sorted[0].pnl > 0 ? sorted[0] : null,
    worstDay: sorted.length && sorted[sorted.length - 1].pnl < 0 ? sorted[sorted.length - 1] : null,
    averageDay: days.length ? round2(total / days.length) : 0,
    consistency: checkConsistency(days.map(d => d.pnl)),
  };
}

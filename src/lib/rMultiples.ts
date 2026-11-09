import type { Trade } from "@/lib/tradingData";

/**
 * R-multiple distribution: each closed trade's result measured in units of the
 * risk it took at entry (1R = the dollars its entry stop loss put at risk).
 * Only trades that recorded that risk count; nothing is estimated for the rest.
 */
export interface RBucket { key: string; label: string; min: number; max: number; count: number; share: number }
export interface RSummary {
  /** Trades with a recorded result in R. */
  count: number;
  /** All trades given. */
  total: number;
  buckets: RBucket[];
  /** Mean result in R (expectancy in R); null without data. */
  average: number | null;
  median: number | null;
  best: number | null;
  worst: number | null;
  /** Losses that went past −1R (gap, slippage or costs beyond the stop). */
  beyondStop: number;
  /** Trades that made at least 2R. */
  twoROrMore: number;
  /** Total result in R. */
  sum: number;
  /** Plain-language reading; null below R_MIN_TRADES. */
  note: string | null;
}

export const R_MIN_TRADES = 5;

const EDGES: Array<[string, string, number, number]> = [
  ["lt-2", "−2R or worse", -Infinity, -2],
  ["-2to-1", "−2R to −1R", -2, -1],
  ["-1to0", "−1R to 0", -1, 0],
  ["0to1", "0 to +1R", 0, 1],
  ["1to2", "+1R to +2R", 1, 2],
  ["2to3", "+2R to +3R", 2, 3],
  ["ge3", "+3R or more", 3, Infinity],
];

/** Bucket for one value: lower edge inclusive except that exactly −1R counts as a full stop (−2R to −1R) and 0 as flat (0 to +1R). */
export function rBucketKey(r: number): string {
  if (r <= -2) return "lt-2";
  if (r <= -1) return "-2to-1";
  if (r < 0) return "-1to0";
  if (r < 1) return "0to1";
  if (r < 2) return "1to2";
  if (r < 3) return "2to3";
  return "ge3";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const formatR = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`;

export function rMultipleSummary(trades: Trade[]): RSummary {
  const values = trades.map(t => t.rMultiple).filter((r): r is number => typeof r === "number" && Number.isFinite(r));
  const counts: Record<string, number> = {};
  for (const r of values) counts[rBucketKey(r)] = (counts[rBucketKey(r)] ?? 0) + 1;
  const buckets = EDGES.map(([key, label, min, max]) => ({ key, label, min, max, count: counts[key] ?? 0, share: values.length ? round2(((counts[key] ?? 0) / values.length) * 100) : 0 }));
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = round2(values.reduce((a, b) => a + b, 0));
  const average = n ? round2(sum / n) : null;
  const median = n ? round2(n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
  const beyondStop = values.filter(r => r < -1).length;
  const twoROrMore = values.filter(r => r >= 2).length;
  let note: string | null = null;
  if (n >= R_MIN_TRADES && average !== null) {
    const edge = average > 0 ? `On average each trade made ${formatR(average)}: a positive edge in risk terms.` : average < 0 ? `On average each trade lost ${formatR(average).replace("−", "")}: the trades lose more than they make per unit of risk.` : "On average the trades broke even in risk terms.";
    const stops = beyondStop ? ` ${beyondStop} loss${beyondStop === 1 ? "" : "es"} went past −1R (price gapped or costs added to the stop).` : " No loss went past the planned −1R.";
    note = edge + stops;
  }
  return { count: n, total: trades.length, buckets, average, median, best: n ? sorted[n - 1] : null, worst: n ? sorted[0] : null, beyondStop, twoROrMore, sum, note };
}

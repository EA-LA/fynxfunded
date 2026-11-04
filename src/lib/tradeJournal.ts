import type { Trade } from "@/lib/tradingData";

/** Filters, sorting and summary for the dashboard trade journal. Read-only views of recorded trades. */

export interface JournalFilters {
  symbol: string;
  result: "" | Trade["result"];
  side: "" | Trade["type"];
  session: "" | Trade["session"];
}

export const EMPTY_FILTERS: JournalFilters = { symbol: "", result: "", side: "", session: "" };

export type SortKey = "closeTime" | "symbol" | "lots" | "pips" | "pnl" | "riskPercent" | "rr";
export interface JournalSort { key: SortKey; dir: "asc" | "desc" }
export const DEFAULT_SORT: JournalSort = { key: "closeTime", dir: "desc" };

export const hasActiveFilters = (f: JournalFilters) => Boolean(f.symbol.trim() || f.result || f.side || f.session);

export function filterTrades(trades: Trade[], f: JournalFilters): Trade[] {
  const q = f.symbol.trim().toLowerCase();
  return trades.filter(t =>
    (!q || t.symbol.toLowerCase().includes(q)) &&
    (!f.result || t.result === f.result) &&
    (!f.side || t.type === f.side) &&
    (!f.session || t.session === f.session));
}

export function sortTrades(trades: Trade[], sort: JournalSort): Trade[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (t: Trade) => (sort.key === "closeTime" ? Date.parse(t.closeTime) || 0 : t[sort.key]);
  return trades.slice().sort((a, b) => {
    const va = value(a), vb = value(b);
    const cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : Number(va) - Number(vb);
    return cmp !== 0 ? cmp * sign : (Date.parse(b.closeTime) || 0) - (Date.parse(a.closeTime) || 0);
  });
}

/** Clicking the active column flips direction; a new column starts high-to-low (A–Z for symbols). */
export function nextSort(current: JournalSort, key: SortKey): JournalSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "symbol" ? "asc" : "desc" };
}

export interface JournalSummary {
  count: number;
  netPnl: number;
  winRate: number;
  volume: number;
  wins: number;
  losses: number;
  breakeven: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeTrades(trades: Trade[]): JournalSummary {
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const sum = (list: Trade[]) => list.reduce((s, t) => s + t.pnl, 0);
  return {
    count: trades.length,
    netPnl: round2(sum(trades)),
    winRate: trades.length ? round2((wins.length / trades.length) * 100) : 0,
    volume: round2(trades.reduce((s, t) => s + t.lots, 0)),
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    averageWin: wins.length ? round2(sum(wins) / wins.length) : 0,
    averageLoss: losses.length ? round2(sum(losses) / losses.length) : 0,
    largestWin: wins.length ? round2(Math.max(...wins.map(t => t.pnl))) : 0,
    largestLoss: losses.length ? round2(Math.min(...losses.map(t => t.pnl))) : 0,
  };
}

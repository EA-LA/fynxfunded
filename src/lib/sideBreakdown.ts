import type { Trade } from "@/lib/tradingData";

/** Results of long (Buy) and short (Sell) trades, computed the same way as the account's overall win rate. */
export interface SideStats {
  count: number;
  pnl: number;
  wins: number;
  losses: number;
  /** Wins ÷ all trades on this side, like the account win rate (0 when there are none). */
  winRate: number;
  /** Average result per trade. */
  average: number;
  /** Share of the account's trades on this side (percent). */
  share: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function stats(list: Trade[], total: number): SideStats {
  const pnl = round2(list.reduce((s, t) => s + (Number.isFinite(t.pnl) ? t.pnl : 0), 0));
  const wins = list.filter((t) => t.pnl > 0).length;
  const losses = list.filter((t) => t.pnl < 0).length;
  return {
    count: list.length,
    pnl,
    wins,
    losses,
    winRate: list.length ? round2((wins / list.length) * 100) : 0,
    average: list.length ? round2(pnl / list.length) : 0,
    share: total ? round2((list.length / total) * 100) : 0,
  };
}

export interface SideBreakdown {
  long: SideStats;
  short: SideStats;
  /** Plain-language comparison, only when each side has at least 3 trades. */
  note: string | null;
}

export const SIDE_MIN_TRADES = 3;

export function sideBreakdown(trades: Trade[]): SideBreakdown {
  const longs = trades.filter((t) => t.type === "Buy");
  const shorts = trades.filter((t) => t.type === "Sell");
  const total = longs.length + shorts.length;
  const long = stats(longs, total);
  const short = stats(shorts, total);
  let note: string | null = null;
  if (long.count >= SIDE_MIN_TRADES && short.count >= SIDE_MIN_TRADES) {
    const diff = round2(long.average - short.average);
    if (diff === 0) note = "Long and short trades average the same result.";
    else {
      const better = diff > 0 ? "Long" : "Short";
      const worse = diff > 0 ? "short" : "long";
      note = `${better} trades average ${money(Math.abs(diff))} more per trade than ${worse} trades.`;
    }
  }
  return { long, short, note };
}

const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

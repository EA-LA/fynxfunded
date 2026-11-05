import type { Trade } from "@/lib/tradingData";
import { REWARD_RATIOS } from "@/lib/riskPlanner";
import { TRADES_PER_DAY } from "@/lib/challengeSimulator";
import { pnlByTradingDay } from "@/lib/tradeTiming";
import { challengeConfigs } from "@/lib/challengeConfig";

/**
 * Turns a trader's own closed-trade record into the simplified plan the pass
 * simulator understands (fixed risk, fixed reward, fixed win rate). This is a
 * summary of past results for an educational "what if"; it is never used to
 * evaluate an account.
 */

/** Wins + losses needed before the record is used at all. */
export const JOURNAL_MIN_DECISIVE_TRADES = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const SUPPORTED_ACCOUNT_SIZES = challengeConfigs.map((c) => c.accountSize);

export type RewardFit = "exact" | "roundedDown" | "flattering";

export interface JournalPlan {
  ready: boolean;
  /** Plain-language reason when not ready. */
  reason: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Wins ÷ (wins + losses), in percent, 2 decimals. */
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** Average win ÷ average loss. */
  payoff: number;
  /** The simulator reward option used for this record. */
  rewardRatio: number;
  rewardFit: RewardFit;
  /** Average loss as a % of the recorded account size, or null when the size is unknown. */
  riskPercent: number | null;
  tradingDays: number;
  /** Wins + losses per trading day, 2 decimals. */
  tradesPerDayActual: number;
  /** Nearest simulator option. */
  tradesPerDay: number;
}

/** Largest offered reward that does not overstate the record; 1:1 (flattering) when the payoff is below 1. */
export function fitRewardRatio(payoff: number): { rewardRatio: number; rewardFit: RewardFit } {
  const options = [...REWARD_RATIOS].sort((a, b) => b - a);
  const fit = options.find((r) => r <= payoff + 0.005);
  if (fit === undefined) return { rewardRatio: options[options.length - 1], rewardFit: "flattering" };
  return { rewardRatio: fit, rewardFit: Math.abs(fit - payoff) < 0.05 ? "exact" : "roundedDown" };
}

/** Nearest offered trades-per-day option (ties go to the lower one). */
export function nearestTradesPerDay(actual: number): number {
  let best: number = TRADES_PER_DAY[0];
  for (const option of TRADES_PER_DAY) {
    if (Math.abs(option - actual) < Math.abs(best - actual) - 1e-9) best = option;
  }
  return best;
}

export function journalPlan(trades: Trade[], accountSize: number): JournalPlan {
  const winning = trades.filter((t) => t.pnl > 0);
  const losing = trades.filter((t) => t.pnl < 0);
  const wins = winning.length;
  const losses = losing.length;
  const decisive = wins + losses;
  const avgWin = wins ? round2(winning.reduce((s, t) => s + t.pnl, 0) / wins) : 0;
  const avgLoss = losses ? round2(Math.abs(losing.reduce((s, t) => s + t.pnl, 0)) / losses) : 0;
  const payoff = avgLoss > 0 ? round2(avgWin / avgLoss) : 0;
  const tradingDays = pnlByTradingDay(trades.filter((t) => t.pnl !== 0)).length;
  const tradesPerDayActual = tradingDays ? round2(decisive / tradingDays) : 0;
  const { rewardRatio, rewardFit } = fitRewardRatio(payoff);
  const rawRiskPercent = accountSize > 0 && avgLoss > 0 ? round2((avgLoss / accountSize) * 100) : 0;
  const riskPercent = rawRiskPercent >= 0.01 ? rawRiskPercent : null;

  let reason = "";
  if (decisive < JOURNAL_MIN_DECISIVE_TRADES) {
    reason = `This needs at least ${JOURNAL_MIN_DECISIVE_TRADES} winning or losing closed trades in the selected period (you have ${decisive}).`;
  } else if (!wins || !losses) {
    reason = "This needs at least one winning and one losing trade to measure an average win and an average loss.";
  }

  return {
    ready: reason === "",
    reason,
    trades: trades.length,
    wins,
    losses,
    breakeven: trades.length - decisive,
    winRate: decisive ? round2((wins / decisive) * 100) : 0,
    avgWin,
    avgLoss,
    payoff,
    rewardRatio,
    rewardFit,
    riskPercent,
    tradingDays,
    tradesPerDayActual,
    tradesPerDay: nearestTradesPerDay(tradesPerDayActual),
  };
}

/** Risk per trade in dollars on the chosen account size: same % of the account as the record when known, else the recorded average loss. */
export function journalRiskAmount(plan: JournalPlan, accountSize: number): number {
  if (plan.riskPercent !== null) return round2((accountSize * plan.riskPercent) / 100);
  return plan.avgLoss;
}

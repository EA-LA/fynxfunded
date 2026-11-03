import { challengeConfigs } from "@/lib/challengeConfig";
import { getRulePlan, PROGRAMS, type ProgramId } from "@/lib/ruleCalculator";

/**
 * Educational payout illustration based on the published profit-split schedule.
 * It does not decide eligibility or amounts: every request is reviewed and the
 * terms recorded with the purchase always apply.
 */

export const MINIMUM_PAYOUT_USD = 50;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PayoutEstimate {
  accountSize: number;
  program: ProgramId;
  splitPercent: number;
  profit: number;
  profitPercentOfAccount: number;
  traderShare: number;
  firmShare: number;
  meetsMinimum: boolean;
  /** Profit needed for the trader share to reach the minimum payout amount. */
  profitForMinimum: number;
}

export function estimatePayout(accountSize: number, program: ProgramId, profit: number): PayoutEstimate {
  const { profitSplitPercent: splitPercent } = getRulePlan(accountSize, program);
  const safeProfit = Number.isFinite(profit) && profit > 0 ? round2(profit) : 0;
  const traderShare = round2((safeProfit * splitPercent) / 100);
  return {
    accountSize,
    program,
    splitPercent,
    profit: safeProfit,
    profitPercentOfAccount: round2((safeProfit / accountSize) * 100),
    traderShare,
    firmShare: round2(safeProfit - traderShare),
    meetsMinimum: traderShare >= MINIMUM_PAYOUT_USD,
    profitForMinimum: round2(Math.ceil(((MINIMUM_PAYOUT_USD * 100) / splitPercent) * 100) / 100),
  };
}

export interface SplitRow {
  accountSize: number;
  label: string;
  splits: Record<ProgramId, number>;
}

/** Profit split for every published account size and program. */
export function splitTable(): SplitRow[] {
  return challengeConfigs.map((c) => ({
    accountSize: c.accountSize,
    label: c.label,
    splits: Object.fromEntries(PROGRAMS.map((p) => [p, getRulePlan(c.accountSize, p).profitSplitPercent])) as Record<ProgramId, number>,
  }));
}

export function splitRange() {
  const all = splitTable().flatMap((r) => Object.values(r.splits));
  return { min: Math.min(...all), max: Math.max(...all) };
}

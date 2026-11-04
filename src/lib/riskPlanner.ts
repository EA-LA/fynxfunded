import { CONSISTENCY_LIMIT_PERCENT, type RulePlan } from "@/lib/ruleCalculator";

/**
 * Educational risk and pace arithmetic built on the published schedule. It does
 * not size positions for any instrument and does not predict results; it only
 * shows how a chosen dollar risk per trade fits inside the loss limits and how
 * a profit target spreads over trading days under the consistency rule.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
// Guards floor() against binary rounding (e.g. 1250 / 125 = 9.999999…).
const safeFloor = (n: number) => Math.floor(n + 1e-9);

export type RiskMode = "percent" | "dollars";

export interface RiskPlanInput {
  plan: RulePlan;
  /** 1-based phase; clamped to the program's phase count. */
  phase: number;
  riskMode: RiskMode;
  /** Percent of the account size or a dollar amount, depending on riskMode. */
  riskValue: number;
  /** Planned reward per winning trade as a multiple of the risk (e.g. 2 means 2:1). */
  rewardRatio: number;
  /** How many trading days the trader wants to spread the target over. */
  plannedDays: number;
}

export interface RiskPlan {
  phase: number;
  riskAmount: number;
  riskPercent: number;
  dailyAllowance: number;
  maxAllowance: number;
  /** Full losing trades that still keep equity at or above the floor. */
  lossesToDailyFloor: number;
  lossesToMaxFloor: number;
  /** Full daily-limit days that fit inside the static maximum loss. */
  worstDaysToMaxFloor: number;
  /** A single full loss would go past today's daily floor. */
  exceedsDailyAllowance: boolean;
  targetProfit: number;
  rewardPerWin: number;
  /** Winning trades needed to reach the target if there were no losing trades. */
  winsNeededWithoutLosses: number;
  /** Win rate at which this risk/reward breaks even before trading charges. */
  breakEvenWinRate: number;
  /** Fewest days that satisfy both the minimum-days rule and the 40% best-day rule. */
  minimumDays: number;
  /** Planned days, raised to the minimum when needed. */
  days: number;
  plannedDaysRaised: boolean;
  averagePerDay: number;
  /** Largest single day that still fits the consistency rule if the phase ends exactly at the target. */
  bestDayCap: number;
}

/** Days needed for the best day to fit under the consistency limit when every day is equal. */
export const consistencyMinimumDays = (limitPercent = CONSISTENCY_LIMIT_PERCENT) => Math.ceil(100 / limitPercent);

export function planRisk(input: RiskPlanInput): RiskPlan {
  const { plan } = input;
  if (!(input.riskValue > 0) || !Number.isFinite(input.riskValue)) throw new Error("Risk must be a positive number");
  if (!(input.rewardRatio > 0) || !Number.isFinite(input.rewardRatio)) throw new Error("Reward ratio must be a positive number");

  const phase = Math.min(Math.max(1, Math.trunc(input.phase) || 1), plan.phases.length);
  const riskAmount = round2(input.riskMode === "percent" ? (plan.accountSize * input.riskValue) / 100 : input.riskValue);
  if (!(riskAmount > 0)) throw new Error("Risk must be at least one cent");
  const riskPercent = round2((riskAmount / plan.accountSize) * 100);
  const dailyAllowance = round2((plan.accountSize * plan.dailyLossPercent) / 100);
  const maxAllowance = plan.maxLossAmount;
  const targetProfit = plan.phases[phase - 1].targetProfit;
  const rewardPerWin = round2(riskAmount * input.rewardRatio);

  const minimumDays = Math.max(plan.minDays, consistencyMinimumDays());
  const requested = Number.isFinite(input.plannedDays) ? Math.max(1, Math.trunc(input.plannedDays)) : minimumDays;
  const days = Math.max(requested, minimumDays);

  return {
    phase,
    riskAmount,
    riskPercent,
    dailyAllowance,
    maxAllowance,
    lossesToDailyFloor: safeFloor(dailyAllowance / riskAmount),
    lossesToMaxFloor: safeFloor(maxAllowance / riskAmount),
    worstDaysToMaxFloor: safeFloor(maxAllowance / dailyAllowance),
    exceedsDailyAllowance: riskAmount > dailyAllowance,
    targetProfit,
    rewardPerWin,
    winsNeededWithoutLosses: Math.ceil(targetProfit / rewardPerWin - 1e-9),
    breakEvenWinRate: round2(100 / (1 + input.rewardRatio)),
    minimumDays,
    days,
    plannedDaysRaised: requested < minimumDays,
    averagePerDay: round2(targetProfit / days),
    bestDayCap: round2((targetProfit * CONSISTENCY_LIMIT_PERCENT) / 100),
  };
}

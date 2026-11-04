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

/** Reward multiples offered by the planner. */
export const REWARD_RATIOS = [1, 1.5, 2, 3] as const;

export interface RiskPreset {
  riskMode: RiskMode;
  /** Kept as text so the input shows exactly what was shared. */
  riskInput: string;
  rewardRatio: number;
  daysInput: string;
}

export const DEFAULT_RISK_PRESET: RiskPreset = { riskMode: "percent", riskInput: "0.5", rewardRatio: 2, daysInput: "10" };

/**
 * Reads the planner's own choices from a shared address, e.g.
 * /rules?size=50000&program=2-phase&risk=250&unit=usd&rr=1.5&days=12#risk-planner.
 * Anything missing or out of range falls back to the default.
 */
export function parseRiskPreset(params: URLSearchParams): RiskPreset {
  const riskMode: RiskMode = params.get("unit") === "usd" ? "dollars" : "percent";
  const rawRisk = params.get("risk");
  const risk = Number(rawRisk);
  const riskOk = rawRisk !== null && rawRisk.trim() !== "" && Number.isFinite(risk) && risk > 0 && (riskMode === "dollars" ? risk <= 10_000_000 : risk <= 100);
  const rr = Number(params.get("rr"));
  const rawDays = params.get("days");
  const days = Number(rawDays);
  const daysOk = rawDays !== null && Number.isInteger(days) && days >= 1 && days <= 250;
  return {
    riskMode: riskOk ? riskMode : DEFAULT_RISK_PRESET.riskMode,
    riskInput: riskOk ? String(round2(risk)) : DEFAULT_RISK_PRESET.riskInput,
    rewardRatio: (REWARD_RATIOS as readonly number[]).includes(rr) ? rr : DEFAULT_RISK_PRESET.rewardRatio,
    daysInput: daysOk ? String(days) : DEFAULT_RISK_PRESET.daysInput,
  };
}

export interface RiskLinkInput {
  accountSize: number;
  /** Omitted when the program isn't known; the planner then uses its default. */
  program?: string;
  phase?: number;
  riskMode?: RiskMode;
  riskValue?: number;
  rewardRatio?: number;
  plannedDays?: number;
}

/** Path to the Rules page planner preloaded with a plan (relative, so it works on any host). */
export function riskPlannerLink(input: RiskLinkInput): string {
  const params = new URLSearchParams({ size: String(input.accountSize) });
  if (input.program) params.set("program", input.program);
  if (input.phase && input.phase > 1) params.set("phase", String(input.phase));
  if (input.riskValue !== undefined && Number.isFinite(input.riskValue) && input.riskValue > 0) {
    params.set("risk", String(round2(input.riskValue)));
    if (input.riskMode === "dollars") params.set("unit", "usd");
  }
  if (input.rewardRatio !== undefined) params.set("rr", String(input.rewardRatio));
  if (input.plannedDays !== undefined) params.set("days", String(input.plannedDays));
  return `/rules?${params.toString()}#risk-planner`;
}

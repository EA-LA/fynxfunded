import { challengeConfigs } from "@/lib/challengeConfig";

/**
 * Educational helpers that mirror the published new-account schedule
 * (fynx-funded-v1). They only illustrate the arithmetic shown on the Rules page;
 * official evaluation is performed server-side and is subject to human review.
 */

export type ProgramId = "1-phase" | "2-phase" | "3-phase";

export const CONSISTENCY_LIMIT_PERCENT = 40;
export const DAILY_RESET_UTC_HOUR = 22;

const pct = (value: string) => {
  const n = Number.parseFloat(value.replace("%", ""));
  if (!Number.isFinite(n)) throw new Error(`Invalid percentage: ${value}`);
  return n;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PhasePlan {
  phase: number;
  targetPercent: number;
  targetProfit: number;
  targetBalance: number;
}

export interface RulePlan {
  accountSize: number;
  program: ProgramId;
  dailyLossPercent: number;
  maxLossPercent: number;
  minDays: number;
  profitSplitPercent: number;
  maxLossAmount: number;
  maxLossFloor: number;
  phases: PhasePlan[];
}

export function getRulePlan(accountSize: number, program: ProgramId): RulePlan {
  const config = challengeConfigs.find((c) => c.accountSize === accountSize);
  if (!config) throw new Error(`Unsupported account size: ${accountSize}`);
  const p = config.phases[program];
  const maxLossPercent = pct(p.maxLoss);
  const maxLossAmount = round2((accountSize * maxLossPercent) / 100);
  return {
    accountSize,
    program,
    dailyLossPercent: pct(p.dailyLoss),
    maxLossPercent,
    minDays: p.minDays,
    profitSplitPercent: pct(p.profitSplit),
    maxLossAmount,
    maxLossFloor: round2(accountSize - maxLossAmount),
    phases: p.profitTargets.map((t, i) => {
      const targetPercent = pct(t);
      const targetProfit = round2((accountSize * targetPercent) / 100);
      return { phase: i + 1, targetPercent, targetProfit, targetBalance: round2(accountSize + targetProfit) };
    }),
  };
}

/** Daily floor = balance at the 22:00 UTC reset × (1 − daily loss %). */
export function dailyLossFloor(resetBalance: number, dailyLossPercent: number) {
  const amount = round2((resetBalance * dailyLossPercent) / 100);
  return { amount, floor: round2(resetBalance - amount) };
}

/** Today's effective floor is whichever loss floor is higher (closer to current equity). */
export function effectiveFloor(plan: RulePlan, resetBalance: number) {
  const daily = dailyLossFloor(resetBalance, plan.dailyLossPercent);
  const binding = daily.floor >= plan.maxLossFloor ? "daily" : "maximum";
  return { daily, floor: Math.max(daily.floor, plan.maxLossFloor), binding } as const;
}

export interface ConsistencyResult {
  tradingDays: number;
  totalProfit: number;
  bestDay: number;
  sharePercent: number | null;
  passes: boolean;
  /** Total net profit needed for the current best day to sit at the 40% limit. */
  profitNeededForBestDay: number;
}

/**
 * Mirrors the engine: best day = max(0, daily net results); share = best ÷ total net
 * profit; the rule is met when total profit is positive and share ≤ 40%.
 */
export function checkConsistency(dailyResults: number[], limitPercent = CONSISTENCY_LIMIT_PERCENT): ConsistencyResult {
  const days = dailyResults.filter((n) => Number.isFinite(n));
  const totalProfit = round2(days.reduce((s, n) => s + n, 0));
  const bestDay = round2(Math.max(0, ...days));
  const sharePercent = totalProfit > 0 ? round2((bestDay / totalProfit) * 100) : null;
  return {
    tradingDays: days.length,
    totalProfit,
    bestDay,
    sharePercent,
    passes: sharePercent !== null && sharePercent <= limitPercent,
    profitNeededForBestDay: round2((bestDay * 100) / limitPercent),
  };
}

export const PROGRAMS: ProgramId[] = ["1-phase", "2-phase", "3-phase"];

export interface CalculatorPreset {
  accountSize: number;
  program: ProgramId;
  phase: number;
}

export const DEFAULT_PRESET: CalculatorPreset = { accountSize: 25000, program: "2-phase", phase: 1 };

/**
 * Reads `size`, `program` and `phase` from a query string so other pages can
 * deep-link into the calculator. Unknown or out-of-range values fall back to defaults.
 */
export function parseCalculatorPreset(params: URLSearchParams): CalculatorPreset {
  const size = Number(params.get("size"));
  const accountSize = challengeConfigs.some((c) => c.accountSize === size) ? size : DEFAULT_PRESET.accountSize;
  const rawProgram = params.get("program");
  const program = PROGRAMS.find((p) => p === rawProgram) ?? DEFAULT_PRESET.program;
  const phaseCount = getRulePlan(accountSize, program).phases.length;
  const rawPhase = Number(params.get("phase"));
  const phase = Number.isInteger(rawPhase) && rawPhase >= 1 && rawPhase <= phaseCount ? rawPhase : 1;
  return { accountSize, program, phase };
}

/** Link to the Rules page calculator preloaded with a size/program (and optional phase). */
export function calculatorLink(accountSize: number, program: ProgramId, phase?: number) {
  const params = new URLSearchParams({ size: String(accountSize), program });
  if (phase && phase > 1) params.set("phase", String(phase));
  return `/rules?${params.toString()}#calculator`;
}

export interface ProgramSummary {
  plan: RulePlan;
  price: number;
  /** Sum of every phase's profit target; each phase restarts from the full account size. */
  combinedTargetProfit: number;
  /** Minimum trading days across all phases (minimum per phase × number of phases). */
  minimumTotalDays: number;
  /** Daily loss allowance on the starting balance. */
  startingDailyLossAmount: number;
  /** Fee as a share of the account size. */
  feePercentOfAccount: number;
}

/** Everything needed to compare the three programs side by side for one account size. */
export function summarizeProgram(accountSize: number, program: ProgramId): ProgramSummary {
  const plan = getRulePlan(accountSize, program);
  const config = challengeConfigs.find((c) => c.accountSize === accountSize)!;
  const price = config.phases[program].price;
  return {
    plan,
    price,
    combinedTargetProfit: round2(plan.phases.reduce((s, p) => s + p.targetProfit, 0)),
    minimumTotalDays: plan.minDays * plan.phases.length,
    startingDailyLossAmount: dailyLossFloor(accountSize, plan.dailyLossPercent).amount,
    feePercentOfAccount: round2((price / accountSize) * 100),
  };
}

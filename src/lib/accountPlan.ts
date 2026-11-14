import { challengeConfigs } from "@/lib/challengeConfig";
import { calculatorLink, getRulePlan, CONSISTENCY_LIMIT_PERCENT, PROGRAMS, type PhasePlan, type ProgramId, type RulePlan } from "@/lib/ruleCalculator";
import { riskPlannerLink } from "@/lib/riskPlanner";
import { positionSizeLink } from "@/lib/positionSize";
import { simulatorLink } from "@/lib/challengeSimulator";

/**
 * Turns a purchased challenge (size + program, optional current phase) into the
 * published new-account schedule in dollars for the dashboard home. Display only:
 * the official evaluation is recorded server-side and shown on Objectives.
 */

export interface PurchasedChallenge {
  accountSize: number;
  /** Program as stored on the purchase, e.g. "2-phase". */
  phase: string;
  /** Evaluation phase the account is in (1-based), when recorded. */
  currentPhase?: number;
  status: string;
}

export type StageState = "done" | "current" | "upcoming";

export interface AccountStage {
  label: string;
  state: StageState;
}

export interface AccountPlanView {
  plan: RulePlan;
  program: ProgramId;
  phaseCount: number;
  /** Phase shown in the tiles (1-based). */
  phase: number;
  /** True when the recorded phase was missing or out of range and phase 1 is assumed. */
  phaseAssumed: boolean;
  funded: boolean;
  phaseTarget: PhasePlan;
  /** Daily loss allowance measured on the starting balance. */
  startingDailyLossAmount: number;
  consistencyPercent: number;
  stages: AccountStage[];
  links: { calculator: string; riskPlanner: string; positionSize: string; simulator: string };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2-phase", "2 Phase", "Two-step"… → ProgramId; null when it can't be told. */
export function programFromPurchase(raw: string | undefined | null): ProgramId | null {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!value) return null;
  const exact = PROGRAMS.find((p) => p === value);
  if (exact) return exact;
  const words: Record<string, ProgramId> = { one: "1-phase", two: "2-phase", three: "3-phase" };
  const match = value.match(/^(1|2|3|one|two|three)-?(phase|step)s?$/);
  if (!match) return null;
  return (words[match[1]] ?? `${match[1]}-phase`) as ProgramId;
}

export function accountPlanFor(challenge: PurchasedChallenge): AccountPlanView | null {
  const program = programFromPurchase(challenge.phase);
  if (!program || !challengeConfigs.some((c) => c.accountSize === challenge.accountSize)) return null;
  const plan = getRulePlan(challenge.accountSize, program);
  const phaseCount = plan.phases.length;
  const funded = challenge.status === "funded";
  const recorded = challenge.currentPhase;
  const valid = Number.isInteger(recorded) && (recorded as number) >= 1 && (recorded as number) <= phaseCount;
  const phase = funded ? phaseCount : valid ? (recorded as number) : 1;
  const stages: AccountStage[] = [
    ...plan.phases.map((p) => ({
      label: `Phase ${p.phase}`,
      state: (funded || p.phase < phase ? "done" : p.phase === phase ? "current" : "upcoming") as StageState,
    })),
    { label: "Funded", state: funded ? "current" : "upcoming" },
  ];
  const size = challenge.accountSize;
  return {
    plan,
    program,
    phaseCount,
    phase,
    phaseAssumed: !funded && !valid,
    funded,
    phaseTarget: plan.phases[phase - 1],
    startingDailyLossAmount: round2((size * plan.dailyLossPercent) / 100),
    consistencyPercent: CONSISTENCY_LIMIT_PERCENT,
    stages,
    links: {
      calculator: calculatorLink(size, program, funded ? undefined : phase),
      riskPlanner: riskPlannerLink({ accountSize: size, program, phase: funded ? undefined : phase }),
      positionSize: positionSizeLink({ accountSize: size, program }),
      simulator: simulatorLink({ accountSize: size, program, phase: funded ? undefined : phase }),
    },
  };
}

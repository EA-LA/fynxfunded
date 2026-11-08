import { accountPlanFor } from "@/lib/accountPlan";
import { challengeConfigs } from "@/lib/challengeConfig";
import { PROGRAMS, getRulePlan } from "@/lib/ruleCalculator";

/**
 * The trader's own profit split on Payouts, from the published schedule for
 * each funded account's size and program. Display only: the amount actually
 * paid is the one confirmed in the payout review.
 */

export interface FundedLike {
  challengeId: string;
  accountReference?: string;
  brokerAccountId?: string | null;
  name?: string;
  phase: string;
  accountSize: number;
  status: string;
  currentPhase?: number;
}

export interface FundedSplitRow<T extends FundedLike = FundedLike> {
  challenge: T;
  /** Percent from the published schedule, or null when the size/program is not in it. */
  splitPercent: number | null;
  /** Program label like "2 phase", or the stored value when it can't be read. */
  programLabel: string;
}

export interface FundedSplitSummary<T extends FundedLike = FundedLike> {
  rows: FundedSplitRow<T>[];
  /** Value for the "Profit split" rule box. */
  value: string;
  desc: string;
  /** True when the box shows the trader's own plan(s) rather than the general range. */
  personal: boolean;
}

/** Lowest and highest split in the published schedule (e.g. 75 and 90). */
export function scheduleSplitRange(): { min: number; max: number } {
  const all = challengeConfigs.flatMap((c) => PROGRAMS.map((p) => getRulePlan(c.accountSize, p).profitSplitPercent));
  return { min: Math.min(...all), max: Math.max(...all) };
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function fundedSplits<T extends FundedLike>(challenges: T[]): FundedSplitSummary<T> {
  const rows = challenges
    .filter((c) => c.status === "funded")
    .map((challenge) => {
      const view = accountPlanFor({ accountSize: challenge.accountSize, phase: challenge.phase, currentPhase: challenge.currentPhase, status: challenge.status });
      return {
        challenge,
        splitPercent: view ? view.plan.profitSplitPercent : null,
        programLabel: view ? view.program.replace("-", " ") : String(challenge.phase || "Unknown program"),
      };
    });
  const { max } = scheduleSplitRange();
  const known = rows.filter((r) => r.splitPercent !== null).map((r) => r.splitPercent as number);
  if (!rows.length || !known.length) {
    return { rows, value: `Up to ${max}%`, desc: rows.length ? "Your plan isn't in the published schedule; see Objectives" : "Based on your challenge tier", personal: false };
  }
  const lo = Math.min(...known), hi = Math.max(...known);
  if (rows.length === 1) {
    const r = rows[0];
    return { rows, value: `${lo}%`, desc: `Your ${usd(r.challenge.accountSize)} ${r.programLabel} plan`, personal: true };
  }
  return { rows, value: lo === hi ? `${lo}%` : `${lo}–${hi}%`, desc: lo === hi ? `All ${rows.length} funded accounts` : "Depends on the account; see below", personal: true };
}

/** Trader's share of an example approved profit, rounded to cents. */
export const traderShare = (profit: number, splitPercent: number) => Math.round(profit * splitPercent) / 100;

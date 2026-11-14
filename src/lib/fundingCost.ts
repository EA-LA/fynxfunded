import { summarizeProgram, type ProgramId } from "@/lib/ruleCalculator";

/**
 * "What could getting funded cost?" — arithmetic on top of a pass-simulator
 * result and the published fee and profit split. Educational only: it treats
 * every attempt as independent with the same odds, uses today's published fee
 * for each attempt and ignores any refund, discount or promotion. Fee-refund
 * eligibility depends on the terms shown at purchase.
 */

export interface FundingCostInput {
  accountSize: number;
  program: ProgramId;
  /** Simulated runs that passed every phase. */
  passed: number;
  /** Simulated runs that ended without passing (a limit broke, or no room was left to trade). */
  ended: number;
  /** Simulated runs still going when the trader's own day limit ran out (no new fee is needed for these). */
  unfinished: number;
}

export interface FundingCost {
  fee: number;
  splitPercent: number;
  /** Chance one attempt passes, among attempts that finished (0–100, one decimal). */
  passChancePercent: number;
  /** Null when no simulated run passed. */
  expectedAttempts: number | null;
  /** Average fees paid until funded (fee × expected attempts). Null when no run passed. */
  expectedFees: number | null;
  /** Chance of being funded within 1, 2, 3 and 5 attempts (percent, one decimal). */
  withinAttempts: { attempts: number; percent: number }[];
  /** Attempts needed for a 90% chance of being funded. Null when no run passed. */
  attemptsFor90: number | null;
  /** Funded-account net profit whose trader share equals one fee. */
  profitToCoverFee: number;
  /** Funded-account net profit whose trader share equals the average fees paid. Null when no run passed. */
  profitToCoverExpectedFees: number | null;
  /** That profit as a share of the account size (percent, one decimal). */
  profitToCoverExpectedPercent: number | null;
  /** Runs left out because they were still going at the trader's own day limit (percent of all runs, one decimal). */
  unfinishedPercent: number;
  /** Fewer than 20 passing runs: the estimate moves a lot between runs. */
  lowSample: boolean;
}

export const ATTEMPT_STEPS = [1, 2, 3, 5] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const ceilCents = (n: number) => Math.ceil(n * 100 - 1e-6) / 100;

export function fundingCost(input: FundingCostInput): FundingCost | null {
  const passed = Math.max(0, Math.trunc(input.passed));
  const ended = Math.max(0, Math.trunc(input.ended));
  const unfinished = Math.max(0, Math.trunc(input.unfinished));
  const finished = passed + ended;
  const all = finished + unfinished;
  if (finished === 0) return null;

  const { price: fee, plan } = summarizeProgram(input.accountSize, input.program);
  const splitPercent = plan.profitSplitPercent;
  const p = passed / finished;
  const coverOne = (amount: number) => ceilCents((amount * 100) / splitPercent);

  const expectedAttempts = p > 0 ? 1 / p : null;
  const expectedFees = expectedAttempts === null ? null : round2(fee * expectedAttempts);
  const profitToCoverExpectedFees = expectedFees === null ? null : coverOne(expectedFees);

  return {
    fee,
    splitPercent,
    passChancePercent: round1(p * 100),
    expectedAttempts: expectedAttempts === null ? null : round1(expectedAttempts),
    expectedFees,
    withinAttempts: ATTEMPT_STEPS.map((k) => ({ attempts: k, percent: round1((1 - (1 - p) ** k) * 100) })),
    attemptsFor90: p <= 0 ? null : p >= 1 ? 1 : Math.max(1, Math.ceil(Math.log(0.1) / Math.log(1 - p) - 1e-9)),
    profitToCoverFee: coverOne(fee),
    profitToCoverExpectedFees,
    profitToCoverExpectedPercent: profitToCoverExpectedFees === null ? null : round1((profitToCoverExpectedFees / input.accountSize) * 100),
    unfinishedPercent: all ? round1((unfinished / all) * 100) : 0,
    lowSample: passed < 20,
  };
}

/** Funded-account net profit whose trader share equals the given fee, for the payout estimator. */
export function feePayback(accountSize: number, program: ProgramId, traderShare: number) {
  const { price: fee, plan } = summarizeProgram(accountSize, program);
  const profitToCoverFee = ceilCents((fee * 100) / plan.profitSplitPercent);
  const share = Number.isFinite(traderShare) && traderShare > 0 ? traderShare : 0;
  return {
    fee,
    profitToCoverFee,
    profitToCoverFeePercent: round2((profitToCoverFee / accountSize) * 100),
    /** How many times the share would cover the fee (one decimal). */
    timesFee: fee > 0 ? Math.floor((share / fee) * 10) / 10 : 0,
    covered: share >= fee,
    shortBy: round2(Math.max(0, fee - share)),
  };
}

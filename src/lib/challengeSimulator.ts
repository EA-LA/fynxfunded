import { CONSISTENCY_LIMIT_PERCENT, type RulePlan } from "@/lib/ruleCalculator";
import { REWARD_RATIOS, type RiskMode } from "@/lib/riskPlanner";

/**
 * Educational "what if" simulation of a hypothetical trader working through the
 * published schedule. Every trade either loses exactly the planned risk or wins
 * risk × reward, at a fixed win rate, independently of earlier trades. Real
 * trading is not like that, so the output is an illustration of how the rules
 * interact with a plan; it is not a prediction and is never used to evaluate
 * a real account.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

/** Runs per simulation on the Rules page. */
export const SIMULATION_RUNS = 2000;

export type PhaseChoice = number | "all";

export type Outcome = "passed" | "dailyBreach" | "maxBreach" | "outOfRoom" | "unfinished";

export interface SimulationInput {
  plan: RulePlan;
  /** A single 1-based phase, or "all" to run every phase back to back. */
  phase: PhaseChoice;
  riskAmount: number;
  rewardRatio: number;
  /** 1–99. */
  winRatePercent: number;
  tradesPerDay: number;
  /** Trading days available before the run counts as unfinished (all phases together when phase = "all"). */
  dayLimit: number;
  /** Round-turn charges per trade in USD, taken off every trade. */
  costPerTrade: number;
  /** When true, the trader skips any trade whose full loss could take equity below today's floor. */
  stopBeforeBreach: boolean;
  runs: number;
  seed: number;
  /**
   * Optional replay mode: when given, every simulated trade is one of these
   * dollar results picked at random (with replacement), instead of a fixed win
   * or loss. riskAmount, rewardRatio and winRatePercent are then ignored, and
   * "stop before a breach" assumes the next trade could be the largest loss.
   */
  tradeOutcomes?: number[];
}

export interface SimulationResult {
  runs: number;
  counts: Record<Outcome, number>;
  /** Share of runs per outcome, in percent with one decimal. */
  percents: Record<Outcome, number>;
  /** Trading days used by passing runs. */
  medianDaysToPass: number | null;
  fastestPass: number | null;
  slowestPass: number | null;
  /** Passing runs that reached the target balance at least one day before every condition was met. */
  passesDelayedByRules: number;
  /** Histogram of trading days used by passing runs. */
  passDays: { from: number; to: number; count: number }[];
  /** Phases that each run had to complete. */
  phases: number[];
}

/** Small, fast, seedable generator so a simulation can be repeated exactly. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PhaseRun {
  outcome: Outcome;
  days: number;
  delayed: boolean;
}

function runPhase(input: SimulationInput, targetProfit: number, daysAvailable: number, random: () => number): PhaseRun {
  const { plan, riskAmount, rewardRatio, costPerTrade, tradesPerDay, stopBeforeBreach } = input;
  const outcomes = input.tradeOutcomes && input.tradeOutcomes.length ? input.tradeOutcomes.map((o) => round2(o - costPerTrade)) : null;
  const win = round2(riskAmount * rewardRatio - costPerTrade);
  // In replay mode the planned "loss" is the worst result the record contains.
  const loss = outcomes ? Math.max(0, -Math.min(...outcomes)) : round2(riskAmount + costPerTrade);
  const p = input.winRatePercent / 100;
  const nextTrade = outcomes
    ? () => outcomes[Math.min(outcomes.length - 1, Math.floor(random() * outcomes.length))]
    : () => (random() < p ? win : -loss);
  const start = plan.accountSize;
  const maxFloor = plan.maxLossFloor;

  let balance = start;
  let tradingDays = 0;
  let total = 0;
  let bestDay = 0;
  let delayed = false;

  for (let day = 0; day < daysAvailable; day++) {
    const resetBalance = balance;
    const dailyFloor = round2(resetBalance - round2((resetBalance * plan.dailyLossPercent) / 100));
    const floor = Math.max(dailyFloor, maxFloor);

    if (stopBeforeBreach && balance - loss < maxFloor - EPS) {
      // Another full loss would break the static floor: nothing left to trade with.
      return { outcome: "outOfRoom", days: tradingDays, delayed };
    }

    let dayResult = 0;
    let traded = false;
    for (let t = 0; t < tradesPerDay; t++) {
      if (stopBeforeBreach && balance - loss < floor - EPS) break;
      traded = true;
      const delta = nextTrade();
      balance = round2(balance + delta);
      dayResult = round2(dayResult + delta);
      if (balance < floor - EPS) {
        return { outcome: balance < maxFloor - EPS ? "maxBreach" : "dailyBreach", days: tradingDays + 1, delayed };
      }
    }
    if (!traded) continue;

    tradingDays++;
    total = round2(total + dayResult);
    bestDay = Math.max(bestDay, dayResult);
    const profit = round2(balance - start);
    if (profit >= targetProfit - EPS) {
      const share = total > 0 ? round2((bestDay / total) * 100) : Infinity;
      if (tradingDays >= plan.minDays && share <= CONSISTENCY_LIMIT_PERCENT) {
        return { outcome: "passed", days: tradingDays, delayed };
      }
      delayed = true;
    }
  }
  return { outcome: "unfinished", days: tradingDays, delayed };
}

const OUTCOMES: Outcome[] = ["passed", "dailyBreach", "maxBreach", "outOfRoom", "unfinished"];

export function simulateChallenge(input: SimulationInput): SimulationResult {
  const { plan } = input;
  const replay = Boolean(input.tradeOutcomes && input.tradeOutcomes.length);
  if (replay) {
    if (!input.tradeOutcomes!.every((o) => Number.isFinite(o))) throw new Error("Trade results must be numbers");
  } else {
    if (!(input.riskAmount > 0) || !Number.isFinite(input.riskAmount)) throw new Error("Risk must be a positive number");
    if (!(input.rewardRatio > 0)) throw new Error("Reward must be positive");
    if (!(input.winRatePercent > 0 && input.winRatePercent < 100)) throw new Error("Win rate must be between 0 and 100");
  }
  if (!(input.costPerTrade >= 0)) throw new Error("Charges cannot be negative");
  const runs = Math.max(1, Math.trunc(input.runs));
  const tradesPerDay = Math.max(1, Math.trunc(input.tradesPerDay));
  const dayLimit = Math.max(1, Math.trunc(input.dayLimit));
  const settings = { ...input, tradesPerDay, dayLimit };

  const phases =
    input.phase === "all"
      ? plan.phases.map((p) => p.phase)
      : [Math.min(Math.max(1, Math.trunc(input.phase) || 1), plan.phases.length)];

  const random = mulberry32(input.seed);
  const counts: Record<Outcome, number> = { passed: 0, dailyBreach: 0, maxBreach: 0, outOfRoom: 0, unfinished: 0 };
  const passDays: number[] = [];
  let passesDelayedByRules = 0;

  for (let r = 0; r < runs; r++) {
    let used = 0;
    let outcome: Outcome = "passed";
    let delayed = false;
    for (const phase of phases) {
      const res = runPhase(settings, plan.phases[phase - 1].targetProfit, dayLimit - used, random);
      used += res.days;
      delayed = delayed || res.delayed;
      if (res.outcome !== "passed") {
        outcome = res.outcome;
        break;
      }
    }
    counts[outcome]++;
    if (outcome === "passed") {
      passDays.push(used);
      if (delayed) passesDelayedByRules++;
    }
  }

  passDays.sort((a, b) => a - b);
  const percents = Object.fromEntries(OUTCOMES.map((o) => [o, Math.round((counts[o] / runs) * 1000) / 10])) as Record<Outcome, number>;

  let histogram: SimulationResult["passDays"] = [];
  if (passDays.length) {
    const lo = passDays[0];
    const hi = passDays[passDays.length - 1];
    const width = Math.max(1, Math.ceil((hi - lo + 1) / 12));
    for (let from = lo; from <= hi; from += width) histogram.push({ from, to: from + width - 1, count: 0 });
    for (const d of passDays) histogram[Math.floor((d - lo) / width)].count++;
    histogram = histogram.map((b) => ({ ...b, to: Math.min(b.to, hi) }));
  }

  return {
    runs,
    counts,
    percents,
    medianDaysToPass: passDays.length ? passDays[Math.floor((passDays.length - 1) / 2)] : null,
    fastestPass: passDays.length ? passDays[0] : null,
    slowestPass: passDays.length ? passDays[passDays.length - 1] : null,
    passesDelayedByRules,
    passDays: histogram,
    phases,
  };
}

export interface SimulatorPreset {
  phase: PhaseChoice;
  riskMode: RiskMode;
  riskInput: string;
  rewardRatio: number;
  winRateInput: string;
  tradesPerDay: number;
  dayLimitInput: string;
  costInput: string;
  stopBeforeBreach: boolean;
}

export const TRADES_PER_DAY = [1, 2, 3, 5, 8] as const;

export const DEFAULT_SIMULATOR_PRESET: SimulatorPreset = {
  phase: 1,
  riskMode: "percent",
  riskInput: "0.5",
  rewardRatio: 2,
  winRateInput: "45",
  tradesPerDay: 2,
  dayLimitInput: "60",
  costInput: "0",
  stopBeforeBreach: true,
};

const numberIn = (raw: string | null, min: number, max: number, integer = false) => {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return null;
  return n;
};

/**
 * Reads the simulator's choices from a shared address, e.g.
 * /rules?size=50000&program=2-phase&sphase=all&risk=0.5&rr=2&wr=45&tpd=2&limit=60#simulator.
 * Shares size/program/risk/unit/rr with the risk planner so a plan can be handed over.
 */
export function parseSimulatorPreset(params: URLSearchParams, phaseCount: number): SimulatorPreset {
  const d = DEFAULT_SIMULATOR_PRESET;
  const rawPhase = params.get("sphase") ?? params.get("phase");
  const phaseNumber = numberIn(rawPhase, 1, phaseCount, true);
  const phase: PhaseChoice = rawPhase === "all" ? "all" : phaseNumber ?? d.phase;
  const riskMode: RiskMode = params.get("unit") === "usd" ? "dollars" : "percent";
  const risk = numberIn(params.get("risk"), 0.01, riskMode === "dollars" ? 10_000_000 : 100);
  const rr = Number(params.get("rr"));
  const wr = numberIn(params.get("wr"), 1, 99);
  const tpd = Number(params.get("tpd"));
  const limit = numberIn(params.get("limit"), 1, 250, true);
  const cost = numberIn(params.get("cost"), 0, 100_000);
  return {
    phase,
    riskMode: risk !== null ? riskMode : d.riskMode,
    riskInput: risk !== null ? String(round2(risk)) : d.riskInput,
    rewardRatio: (REWARD_RATIOS as readonly number[]).includes(rr) ? rr : d.rewardRatio,
    winRateInput: wr !== null ? String(round2(wr)) : d.winRateInput,
    tradesPerDay: (TRADES_PER_DAY as readonly number[]).includes(tpd) ? tpd : d.tradesPerDay,
    dayLimitInput: limit !== null ? String(limit) : d.dayLimitInput,
    costInput: cost !== null ? String(round2(cost)) : d.costInput,
    stopBeforeBreach: params.get("stop") !== "0",
  };
}

export interface SimulatorLinkInput {
  accountSize: number;
  program?: string;
  phase?: PhaseChoice;
  riskMode?: RiskMode;
  riskValue?: number;
  rewardRatio?: number;
  winRate?: number;
  tradesPerDay?: number;
  dayLimit?: number;
  costPerTrade?: number;
  stopBeforeBreach?: boolean;
}

/** Path to the Rules page simulator preloaded with a plan. */
export function simulatorLink(input: SimulatorLinkInput): string {
  const params = new URLSearchParams({ size: String(input.accountSize) });
  if (input.program) params.set("program", input.program);
  if (input.phase !== undefined && input.phase !== 1) params.set("sphase", String(input.phase));
  if (input.riskValue !== undefined && Number.isFinite(input.riskValue) && input.riskValue > 0) {
    params.set("risk", String(round2(input.riskValue)));
    if (input.riskMode === "dollars") params.set("unit", "usd");
  }
  if (input.rewardRatio !== undefined) params.set("rr", String(input.rewardRatio));
  if (input.winRate !== undefined && Number.isFinite(input.winRate)) params.set("wr", String(round2(input.winRate)));
  if (input.tradesPerDay !== undefined) params.set("tpd", String(input.tradesPerDay));
  if (input.dayLimit !== undefined && Number.isFinite(input.dayLimit)) params.set("limit", String(input.dayLimit));
  if (input.costPerTrade !== undefined && input.costPerTrade > 0) params.set("cost", String(round2(input.costPerTrade)));
  if (input.stopBeforeBreach === false) params.set("stop", "0");
  return `/rules?${params.toString()}#simulator`;
}

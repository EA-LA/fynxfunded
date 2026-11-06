import { challengeConfigs } from "@/lib/challengeConfig";
import { PROGRAMS, summarizeProgram, type ProgramId, type ProgramSummary } from "@/lib/ruleCalculator";

/**
 * "Find your challenge": filters and ranks every published size × program
 * against a trader's own budget, risk per trade and priority. Pure arithmetic
 * over the published schedule (fynx-funded-v1); it never predicts results and
 * never changes what is offered or charged.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const floorCents = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
// Guards floor() against binary rounding (e.g. 1250 / 125 = 9.999999…).
const safeFloor = (n: number) => Math.floor(n + 1e-9);

export type FinderPriority = "lowest-fee" | "best-value" | "most-room" | "fastest" | "largest-account" | "best-split";

export const FINDER_PRIORITIES: { id: FinderPriority; label: string; hint: string }[] = [
  { id: "lowest-fee", label: "Lowest fee", hint: "Spend as little as possible on the evaluation." },
  { id: "best-value", label: "Best value", hint: "Lowest fee for the size of the account (fee as a % of the account)." },
  { id: "most-room", label: "Most room", hint: "Largest maximum loss in dollars before the account ends." },
  { id: "fastest", label: "Fewest days", hint: "Fewest minimum trading days across all phases." },
  { id: "largest-account", label: "Largest account", hint: "The biggest funded account your budget allows." },
  { id: "best-split", label: "Best profit split", hint: "Highest share of profit paid to you once funded." },
];

/** Losing trades in one trading day the trader wants the daily allowance to absorb. */
export const LOSING_STREAK_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

/** Days a week the trader can trade (forex runs Monday to Friday). */
export const DAYS_PER_WEEK_OPTIONS = [1, 2, 3, 4, 5] as const;

/**
 * Earliest number of calendar weeks the minimum trading days take at this pace.
 * There is no maximum time limit, so this is a floor, not a deadline: hitting
 * the profit target usually takes longer, and it leaves out the time to open
 * each next phase account.
 */
export function earliestWeeks(minimumDays: number, daysPerWeek: number): number {
  const pace = Math.min(5, Math.max(1, Math.trunc(daysPerWeek) || 1));
  return Math.ceil(Math.max(0, minimumDays) / pace);
}

export interface FinderInput {
  /** Highest fee the trader wants to pay, or null for any. */
  budget: number | null;
  priority: FinderPriority;
  /** Dollar risk per trade, or null when the trader hasn't said. */
  riskPerTrade: number | null;
  /** Full losing trades in one trading day that must fit inside the daily allowance. */
  losingTrades: number;
  /** Restrict to these programs (empty = all). */
  programs: ProgramId[];
  /** Days a week the trader can trade, or null when not given. */
  daysPerWeek?: number | null;
}

export interface FinderOption {
  id: string;
  accountSize: number;
  label: string;
  program: ProgramId;
  summary: ProgramSummary;
  /** Full losing trades at the chosen risk before the starting daily floor (null without a risk). */
  lossesToDailyFloor: number | null;
  /** Full losing trades at the chosen risk before the static maximum-loss floor. */
  lossesToMaxFloor: number | null;
  /** Risk per trade as a % of this account (null without a risk). */
  riskPercent: number | null;
  /** Earliest calendar weeks for the minimum trading days at the trader's pace (null without a pace). */
  earliestWeeks: number | null;
  withinBudget: boolean;
  supportsRisk: boolean;
  fits: boolean;
}

export interface FinderResult {
  /** Plans that fit, best first. */
  matches: FinderOption[];
  /** Every plan considered (after the program filter), cheapest first. */
  considered: FinderOption[];
  /** When nothing fits: the plans that come closest and what would need to change. */
  nearMisses: NearMiss[];
}

export interface NearMiss {
  option: FinderOption;
  /** What would make this plan fit. */
  change: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const programLabel = (program: ProgramId) => program.replace("-", " ");

/** Builds every published size × program option with the trader's risk applied. */
export function buildOptions(input: Pick<FinderInput, "budget" | "riskPerTrade" | "losingTrades" | "programs" | "daysPerWeek">): FinderOption[] {
  const programs = input.programs.length > 0 ? PROGRAMS.filter((p) => input.programs.includes(p)) : PROGRAMS;
  const risk = input.riskPerTrade !== null && Number.isFinite(input.riskPerTrade) && input.riskPerTrade > 0 ? round2(input.riskPerTrade) : null;
  const wanted = Math.max(1, Math.trunc(input.losingTrades) || 1);
  const pace = validPace(input.daysPerWeek);
  const options: FinderOption[] = [];
  for (const config of challengeConfigs) {
    for (const program of programs) {
      const summary = summarizeProgram(config.accountSize, program);
      const lossesToDailyFloor = risk === null ? null : safeFloor(summary.startingDailyLossAmount / risk);
      const lossesToMaxFloor = risk === null ? null : safeFloor(summary.plan.maxLossAmount / risk);
      const withinBudget = input.budget === null || summary.price <= input.budget;
      const supportsRisk = lossesToDailyFloor === null || lossesToDailyFloor >= wanted;
      options.push({
        id: `${config.accountSize}-${program}`,
        accountSize: config.accountSize,
        label: config.label,
        program,
        summary,
        lossesToDailyFloor,
        lossesToMaxFloor,
        riskPercent: risk === null ? null : round2((risk / config.accountSize) * 100),
        earliestWeeks: pace === null ? null : earliestWeeks(summary.minimumTotalDays, pace),
        withinBudget,
        supportsRisk,
        fits: withinBudget && supportsRisk,
      });
    }
  }
  return options;
}

function validPace(days: number | null | undefined): number | null {
  return typeof days === "number" && (DAYS_PER_WEEK_OPTIONS as readonly number[]).includes(days) ? days : null;
}

const weeksText = (w: number) => `${w} ${w === 1 ? "week" : "weeks"}`;

type Comparator = (a: FinderOption, b: FinderOption) => number;
const byPrice: Comparator = (a, b) => a.summary.price - b.summary.price;
const bySizeDesc: Comparator = (a, b) => b.accountSize - a.accountSize;
const then = (...cs: Comparator[]): Comparator => (a, b) => {
  for (const c of cs) {
    const r = c(a, b);
    if (r !== 0) return r;
  }
  return 0;
};

const comparators: Record<FinderPriority, Comparator> = {
  "lowest-fee": then(byPrice, bySizeDesc),
  "best-value": then((a, b) => a.summary.feePercentOfAccount - b.summary.feePercentOfAccount, bySizeDesc, byPrice),
  "most-room": then((a, b) => b.summary.plan.maxLossAmount - a.summary.plan.maxLossAmount, byPrice),
  fastest: then((a, b) => a.summary.minimumTotalDays - b.summary.minimumTotalDays, bySizeDesc, byPrice),
  "largest-account": then(bySizeDesc, byPrice),
  "best-split": then((a, b) => b.summary.plan.profitSplitPercent - a.summary.plan.profitSplitPercent, bySizeDesc, byPrice),
};

export function rankOptions(options: FinderOption[], priority: FinderPriority): FinderOption[] {
  return [...options].sort(comparators[priority]);
}

/** Largest risk per trade (rounded down to the cent) that lets `losingTrades` losses fit the daily allowance. */
export function maxRiskFor(option: FinderOption, losingTrades: number): number {
  return floorCents(option.summary.startingDailyLossAmount / Math.max(1, Math.trunc(losingTrades) || 1));
}

export function findChallenges(input: FinderInput): FinderResult {
  const considered = rankOptions(buildOptions(input), "lowest-fee");
  const matches = rankOptions(considered.filter((o) => o.fits), input.priority);
  const nearMisses: NearMiss[] = [];
  if (matches.length === 0 && considered.length > 0) {
    const wanted = Math.max(1, Math.trunc(input.losingTrades) || 1);
    // 1) Within budget but the risk is too big: the in-budget plan with the largest daily allowance.
    const inBudget = considered.filter((o) => o.withinBudget);
    if (inBudget.length > 0) {
      const roomiest = [...inBudget].sort(
        then((a, b) => b.summary.startingDailyLossAmount - a.summary.startingDailyLossAmount, byPrice),
      )[0];
      const risk = maxRiskFor(roomiest, wanted);
      nearMisses.push({
        option: roomiest,
        change:
          risk >= 0.01
            ? `Fits your budget if you risk ${usd(risk)} or less per trade (${wanted} losing ${wanted === 1 ? "trade" : "trades"} in a day).`
            : `Fits your budget, but its daily allowance is too small for ${wanted} losing trades.`,
      });
    }
    // 2) Supports the risk but costs more: the cheapest plan that supports it.
    const supports = considered.filter((o) => o.supportsRisk);
    if (supports.length > 0) {
      const cheapest = supports[0];
      if (!nearMisses.some((n) => n.option.id === cheapest.id)) {
        nearMisses.push({
          option: cheapest,
          change: `Handles your risk; the fee is ${usd(cheapest.summary.price)}${input.budget !== null ? ` (${usd(round2(cheapest.summary.price - input.budget))} above your budget)` : ""}.`,
        });
      }
    }
  }
  return { matches, considered, nearMisses };
}

/** Plain-language reasons this option suits the trader, most relevant first. */
export function explainOption(option: FinderOption, input: FinderInput, matches: FinderOption[]): string[] {
  const s = option.summary;
  const reasons: string[] = [];
  const isBest = (pick: (o: FinderOption) => number, dir: "min" | "max") => {
    const values = matches.map(pick);
    const best = dir === "min" ? Math.min(...values) : Math.max(...values);
    return pick(option) === best;
  };
  if (matches.length > 1) {
    if (input.priority === "lowest-fee" && isBest((o) => o.summary.price, "min")) reasons.push(`Lowest fee of the ${matches.length} plans that fit.`);
    if (input.priority === "best-value" && isBest((o) => o.summary.feePercentOfAccount, "min"))
      reasons.push(`Lowest fee for its size: ${s.feePercentOfAccount}% of the account.`);
    if (input.priority === "most-room" && isBest((o) => o.summary.plan.maxLossAmount, "max"))
      reasons.push(`Most room of the plans that fit: ${usd(s.plan.maxLossAmount)} maximum loss.`);
    if (input.priority === "fastest" && isBest((o) => o.summary.minimumTotalDays, "min"))
      reasons.push(`Fewest minimum trading days of the plans that fit: ${s.minimumTotalDays}.`);
    if (input.priority === "largest-account" && isBest((o) => o.accountSize, "max")) reasons.push(`Largest account your choices allow: ${option.label}.`);
    if (input.priority === "best-split" && isBest((o) => o.summary.plan.profitSplitPercent, "max"))
      reasons.push(`Highest profit split of the plans that fit: ${s.plan.profitSplitPercent}%.`);
  }
  if (input.budget !== null) reasons.push(`Fee ${usd(s.price)} is within your ${usd(input.budget)} budget.`);
  if (option.lossesToDailyFloor !== null && input.riskPerTrade !== null) {
    reasons.push(
      `At ${usd(input.riskPerTrade)} a trade (${option.riskPercent}% of the account), ${option.lossesToDailyFloor} full ${option.lossesToDailyFloor === 1 ? "loss fits" : "losses fit"} in one day and ${option.lossesToMaxFloor} before the maximum loss.`,
    );
  }
  const pace = validPace(input.daysPerWeek);
  if (pace !== null && option.earliestWeeks !== null) {
    reasons.push(
      `Trading ${pace} ${pace === 1 ? "day" : "days"} a week, the ${s.minimumTotalDays} minimum trading days take at least ${weeksText(option.earliestWeeks)}.`,
    );
  }
  return reasons;
}

/** Things worth knowing before choosing this option (never a reason to hide it). */
export function cautionsFor(option: FinderOption): string[] {
  const s = option.summary;
  const notes: string[] = [];
  if (option.program === "1-phase") notes.push(`Tighter limits: ${s.plan.dailyLossPercent}% daily and ${s.plan.maxLossPercent}% maximum loss, with a ${s.plan.phases[0].targetPercent}% target.`);
  if (option.program === "3-phase") notes.push(`Three phases to pass: at least ${s.minimumTotalDays} trading days in total.`);
  if (option.lossesToDailyFloor !== null && option.riskPercent !== null && option.riskPercent > 1)
    notes.push(`Your risk is ${option.riskPercent}% of this account per trade; most risk plans use far less.`);
  return notes;
}

export const DEFAULT_FINDER_INPUT: FinderInput = { budget: null, priority: "lowest-fee", riskPerTrade: null, losingTrades: 3, programs: [], daysPerWeek: null };

/**
 * Reads the finder's choices from the address, e.g.
 * /challenges?fbudget=250&fpri=most-room&frisk=100&flosses=3&fprog=2-phase&fdays=3#finder.
 * Anything missing or out of range falls back to the default.
 */
export function parseFinderParams(params: URLSearchParams): FinderInput {
  const budget = Number(params.get("fbudget"));
  const risk = Number(params.get("frisk"));
  const losses = Number(params.get("flosses"));
  const priority = FINDER_PRIORITIES.find((p) => p.id === params.get("fpri"))?.id ?? DEFAULT_FINDER_INPUT.priority;
  const programs = (params.get("fprog") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is ProgramId => (PROGRAMS as string[]).includes(p));
  return {
    budget: params.get("fbudget") && Number.isFinite(budget) && budget > 0 && budget <= 1_000_000 ? round2(budget) : null,
    priority,
    riskPerTrade: params.get("frisk") && Number.isFinite(risk) && risk > 0 && risk <= 1_000_000 ? round2(risk) : null,
    losingTrades: (LOSING_STREAK_OPTIONS as readonly number[]).includes(losses) ? losses : DEFAULT_FINDER_INPUT.losingTrades,
    programs: [...new Set(programs)],
    daysPerWeek: validPace(Number(params.get("fdays"))),
  };
}

/** Query parameters for the finder (defaults are left out so links stay short). */
export function finderParams(input: FinderInput): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.budget !== null) out.fbudget = String(input.budget);
  if (input.priority !== DEFAULT_FINDER_INPUT.priority) out.fpri = input.priority;
  if (input.riskPerTrade !== null) out.frisk = String(input.riskPerTrade);
  if (input.losingTrades !== DEFAULT_FINDER_INPUT.losingTrades) out.flosses = String(input.losingTrades);
  const pace = validPace(input.daysPerWeek);
  if (pace !== null) out.fdays = String(pace);
  if (input.programs.length > 0 && input.programs.length < PROGRAMS.length) out.fprog = PROGRAMS.filter((p) => input.programs.includes(p)).join(",");
  return out;
}

export function finderLink(input: FinderInput): string {
  const query = new URLSearchParams(finderParams(input)).toString();
  return `/challenges${query ? `?${query}` : ""}#finder`;
}

import { MINIMUM_PAYOUT_USD, splitRange } from "@/lib/payoutEstimator";
import { CONSISTENCY_LIMIT_PERCENT, DAILY_RESET_UTC_HOUR, getRulePlan } from "@/lib/ruleCalculator";

/**
 * Plain-language glossary of the trading and evaluation terms used across the
 * site. FYNX-specific figures come from the published new-account schedule
 * (challengeConfig) so definitions stay in step with the Rules page. Worked
 * examples are arithmetic illustrations, not account data or market prices.
 */

export type GlossaryGroup = "rules" | "trading" | "payouts";

export const glossaryGroups: { id: GlossaryGroup; label: string }[] = [
  { id: "rules", label: "Evaluation & rules" },
  { id: "trading", label: "Trading basics" },
  { id: "payouts", label: "Funded stage & payouts" },
];

export interface GlossaryTerm {
  id: string;
  term: string;
  group: GlossaryGroup;
  /** Other words people search for. */
  aliases?: string[];
  definition: string;
  link?: { to: string; label: string };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const one = getRulePlan(25000, "1-phase");
const two = getRulePlan(25000, "2-phase");
const three = getRulePlan(25000, "3-phase");
const split = splitRange();

const terms: GlossaryTerm[] = [
  {
    id: "account-size",
    term: "Account size",
    group: "rules",
    aliases: ["starting balance", "capital"],
    definition: "The virtual starting balance of an evaluation account. Every profit target and loss limit is a percentage of it, and each phase starts again from the full account size. It is simulated, not a deposit.",
    link: { to: "/challenges", label: "Compare account sizes" },
  },
  {
    id: "balance",
    term: "Balance",
    group: "trading",
    definition: "Your account value counting only closed trades. It changes when a trade is closed, not while it is open.",
  },
  {
    id: "equity",
    term: "Equity",
    group: "trading",
    aliases: ["floating", "open profit"],
    definition: "Your balance plus the profit or loss of trades that are still open. The loss limits are checked against equity, so an open losing trade can breach a limit before it is closed.",
  },
  {
    id: "breach",
    term: "Breach",
    group: "rules",
    aliases: ["violation", "failed"],
    definition: "Breaking a hard rule, such as equity falling below the daily or maximum loss floor. The account may then be marked breached. Touching a floor exactly is allowed; going below it is not.",
    link: { to: "/faq#rule-breach", label: "What happens after a breach" },
  },
  {
    id: "consistency-rule",
    term: "Consistency rule",
    group: "rules",
    aliases: ["40%", "best day"],
    definition: `Your best positive trading day may be at most ${CONSISTENCY_LIMIT_PERCENT}% of your total net profit for the phase. It is not a loss breach: if one day is too large, you keep trading until total profit catches up. Example: with $2,000 total profit, the best day can be at most ${usd((2000 * CONSISTENCY_LIMIT_PERCENT) / 100)}.`,
    link: { to: "/rules#calculator", label: "Check your consistency" },
  },
  {
    id: "daily-loss-limit",
    term: "Daily loss limit",
    group: "rules",
    aliases: ["daily drawdown", "daily floor"],
    definition: `The most your equity may fall in one trading day: ${one.dailyLossPercent}% on 1-phase and ${two.dailyLossPercent}% on 2- and 3-phase, measured from the balance at the ${DAILY_RESET_UTC_HOUR}:00 UTC reset. Example: a ${two.dailyLossPercent}% limit on a $25,000 reset balance gives a floor of ${usd(25000 - (25000 * two.dailyLossPercent) / 100)}.`,
    link: { to: "/rules#calculator", label: "Calculate today's floor" },
  },
  {
    id: "daily-reset",
    term: "Daily reset",
    group: "rules",
    aliases: ["trading day", "rollover", "22:00"],
    definition: `The moment a new trading day starts: ${DAILY_RESET_UTC_HOUR}:00 UTC every day, all year, with no daylight-saving change. The daily loss floor is recalculated from your balance at that moment.`,
    link: { to: "/rules#trading-day", label: "See the reset in your time" },
  },
  {
    id: "drawdown",
    term: "Drawdown",
    group: "trading",
    definition: "How far an account has fallen from a previous high, in dollars or percent. Prop firms use it for loss limits; at FYNX Funded the maximum loss is measured from the phase's starting balance, not from your highest point.",
  },
  {
    id: "static-vs-trailing",
    term: "Static vs trailing drawdown",
    group: "rules",
    aliases: ["trailing", "static"],
    definition: `A trailing limit follows your highest balance up, so profits raise the floor. A static limit stays fixed. The FYNX Funded maximum loss is static: on a $25,000 2-phase account the floor stays at ${usd(two.maxLossFloor)} however much profit you make.`,
    link: { to: "/faq#maximum-loss", label: "How the maximum loss works" },
  },
  {
    id: "evaluation",
    term: "Evaluation (challenge)",
    group: "rules",
    aliases: ["challenge", "assessment"],
    definition: "The test stage of a program, traded on a simulated account. You pass by reaching each phase's profit target within the rules.",
    link: { to: "/how-it-works", label: "See how it works" },
  },
  {
    id: "phase",
    term: "Phase",
    group: "rules",
    aliases: ["step", "stage"],
    definition: "One step of an evaluation. Programs have 1, 2 or 3 phases; each has its own profit target and its own minimum trading days, and every phase starts again from the full account size.",
    link: { to: "/challenges#compare-programs", label: "Compare 1, 2 and 3 phases" },
  },
  {
    id: "maximum-loss",
    term: "Maximum loss limit",
    group: "rules",
    aliases: ["max drawdown", "overall loss"],
    definition: `The fixed floor your equity may never go below during a phase: ${one.maxLossPercent}% below the starting balance on 1-phase, ${two.maxLossPercent}% on 2-phase and ${three.maxLossPercent}% on 3-phase. Profits do not raise it.`,
    link: { to: "/rules#calculator", label: "See your floor in dollars" },
  },
  {
    id: "minimum-trading-days",
    term: "Minimum trading days",
    group: "rules",
    definition: `The fewest separate trading days you must trade in each phase before it can be passed: ${one.minDays} on 1-phase and ${two.minDays} on 2- and 3-phase. There is no maximum time limit.`,
  },
  {
    id: "trading-day",
    term: "Trading day",
    group: "rules",
    definition: `A day running from ${DAILY_RESET_UTC_HOUR}:00 UTC to ${DAILY_RESET_UTC_HOUR}:00 UTC the next day. Minimum trading days and the daily loss limit use these days, not calendar dates.`,
  },
  {
    id: "profit-target",
    term: "Profit target",
    group: "rules",
    definition: `The profit needed to complete a phase, as a percentage of the account size. Example: a $25,000 2-phase account needs ${usd(two.phases[0].targetProfit)} in phase 1, a balance of ${usd(two.phases[0].targetBalance)}.`,
    link: { to: "/rules#calculator", label: "Work out your targets" },
  },
  {
    id: "simulated-account",
    term: "Simulated account",
    group: "rules",
    aliases: ["demo", "virtual"],
    definition: "An account traded with virtual money on real-style market conditions. Evaluation and funded-stage accounts at FYNX Funded are simulated; balances are not deposits or withdrawable capital.",
    link: { to: "/risk-disclosure", label: "Read the risk disclosure" },
  },
  {
    id: "lot",
    term: "Lot",
    group: "trading",
    aliases: ["standard lot", "mini lot", "micro lot", "volume"],
    definition: "The unit for trade size in forex. One standard lot is 100,000 units of the base currency, 0.10 is a mini lot and 0.01 a micro lot. Check your platform's contract details, as they can differ by instrument.",
    link: { to: "/rules#position-size", label: "Work out a lot size" },
  },
  {
    id: "pip",
    term: "Pip",
    group: "trading",
    aliases: ["point"],
    definition: "The usual smallest price step quoted in forex: 0.0001 for most pairs and 0.01 for pairs priced in Japanese yen. For a USD-quoted pair such as EUR/USD, one pip on one standard lot is $10.",
  },
  {
    id: "pip-value",
    term: "Pip value",
    group: "trading",
    definition: "How many dollars one pip is worth for a given trade size. Multiplying it by your stop distance in pips tells you what a trade loses if the stop is hit.",
    link: { to: "/rules#position-size", label: "Open the position size calculator" },
  },
  {
    id: "stop-loss",
    term: "Stop loss",
    group: "trading",
    aliases: ["SL", "stop"],
    definition: "An order that closes a trade automatically at a chosen price to cap the loss. In fast markets the fill can be worse than the stop price (see slippage).",
  },
  {
    id: "take-profit",
    term: "Take profit",
    group: "trading",
    aliases: ["TP", "target"],
    definition: "An order that closes a trade automatically once it reaches a chosen profit.",
  },
  {
    id: "risk-per-trade",
    term: "Risk per trade",
    group: "trading",
    definition: "How much you would lose if a trade hits its stop, in dollars or as a percent of the account. Keeping it small leaves room for losing streaks under the daily and maximum loss limits.",
    link: { to: "/rules#risk-planner", label: "Plan your risk" },
  },
  {
    id: "risk-reward",
    term: "Risk-reward ratio",
    group: "trading",
    aliases: ["R:R", "reward", "RR", "R multiple"],
    definition: "The planned profit of a trade compared with its planned loss. Risking $100 to make $200 is 1:2. Results are often counted in R: a 1:2 winner is +2R and a full loss is −1R.",
  },
  {
    id: "win-rate",
    term: "Win rate",
    group: "trading",
    definition: "The share of closed trades that made money. On its own it says little: a low win rate can still be profitable with large winners, and a high one can lose money with large losers.",
  },
  {
    id: "break-even-win-rate",
    term: "Break-even win rate",
    group: "trading",
    definition: "The win rate at which a plan neither makes nor loses money before charges: 1 ÷ (1 + reward). At 1:1 it is 50%, at 1:2 about 33.3%, at 1:3 25%. Spread and commission push it higher.",
    link: { to: "/rules#risk-planner", label: "See it for your plan" },
  },
  {
    id: "payoff-ratio",
    term: "Payoff ratio",
    group: "trading",
    aliases: ["average win", "average loss"],
    definition: "Your average winning trade divided by your average losing trade. It is the real-world version of the risk-reward ratio, shown in your dashboard Analytics.",
  },
  {
    id: "profit-factor",
    term: "Profit factor",
    group: "trading",
    aliases: ["gross profit", "gross loss", "PF"],
    definition: "Everything your winning trades made divided by everything your losing trades lost. Above 1 the record made money, below 1 it lost money. $1,500 won and $1,000 lost is a profit factor of 1.5. With no losing trades yet it cannot be worked out.",
  },
  {
    id: "expectancy",
    term: "Expectancy",
    group: "trading",
    aliases: ["average trade", "average result per trade", "edge"],
    definition: "The average result of one closed trade: net profit or loss divided by the number of trades. $300 net over 20 trades is +$15 a trade. It describes the past record, not a promise about the next trade.",
  },
  {
    id: "spread",
    term: "Spread",
    group: "trading",
    aliases: ["bid", "ask"],
    definition: "The gap between the buy (ask) and sell (bid) price. Every trade starts slightly negative by this amount. Spreads widen around news and when markets are quiet.",
  },
  {
    id: "commission",
    term: "Commission",
    group: "trading",
    aliases: ["charges", "fees", "round turn"],
    definition: "A fee charged per lot traded. A round-turn figure covers opening and closing the trade. FYNX Funded charges are pending broker verification; the calculators let you type your own.",
  },
  {
    id: "slippage",
    term: "Slippage",
    group: "trading",
    definition: "The difference between the price you asked for and the price you got. It happens in fast or thin markets and can make a loss bigger than planned.",
  },
  {
    id: "leverage",
    term: "Leverage",
    group: "trading",
    aliases: ["margin"],
    definition: "Trading a position larger than the money set aside for it (the margin). It magnifies both gains and losses. No production leverage is approved yet for FYNX Funded accounts.",
  },
  {
    id: "sessions",
    term: "Trading sessions",
    group: "trading",
    aliases: ["Asia", "London", "New York"],
    definition: "The forex day is busiest when major financial centres are open. In your trade journal, trades opened 00:00–08:00 UTC are labelled Asia, 08:00–13:00 London and 13:00–24:00 New York.",
    link: { to: "/rules#trading-day", label: "See the sessions in your time" },
  },
  {
    id: "funded-stage",
    term: "Funded stage",
    group: "payouts",
    aliases: ["funded account"],
    definition: "The stage after passing every phase, where eligible rewards can be requested under your program agreement. It is also traded in a simulated environment.",
  },
  {
    id: "profit-split",
    term: "Profit split",
    group: "payouts",
    definition: `The share of net profit a funded trader keeps: between ${split.min}% and ${split.max}%, depending on account size and program. The split recorded with your purchase applies.`,
    link: { to: "/payouts#estimator", label: "Estimate a payout" },
  },
  {
    id: "payout-window",
    term: "Payout window",
    group: "payouts",
    definition: `The dates when payout requests open: the 1st–3rd and the 16th–18th of each month. The minimum payout is ${usd(MINIMUM_PAYOUT_USD)}, and every request is reviewed.`,
    link: { to: "/payouts#calendar", label: "Find the next window" },
  },
  {
    id: "kyc",
    term: "KYC (identity verification)",
    group: "payouts",
    aliases: ["know your customer", "ID", "AML"],
    definition: "Checks that confirm who you are before a payout, such as a government ID, proof of address and a selfie check, depending on the payment partner and applicable law.",
    link: { to: "/aml-kyc", label: "Read the AML/KYC policy" },
  },
  {
    id: "certificate",
    term: "Certificate",
    group: "payouts",
    definition: "A record of a passed evaluation or completed learning, with a public ID (FYNX-CERT-… or FYNX-LEARN-…) anyone can check on the verification page.",
    link: { to: "/certificates/verify", label: "Verify a certificate" },
  },
];

export const glossaryTerms: GlossaryTerm[] = [...terms].sort((a, b) => a.term.localeCompare(b.term, "en"));

const normalize = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Terms whose name, other names or definition contain every word typed; name matches first. */
export function searchGlossary(query: string, list: GlossaryTerm[] = glossaryTerms): GlossaryTerm[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const scored = list
    .map((t) => {
      const name = normalize([t.term, ...(t.aliases ?? [])].join(" "));
      const body = normalize(t.definition);
      if (!words.every((w) => name.includes(w) || body.includes(w))) return null;
      const score = words.filter((w) => name.includes(w)).length;
      return { t, score };
    })
    .filter((x): x is { t: GlossaryTerm; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.t);
}

const byId = new Map(terms.map((t) => [t.id, t]));

/** The glossary entry with this id, if there is one. */
export function getGlossaryTerm(id: string): GlossaryTerm | undefined {
  return byId.get(id);
}

/** Address of a term in the FAQ glossary, e.g. /faq#term-pip. */
export const glossaryTermLink = (id: string) => `/faq#term-${id}`;

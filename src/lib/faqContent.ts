import { MINIMUM_PAYOUT_USD, splitRange } from "@/lib/payoutEstimator";
import { CONSISTENCY_LIMIT_PERCENT, DAILY_RESET_UTC_HOUR, getRulePlan } from "@/lib/ruleCalculator";

/**
 * Public FAQ content. Every number is derived from the published new-account
 * schedule (challengeConfig) so answers stay in step with the Rules page.
 * Worked examples are arithmetic illustrations, not account data.
 */

export type FaqTopicId = "getting-started" | "rules" | "payouts" | "account";

export const faqTopics: { id: FaqTopicId; label: string }[] = [
  { id: "getting-started", label: "Getting started" },
  { id: "rules", label: "Rules & limits" },
  { id: "payouts", label: "Payouts" },
  { id: "account", label: "Account & purchases" },
];

export interface FaqItem {
  id: string;
  topic: FaqTopicId;
  q: string;
  a: string;
  link?: { to: string; label: string };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const one = getRulePlan(25000, "1-phase");
const two = getRulePlan(25000, "2-phase");
const three = getRulePlan(25000, "3-phase");
const split = splitRange();
const exampleDailyFloor = 25000 - (25000 * two.dailyLossPercent) / 100;
const exampleTotalProfit = 2000;
const exampleBestDayLimit = (exampleTotalProfit * CONSISTENCY_LIMIT_PERCENT) / 100;
const targets = (plan: typeof one) => plan.phases.map((p) => `${p.targetPercent}%`).join(", then ");

export const faqItems: FaqItem[] = [
  {
    id: "what-is-fynx-funded",
    topic: "getting-started",
    q: "What is FYNX Funded?",
    a: "FYNX Funded provides trading evaluation programs. Traders who meet the applicable objectives and eligibility requirements may advance to the funded stage described in their selected plan.",
    link: { to: "/how-it-works", label: "See how it works" },
  },
  {
    id: "how-evaluation-works",
    topic: "getting-started",
    q: "How does the evaluation work?",
    a: "The approved new-account schedule offers 1, 2 or 3 phases. Each phase requires its profit target, minimum trading days, 40% consistency and no loss breach. Eligibility requires human review; purchases remain closed. See Trading Rules for each program.",
    link: { to: "/rules", label: "Read the trading rules" },
  },
  {
    id: "instruments",
    topic: "getting-started",
    q: "What instruments can I trade?",
    a: "The planned scope is Forex with a USD account ledger. No production pairs or leverage are approved yet. Crypto and other markets are unavailable; the broker catalog is still being verified.",
  },
  {
    id: "how-quickly-paid",
    topic: "payouts",
    q: "How quickly can I get paid?",
    a: "Eligible users can submit a payout request from the dashboard. Available methods and estimated processing times are shown during the request and may depend on verification and the payment provider.",
    link: { to: "/payouts#calendar", label: "See the payout calendar" },
  },
  {
    id: "fee-returned",
    topic: "account",
    q: "Is the fee refundable?",
    a: "Fee-refund eligibility depends on the selected plan and the terms displayed at purchase. Check your order details for the rule that applies to you.",
    link: { to: "/refund-policy", label: "Read the policy" },
  },
  {
    id: "rule-breach",
    topic: "rules",
    q: "What happens if I breach a rule?",
    a: "If you violate a daily-loss limit, maximum-loss limit, or another applicable rule, the account may be marked breached. Any restart option and price will be shown separately if available.",
  },
  {
    id: "holding-positions",
    topic: "rules",
    q: "Can I hold trades over the weekend?",
    a: "No universal weekend or overnight permission is offered, including for Swing style. Permissions require the final account terms and verified broker instrument schedule. Purchases remain closed.",
  },
  {
    id: "time-limit",
    topic: "rules",
    q: "Is there a time limit to pass the challenge?",
    a: "No. There is no maximum time limit. Take as long as you need, as long as you meet the minimum trading days requirement.",
  },
  {
    id: "which-program",
    topic: "getting-started",
    q: "What is the difference between the 1-, 2- and 3-phase programs?",
    a: `They trade off speed against room for loss. 1-phase has a single ${one.phases[0].targetPercent}% target with ${one.dailyLossPercent}% daily and ${one.maxLossPercent}% maximum loss. 2-phase asks for ${targets(two)} with ${two.dailyLossPercent}% daily and ${two.maxLossPercent}% maximum loss. 3-phase asks for ${targets(three)} with ${three.dailyLossPercent}% daily and ${three.maxLossPercent}% maximum loss. Prices and the funded profit split also differ by account size.`,
    link: { to: "/challenges#compare-programs", label: "Compare programs" },
  },
  {
    id: "profit-targets",
    topic: "rules",
    q: "What are the profit targets?",
    a: `1-phase: ${targets(one)}. 2-phase: ${targets(two)}. 3-phase: ${targets(three)}. Each target is a percentage of the account size, and every phase starts again from the full account size. Example: on a $25,000 2-phase account the first target is ${usd(two.phases[0].targetProfit)} profit, a balance of ${usd(two.phases[0].targetBalance)}.`,
    link: { to: "/rules#calculator", label: "Work out your targets" },
  },
  {
    id: "daily-reset",
    topic: "rules",
    q: "When does the trading day reset?",
    a: `Every trading day resets at ${DAILY_RESET_UTC_HOUR}:00 UTC, all year round, with no daylight-saving change. At that moment the daily loss floor is recalculated from your balance.`,
    link: { to: "/rules#trading-day", label: "See the reset in your time" },
  },
  {
    id: "daily-loss",
    topic: "rules",
    q: "How is the daily loss limit calculated?",
    a: `Your daily floor is the balance at the ${DAILY_RESET_UTC_HOUR}:00 UTC reset minus ${one.dailyLossPercent}% (1-phase) or ${two.dailyLossPercent}% (2- and 3-phase). Equity, including open profit or loss, is compared with that floor. Touching the floor is allowed; falling below it records a breach. Example: a ${two.dailyLossPercent}% limit on a $25,000 reset balance gives a floor of ${usd(exampleDailyFloor)}.`,
    link: { to: "/rules#calculator", label: "Calculate today's floor" },
  },
  {
    id: "maximum-loss",
    topic: "rules",
    q: "How does the maximum loss limit work?",
    a: `The maximum loss is static: ${one.maxLossPercent}% for 1-phase, ${two.maxLossPercent}% for 2-phase and ${three.maxLossPercent}% for 3-phase, measured from the starting balance of the phase. Profits do not raise this floor. Example: a $25,000 2-phase account has a fixed floor of ${usd(two.maxLossFloor)}.`,
  },
  {
    id: "lot-size",
    topic: "rules",
    q: "How do I work out my lot size?",
    a: "Decide how much you are willing to lose on the trade, then divide it by what one lot loses if your stop is hit. Example: risking $125 with a 25-pip stop on EUR/USD, where one standard lot (100,000 units) moves $10 per pip, gives $125 ÷ $250 = 0.50 lots. Contract sizes and charges for FYNX Funded accounts are pending broker verification, so check your platform's contract details before trading.",
    link: { to: "/rules#position-size", label: "Open the position size calculator" },
  },
  {
    id: "pass-odds",
    topic: "rules",
    q: "How likely is my trading plan to pass?",
    a: "Nobody can tell you in advance, but you can test how the rules treat a plan. The pass simulator on the Rules page plays your risk per trade, reward, win rate and trades per day forward thousands of times against the daily loss, maximum loss, minimum days and 40% consistency rules, and shows how often it passes, how it fails and how many trading days it usually takes. It is a simplified illustration, not a prediction: real trades don't win or lose exactly the planned amount.",
    link: { to: "/rules#simulator", label: "Open the pass simulator" },
  },
  {
    id: "consistency-rule",
    topic: "rules",
    q: "How does the 40% consistency rule work?",
    a: `Your best positive trading day must be no more than ${CONSISTENCY_LIMIT_PERCENT}% of your total net profit for the phase. It is not a loss breach: if one day is too large, you keep trading until total profit grows enough. Example: with ${usd(exampleTotalProfit)} total profit, the best day can be at most ${usd(exampleBestDayLimit)}.`,
    link: { to: "/rules#calculator", label: "Check your consistency" },
  },
  {
    id: "minimum-days",
    topic: "rules",
    q: "How many trading days do I need?",
    a: `At least ${one.minDays} trading days per phase on 1-phase, and ${two.minDays} trading days per phase on 2- and 3-phase programs. Over a full 3-phase evaluation that is at least ${three.minDays * three.phases.length} trading days.`,
  },
  {
    id: "profit-split",
    topic: "payouts",
    q: "What profit split do funded traders keep?",
    a: `Between ${split.min}% and ${split.max}% of net profit, depending on the account size and the program you passed. The split recorded with your purchase always applies.`,
    link: { to: "/payouts#estimator", label: "Estimate a payout" },
  },
  {
    id: "payout-eligibility",
    topic: "payouts",
    q: "What do I need before requesting a payout?",
    a: `At least 5 trading days since your last payout, no active rule violations, all positions closed, identity verification (KYC) completed, and a payout of at least ${usd(MINIMUM_PAYOUT_USD)}. Every request is reviewed before it is approved.`,
    link: { to: "/payouts", label: "See payout requirements" },
  },
  {
    id: "payout-windows",
    topic: "payouts",
    q: "When can I request a payout?",
    a: "Requests open twice a month: from the 1st to the 3rd (paid around the 5th to the 7th) and from the 16th to the 18th (paid around the 20th to the 22nd). Dates outside these windows wait for the next one.",
    link: { to: "/payouts#calendar", label: "Find the next window" },
  },
  {
    id: "identity-verification",
    topic: "account",
    q: "Do I need to verify my identity?",
    a: "Yes, before a payout. Verification may ask for a government ID, proof of address and a selfie check, depending on the payment partner and applicable law.",
    link: { to: "/aml-kyc", label: "Read the AML/KYC policy" },
  },
  {
    id: "certificate-verification",
    topic: "account",
    q: "How can someone check that my certificate is real?",
    a: "Every certificate has a public ID (FYNX-CERT-… or FYNX-LEARN-…) and a verification link. Anyone can enter the ID on the certificate verification page to see whether it is valid and still active. Revoked certificates show as not verified.",
    link: { to: "/certificates/verify", label: "Verify a certificate" },
  },
  {
    id: "simulated-accounts",
    topic: "account",
    q: "Is the account balance real money?",
    a: "No. Evaluation and funded-stage trading take place in simulated environments. Account sizes and balances are virtual; they are not deposits or withdrawable capital. Any eligible reward is governed by your program agreement.",
    link: { to: "/risk-disclosure", label: "Read the risk disclosure" },
  },
  {
    id: "multiple-accounts",
    topic: "account",
    q: "Can I open more than one account?",
    a: "Operating more than one account per person is not allowed unless it has been authorized in writing.",
    link: { to: "/terms#registration", label: "Read the terms" },
  },
];

import { estimatePayout, MINIMUM_PAYOUT_USD } from "@/lib/payoutEstimator";
import { formatDay, formatRange, payoutWindowStatus, type PayoutWindowStatus } from "@/lib/payoutCalendar";
import type { ProgramId } from "@/lib/ruleCalculator";

/**
 * Payout readiness self-check, built only from the published eligibility list
 * (see the Payouts page and /faq#payout-eligibility). It is a planning aid for
 * the trader: it does not submit, approve or decide anything, and every real
 * request is reviewed against the terms recorded with the purchase.
 */

export const MIN_TRADING_DAYS_BETWEEN_PAYOUTS = 5;

export type CheckState = "met" | "missing" | "unanswered";

export interface ReadinessCheck {
  id: "days" | "violations" | "positions" | "kyc" | "minimum";
  label: string;
  state: CheckState;
  detail: string;
}

export interface ReadinessInput {
  accountSize: number;
  program: ProgramId;
  /** Net profit since the last payout (or on the funded account, for a first payout). */
  netProfit: number | null;
  /** Trading days since the last payout (or on the funded account, for a first payout). */
  tradingDays: number | null;
  noViolations: boolean | null;
  positionsClosed: boolean | null;
  kycDone: boolean | null;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  metCount: number;
  missing: ReadinessCheck[];
  unanswered: ReadinessCheck[];
  ready: boolean;
  splitPercent: number;
  traderShare: number;
  profitForMinimum: number;
  daysShort: number;
  window: PayoutWindowStatus;
  /** One plain sentence on what to do next and when. */
  summary: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const yesNo = (value: boolean | null, yes: string, no: string, unanswered: string): Pick<ReadinessCheck, "state" | "detail"> =>
  value === null ? { state: "unanswered", detail: unanswered } : value ? { state: "met", detail: yes } : { state: "missing", detail: no };

export function checkPayoutReadiness(input: ReadinessInput, now: Date): ReadinessResult {
  const days = input.tradingDays !== null && Number.isFinite(input.tradingDays) && input.tradingDays >= 0 ? Math.floor(input.tradingDays) : null;
  const profit = input.netProfit !== null && Number.isFinite(input.netProfit) ? input.netProfit : null;
  const estimate = estimatePayout(input.accountSize, input.program, profit ?? 0);
  const daysShort = days === null ? 0 : Math.max(0, MIN_TRADING_DAYS_BETWEEN_PAYOUTS - days);

  const checks: ReadinessCheck[] = [
    {
      id: "days",
      label: `At least ${MIN_TRADING_DAYS_BETWEEN_PAYOUTS} trading days since your last payout`,
      ...(days === null
        ? { state: "unanswered" as const, detail: "Enter how many trading days you have had. For a first payout, count the days on your funded account." }
        : daysShort === 0
          ? { state: "met" as const, detail: `${plural(days, "trading day")}, the minimum is ${MIN_TRADING_DAYS_BETWEEN_PAYOUTS}.` }
          : { state: "missing" as const, detail: `${plural(days, "trading day")} so far: trade on ${plural(daysShort, "more day")}. A trading day runs 22:00 to 22:00 UTC.` }),
    },
    {
      id: "violations",
      label: "No active rule violations",
      ...yesNo(
        input.noViolations,
        "No open violations on the account.",
        "A request can't be approved while a rule violation is active. Check the account's Objectives page or contact support.",
        "Answer yes or no.",
      ),
    },
    {
      id: "positions",
      label: "All positions closed when you send the request",
      ...yesNo(
        input.positionsClosed,
        "Nothing open.",
        "Close every open position before you send the request. Open trades can still change your profit.",
        "Answer yes or no.",
      ),
    },
    {
      id: "kyc",
      label: "Identity verification (KYC) completed",
      ...yesNo(
        input.kycDone,
        "Verification is done.",
        "Finish identity verification in your dashboard first. Reviews can take time, so start early.",
        "Answer yes or no.",
      ),
    },
    {
      id: "minimum",
      label: `Payout of at least ${usd(MINIMUM_PAYOUT_USD)}`,
      ...(profit === null
        ? { state: "unanswered" as const, detail: "Enter your net profit to estimate your share." }
        : estimate.meetsMinimum
          ? { state: "met" as const, detail: `Your ${estimate.splitPercent}% share of ${usd(estimate.profit)} is about ${usd(estimate.traderShare)}.` }
          : {
              state: "missing" as const,
              detail: `Your ${estimate.splitPercent}% share is about ${usd(estimate.traderShare)}. You need about ${usd(estimate.profitForMinimum)} net profit to reach ${usd(MINIMUM_PAYOUT_USD)}.`,
            }),
    },
  ];

  const missing = checks.filter((c) => c.state === "missing");
  const unanswered = checks.filter((c) => c.state === "unanswered");
  const metCount = checks.filter((c) => c.state === "met").length;
  const ready = metCount === checks.length;
  const window = payoutWindowStatus(now);
  const w = window.window;
  const range = formatRange(w.requestStart, w.requestEnd);

  let summary: string;
  if (ready) {
    summary = window.open
      ? `Everything on the list is in place. The request window is open now until ${formatDay(w.requestEnd)} (UTC), so you can send your request from the dashboard.`
      : `Everything on the list is in place. The next request window is ${range} (opens in ${plural(window.daysUntilOpen, "day")}); send your request from the dashboard then.`;
  } else if (missing.length) {
    summary = `${plural(missing.length, "thing")} to sort out before you request. The next request window is ${range}${window.open ? " (open now)" : ""}.`;
  } else {
    summary = `Answer the remaining ${plural(unanswered.length, "question")} to see if you're ready.`;
  }

  return {
    checks,
    metCount,
    missing,
    unanswered,
    ready,
    splitPercent: estimate.splitPercent,
    traderShare: estimate.traderShare,
    profitForMinimum: estimate.profitForMinimum,
    daysShort,
    window,
    summary,
  };
}

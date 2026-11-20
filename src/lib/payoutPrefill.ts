import { accountPlanFor } from "@/lib/accountPlan";
import { MIN_TRADING_DAYS_BETWEEN_PAYOUTS, type ReadinessCheck, type ReadinessInput } from "@/lib/payoutReadiness";
import { previousReset } from "@/lib/tradingDayClock";
import { timestamp, type Trade } from "@/lib/tradingData";
import type { ProgramId } from "@/lib/ruleCalculator";

/**
 * Fills the payout self-check (src/lib/payoutReadiness.ts) from the trader's own
 * records instead of asking: closed trades in the `trades` collection (the
 * FYNX Trade engine's ledger writes them in this shape), the trader's payout
 * requests, identity verification and, for FYNX Trade accounts, the live
 * engine snapshot. Anything the records can't tell stays unanswered and says
 * why. A planning aid only: it decides nothing and sends nothing.
 */

export type PrefillSource = "trades" | "payouts" | "live" | "account" | "kyc" | "unknown";

export interface PrefillChallenge {
  challengeId: string;
  accountSize: number;
  phase: string;
  status: string;
  currentPhase?: number;
  brokerAccountId?: string | null;
  accountId?: string;
  fundedAt?: unknown;
}

export interface PrefillAccount {
  accountId: string;
  login?: string;
  platform?: string;
  status?: string;
  fundedAt?: unknown;
}

export interface PrefillPayout {
  accountId: string;
  status: string;
  requestedAt: string;
  amount?: number;
}

export interface PrefillLive {
  /** Open positions the engine holds for the account right now. */
  positions: number;
  status: "active" | "passed" | "breached" | "disabled";
}

export interface PayoutPrefillInput {
  challenge: PrefillChallenge;
  account?: PrefillAccount | null;
  /** The trader's closed trades (any account; this account's are picked here). */
  trades: Trade[];
  payouts: PrefillPayout[];
  /** How many funded accounts the trader has: payout requests without an account belong to the only one. */
  fundedCount: number;
  /** Identity verification (and email) done; null while unknown. */
  kycVerified: boolean | null;
  /** Live FYNX Trade figures; null/undefined when the account is not on FYNX Trade or the engine is not connected. */
  live?: PrefillLive | null;
}

export interface PrefillNote {
  source: PrefillSource;
  /** Where the answer came from, in plain words. */
  note: string;
}

export interface PayoutPrefill {
  /** null when the plan's size/program is not in the published schedule. */
  program: ProgramId | null;
  accountSize: number;
  input: Omit<ReadinessInput, "accountSize" | "program">;
  notes: Record<ReadinessCheck["id"], PrefillNote>;
  /** The moment counting starts from: the last approved/paid payout request, else the funded date. */
  since: { at: string; kind: "payout" | "funded" } | null;
  /** Closed trades counted since then. */
  tradesCounted: number;
  /** A request already waiting for review (newest), if any. */
  pending: { requestedAt: string; amount: number | null } | null;
}

const PAID = new Set(["approved", "paid"]);
const WAITING = new Set(["requested", "pending", "processing"]);
const NOT_TRADING = new Set(["suspended", "closed", "breached", "failed", "disabled", "archived"]);

const round2 = (n: number) => Math.round(n * 100) / 100;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Ids this funded account may be recorded under on trades and payout requests. */
export function accountIds(challenge: PrefillChallenge, account?: PrefillAccount | null): string[] {
  return [...new Set([challenge.challengeId, challenge.brokerAccountId, challenge.accountId, account?.accountId, account?.login].filter((x): x is string => typeof x === "string" && x.length > 0))];
}

/** Payout requests that belong to this account (a request without an account belongs to the only funded account). */
export function accountPayouts<T extends PrefillPayout>(payouts: T[], ids: string[], fundedCount: number): T[] {
  return payouts.filter((p) => (p.accountId ? ids.includes(p.accountId) : fundedCount === 1));
}

const timeOf = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function payoutPrefill(input: PayoutPrefillInput): PayoutPrefill {
  const { challenge, account, live } = input;
  const view = accountPlanFor({ accountSize: challenge.accountSize, phase: challenge.phase, currentPhase: challenge.currentPhase, status: challenge.status });
  const ids = accountIds(challenge, account);
  const mine = accountPayouts(input.payouts, ids, input.fundedCount);

  const lastPaid = mine
    .filter((p) => PAID.has(String(p.status).toLowerCase()) && timeOf(p.requestedAt) !== null)
    .sort((a, b) => timeOf(b.requestedAt)! - timeOf(a.requestedAt)!)[0];
  const waiting = mine
    .filter((p) => WAITING.has(String(p.status).toLowerCase()) && timeOf(p.requestedAt) !== null)
    .sort((a, b) => timeOf(b.requestedAt)! - timeOf(a.requestedAt)!)[0];
  const fundedAt = timestamp(challenge.fundedAt) || timestamp(account?.fundedAt);
  const since = lastPaid
    ? { at: new Date(timeOf(lastPaid.requestedAt)!).toISOString(), kind: "payout" as const }
    : fundedAt ? { at: fundedAt, kind: "funded" as const } : null;

  const sinceText = since ? (since.kind === "payout" ? `since your last approved payout request (${day(since.at)}, UTC)` : `since this account was funded (${day(since.at)}, UTC)`) : "";
  const counted = since
    ? input.trades.filter((t) => {
        const closed = timeOf(t.closeTime);
        if (closed === null || closed <= Date.parse(since.at)) return false;
        return (t.challengeId && t.challengeId === challenge.challengeId) || (!!t.accountId && ids.includes(t.accountId));
      })
    : [];

  let tradingDays: number | null = null;
  let netProfit: number | null = null;
  let daysNote: PrefillNote;
  let profitNote: PrefillNote;
  if (!since) {
    const why = "This account's records don't say when it was funded, so trades can't be counted. Enter it yourself in the self-check.";
    daysNote = { source: "unknown", note: why };
    profitNote = { source: "unknown", note: why };
  } else {
    tradingDays = new Set(counted.map((t) => previousReset(new Date(t.closeTime)).getTime())).size;
    netProfit = round2(counted.reduce((sum, t) => sum + t.pnl, 0));
    const n = counted.length;
    daysNote = {
      source: "trades",
      note: n
        ? `Days with a closed trade ${sinceText}, counted 22:00 to 22:00 UTC, from ${n} recorded trade${n === 1 ? "" : "s"}.`
        : `No closed trades recorded ${sinceText}.`,
    };
    profitNote = {
      source: "trades",
      note: n ? `Net result of those trades (charges included as recorded) ${sinceText}. Open trades are not counted.` : `No closed trades recorded ${sinceText}.`,
    };
  }

  const accountStatus = String(account?.status ?? "").toLowerCase();
  let noViolations: boolean | null = null;
  let violationsNote: PrefillNote = {
    source: "unknown",
    note: "Your records here can't show every rule review. Check your account's Objectives page, then answer it in the self-check.",
  };
  if (live?.status === "breached" || live?.status === "disabled") {
    noViolations = false;
    violationsNote = { source: "live", note: live.status === "breached" ? "FYNX Trade shows a broken loss limit on this account." : "FYNX Trade shows this account as switched off." };
  } else if (NOT_TRADING.has(accountStatus)) {
    noViolations = false;
    violationsNote = { source: "account", note: `The trading account is recorded as ${accountStatus}.` };
  } else if (live) {
    noViolations = true;
    violationsNote = { source: "live", note: "FYNX Trade shows no broken loss limit right now. Every request is still reviewed." };
  }

  const positionsClosed = live ? live.positions === 0 : null;
  const positionsNote: PrefillNote = live
    ? { source: "live", note: live.positions === 0 ? "FYNX Trade shows no open trades right now." : `FYNX Trade shows ${live.positions} open trade${live.positions === 1 ? "" : "s"} right now.` }
    : { source: "unknown", note: "Open trades on this account aren't visible here. Check your trading platform before you request." };

  const kycNote: PrefillNote = input.kycVerified === null
    ? { source: "unknown", note: "Checking your verification…" }
    : { source: "kyc", note: input.kycVerified ? "From your identity verification." : "Identity (and email) verification isn't complete yet." };

  return {
    program: view?.program ?? null,
    accountSize: challenge.accountSize,
    input: { tradingDays, netProfit, noViolations, positionsClosed, kycDone: input.kycVerified },
    notes: { days: daysNote, minimum: profitNote, violations: violationsNote, positions: positionsNote, kyc: kycNote },
    since,
    tradesCounted: counted.length,
    pending: waiting ? { requestedAt: new Date(timeOf(waiting.requestedAt)!).toISOString(), amount: typeof waiting.amount === "number" && Number.isFinite(waiting.amount) ? waiting.amount : null } : null,
  };
}

/** Link to the public self-check with the figures filled in (only the ones that are known). */
export function selfCheckLink(prefill: PayoutPrefill): string {
  const q = new URLSearchParams();
  q.set("size", String(prefill.accountSize));
  if (prefill.program) q.set("program", prefill.program);
  if (prefill.input.tradingDays !== null) q.set("days", String(prefill.input.tradingDays));
  if (prefill.input.netProfit !== null) q.set("profit", String(prefill.input.netProfit));
  return `/payouts?${q.toString()}#readiness`;
}

export { MIN_TRADING_DAYS_BETWEEN_PAYOUTS };

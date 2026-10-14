import Decimal from "decimal.js";
import { evaluate } from "./fundedPolicy";

type RecordData = Record<string, any>;
export function milliseconds(value: any): number | null {
  const n = typeof value?.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
export function decimal(value: unknown): string | null {
  if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d{1,18}(\.\d{1,12})?$/.test(String(value))) return null;
  return new Decimal(value).toFixed();
}

/** Read model only. Never writes evaluations, changes phases, or approves a payout. */
export function accountInsights(challenge: RecordData, events: RecordData[], now: number) {
  const base = { currency: challenge.currency || "USD", phase: challenge.currentPhase ?? 1, checkedAt: now,
    status: "awaiting_history", snapshot: null as RecordData | null, points: [] as RecordData[],
    historyTruncated: false, eventCount: 0, authorizesTrading: false, authorizesPayout: false };
  const policy = challenge.rulePolicy;
  if (!policy || !events.length) return base;
  try {
    if (events.length > 5000 || policy.policy_version !== challenge.rulePolicyVersion || policy.program !== challenge.phase ||
        policy.phase !== base.phase || policy.starting_balance !== String(challenge.accountSize) || policy.currency !== base.currency ||
        policy.coverage?.account_id !== challenge.brokerAccountId || !challenge.brokerAccountId) throw Error("binding");
    const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
    const result = evaluate({ ...policy, recorded_breach: challenge.recordedBreach || challenge.rulePolicyEvaluation?.state?.breach }, ordered);
    const state = result.state, asOf = milliseconds(state.last_timestamp);
    // A current receipt time cannot make old broker evidence current.
    if (asOf == null || asOf > now || !state.metrics) throw Error("timestamp");
    const daily = new Decimal(state.metrics.daily_remaining), overall = new Decimal(state.metrics.max_remaining);
    const status = now - asOf <= 60000 ? "recent_snapshot" : "stale_snapshot";
    return { ...base, status, eventCount: ordered.length, historyTruncated: ordered.length > 500,
      snapshot: { asOf, balance: state.balance, equity: state.equity, dailyFloor: state.metrics.daily_floor,
        maximumFloor: state.metrics.max_floor, dailyRemaining: daily.toFixed(), maximumRemaining: overall.toFixed(),
        remaining: Decimal.max(0, Decimal.min(daily, overall)).toFixed(), breached: !!state.breach,
        policyVersion: result.policy_version, openPositions: state.open_positions,
        coverageFrom: milliseconds(policy.coverage.from), coverageThrough: milliseconds(policy.coverage.through) },
      // Keep exact independent broker marks, not reconstructed closed-trade P&L.
      points: ordered.slice(-500).map(e => ({ id: e.source_event_id, at: milliseconds(e.timestamp), balance: e.broker_balance, equity: e.broker_equity })) };
  } catch { return { ...base, status: "review_required" }; }
}

export function payoutSnapshot(account: RecordData | undefined, challenge: RecordData, now: number) {
  const raw = account?.availablePayoutAmount ?? account?.withdrawableAmount;
  const amount = decimal(raw);
  const nextAt = milliseconds(account?.nextEligiblePayoutAt ?? challenge.nextEligiblePayoutAt ?? account?.nextPayoutAt ?? challenge.nextPayoutAt ?? account?.nextEligiblePayoutDate ?? challenge.nextEligiblePayoutDate);
  return { available: amount != null && new Decimal(amount).gte(0) ? amount : null, nextAt,
    recordedAt: milliseconds(account?.payoutUpdatedAt), checkedAt: now, requiresReview: true };
}

import { describe, expect, it } from "vitest";
import { accountInsights, payoutSnapshot, decimal } from "../src/fundedInsightsPolicy";
import { ruleSnapshot } from "../src/fundedPolicy";

export function fixture() {
  const start = "2026-10-01T10:00:00Z", through = "2026-10-01T10:01:00Z";
  const rule = ruleSnapshot({ program: "1-phase", phase: 1, starting_balance: "10000", currency: "USD" });
  const policy = { policy_version: "fynx-funded-v1", program: "1-phase", phase: 1, starting_balance: "10000", currency: "USD", start_timestamp: start,
    agreement: { verified: true, reference: "agreement", document_sha256: "a".repeat(64), accepted_at: start, reviewed_at: start, reviewed_by: "reviewer", policy_version: "fynx-funded-v1", rule_snapshot: rule },
    coverage: { complete: true, pagination_complete: true, equity_complete: true, source_reference: "broker-export", adapter_version: "1", reviewed_by: "reviewer", reviewed_at: through, source_sha256: "b".repeat(64), from: start, through, event_count: 1, source_sequence_start: 1, source_sequence_end: 1, account_id: "broker-1", phase_reference: "agreement:phase:1" } };
  const challenge = { userId: "owner", currency: "USD", phase: "1-phase", currentPhase: 1, accountSize: 10000, brokerAccountId: "broker-1", rulePolicyVersion: "fynx-funded-v1", rulePolicy: policy };
  const events = [{ sequence: 1, timestamp: through, event_type: "equity_mark", open_position_count: 1, unrealized_pnl_after: "-200", account_id: "broker-1", phase_reference: "agreement:phase:1", source_sequence: 1, source_event_id: "mark-1", broker_balance: "10000", broker_equity: "9800" }];
  return { challenge, events, now: Date.parse(through) + 1000 };
}
describe("authenticated account insight read model", () => {
  it("uses independent equity and the smaller exact remaining allowance", () => {
    const { challenge, events, now } = fixture(); const result = accountInsights(challenge, events, now);
    expect(result.status).toBe("recent_snapshot"); expect(result.snapshot).toMatchObject({ balance: "10000", equity: "9800", dailyFloor: "9600", maximumFloor: "9200", remaining: "200" });
    expect(result.points[0].equity).toBe("9800"); expect(result.authorizesTrading).toBe(false);
  });
  it("never labels historical broker evidence current after a fresh request", () => {
    const { challenge, events, now } = fixture(); expect(accountInsights(challenge, events, now + 60001).status).toBe("stale_snapshot");
  });
  it.each(["broker", "phase", "currency", "balance", "coverage", "duplicate", "future", "gap"])("withholds %s inconsistencies", mode => {
    const { challenge, events, now } = fixture();
    if (mode === "broker") challenge.brokerAccountId = "other";
    if (mode === "phase") challenge.currentPhase = 2;
    if (mode === "currency") challenge.currency = "EUR";
    if (mode === "balance") events[0].broker_balance = "9999";
    if (mode === "coverage") challenge.rulePolicy.coverage.equity_complete = false;
    if (mode === "duplicate") events.push(events[0]);
    if (mode === "gap") events[0].sequence = 2;
    const result = accountInsights(challenge, events, mode === "future" ? now - 2000 : now);
    expect(result.status).toBe("review_required"); expect(result.snapshot).toBeNull(); expect(result.points).toEqual([]);
  });
  it("does not fabricate missing data or erase zero amounts", () => {
    expect(accountInsights({}, [], Date.now()).snapshot).toBeNull();
    expect(payoutSnapshot(undefined, {}, Date.now()).available).toBeNull();
    expect(payoutSnapshot({ availablePayoutAmount: "0" }, {}, 0).available).toBe("0");
    expect(decimal(true)).toBeNull(); expect(decimal("Infinity")).toBeNull();
  });
  it("preserves breach evidence even when the latest equity recovers", () => {
    const { challenge, events, now } = fixture();
    expect(accountInsights({ ...challenge, recordedBreach: { reasons: ["daily_loss"], timestamp: events[0].timestamp } }, events, now).snapshot?.breached).toBe(true);
  });
});

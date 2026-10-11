import { expect, it } from "vitest";
import { changedNotice, eventKey, pushMessage } from "../src/fundedNotificationPolicy";
it("ignores price ticks, creation, deletion and owner changes", () => {
  const before = { userId: "one", status: "active", equity: 100 };
  expect(changedNotice("accounts", "a", before, { ...before, equity: 99 })).toBeNull();
  expect(changedNotice("accounts", "a", null, before)).toBeNull();
  expect(changedNotice("accounts", "a", before, null)).toBeNull();
  expect(changedNotice("accounts", "a", before, { ...before, userId: "two", status: "funded" })).toBeNull();
});
it("detects status, phase and payout schedule updates", () => {
  expect(changedNotice("challenges", "c", { userId: "one", status: "active" }, { userId: "one", status: "funded" })?.accountID).toBe("c");
  expect(changedNotice("accounts", "a", { userId: "one", currentPhase: 1 }, { userId: "one", currentPhase: 2 })?.accountID).toBe("account-a");
  expect(changedNotice("payouts", "p", { userId: "one", status: "requested" }, { userId: "one", status: "paid", challengeId: "c" })?.titleKey).toBe("Payout updated");
});
it("uses stable event deduplication and private lock-screen content", () => {
  expect(eventKey("duplicate")).toBe(eventKey("duplicate")); expect(eventKey("one")).not.toBe(eventKey("two"));
  const payload = pushMessage("device-secret", eventKey("one"));
  expect(payload.data.deepLink).toBe("fynx://funded");
  expect(JSON.stringify(payload.notification)).not.toMatch(/balance|paid|breach|password|@/);
  expect(payload.apns.headers["apns-collapse-id"].length).toBe(64);
});

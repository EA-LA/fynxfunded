import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ records: new Map<string, any>(), mfa: vi.fn(), commitFails: false, n: 0 }));
vi.mock("../src/fundedMfa", () => ({ requireFundedMfa: fake.mfa }));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (_: unknown, handler: unknown) => handler }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (handler: unknown) => handler, HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("firebase-admin", () => {
  const ref = (path: string) => ({ path, get: async () => ({ exists: fake.records.has(path), data: () => fake.records.get(path) }) });
  const db = { collection: (name: string) => ({ doc: (id = String(++fake.n)) => ref(`${name}/${id}`) }), runTransaction: async (run: any) => {
    const writes: any[] = []; const result = await run({ get: (r: any) => r.get(), set: (r: any, value: any) => writes.push([r.path, value]) });
    if (fake.commitFails) throw Error("storage unavailable");
    for (const [p, v] of writes) fake.records.set(p, { ...fake.records.get(p), ...v }); return result;
  } };
  return { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "server-time" } }) };
});
import { adminChallengeProgression } from "../src/challengeProgression";
const run = adminChallengeProgression as any;
const request = (action: string, reason?: string) => ({ auth: { uid: "owner", token: { email: "fynxteam5@gmail.com", email_verified: true } }, data: { challengeId: "c1", action, reason } });
beforeEach(() => { fake.records.clear(); fake.records.set("challenges/c1", { status: "active" }); fake.commitFails = false; vi.clearAllMocks(); });
it.each(["pass", "fund"])("cannot bypass production evidence using manual %s", async action => {
  await expect(run(request(action))).rejects.toMatchObject({ code: "failed-precondition" }); expect(fake.records.size).toBe(1);
});
it("requires verified owner identity and MFA", async () => {
  const input = request("set_manual"); input.auth.token.email_verified = false;
  await expect(run(input)).rejects.toMatchObject({ code: "permission-denied" });
  fake.mfa.mockRejectedValueOnce(Error("MFA required")); await expect(run(request("set_manual"))).rejects.toThrow("MFA required");
});
it("requires a reason and atomically persists the manual failure and audit", async () => {
  await expect(run(request("fail"))).rejects.toMatchObject({ code: "invalid-argument" });
  await run(request("fail", "Reviewed broker evidence confirms the violation."));
  expect(fake.records.get("challenges/c1")).toMatchObject({ status: "failed", ruleStatus: "failed", breachRecorded: true, recordedBreach: { reasons: ["manual_review"] } });
  expect([...fake.records.values()].some(x => x.action === "admin_fail" && x.actorUid === "owner" && x.reason)).toBe(true);
});
it("retains original breach evidence on repeat manual review", async () => {
  const original = { reasons: ["daily_loss"], timestamp: "2026-10-01T00:00:00Z" };
  fake.records.set("challenges/c1", { recordedBreach: original });
  await run(request("fail", "Reviewed the existing breach evidence again.")); expect(fake.records.get("challenges/c1").recordedBreach).toEqual(original);
});
it("storage failure cannot produce a partial failure record", async () => {
  fake.commitFails = true; await expect(run(request("fail", "Reviewed source history and confirmed violation."))).rejects.toThrow("storage unavailable");
  expect(fake.records.get("challenges/c1")).toEqual({ status: "active" }); expect(fake.records.size).toBe(1);
});

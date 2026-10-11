import { beforeEach, describe, expect, it } from "vitest";
import { executeDeletion, planHash, suppressRestoredDeletions, validatePlan, type DeletionPlan, type RestoreLedger } from "../src/fundedRetention";
const records = new Map<string, any>(); const ledger = new Map<string, any>();
let version = "100:1", nested = false, commitFails = false;
const ref = (path: string): any => ({ path, listCollections: async () => nested ? [{}] : [], get: async () => ({ ref: ref(path), exists: records.has(path), data: () => records.get(path), updateTime: { seconds: Number(version.split(":")[0]), nanoseconds: Number(version.split(":")[1]) } }) });
const db: any = { databaseId: "funded-restore-test", doc: ref, runTransaction: async (run: any) => {
  const writes: (() => void)[] = [];
  const result = await run({ get: (r: any) => r.get(), delete: (r: any) => writes.push(() => { records.delete(r.path); }), update: (r: any, v: any) => writes.push(() => { records.set(r.path, { ...records.get(r.path), ...v }); }) });
  if (commitFails) throw Error("commit failed"); writes.forEach(run => run()); return result;
} };
const journal = { create: async (key: string, value: any) => { if (ledger.has(key)) throw Error("immutable ledger already exists"); ledger.set(key, value); } };
const plan = (): DeletionPlan => ({ schemaVersion: 1, uid: "a", scope: "FYNX Funded only", requestPath: "funded_privacy_requests/a", policyReference: "test-policy", reviewedBy: "test-reviewer", reviewedAt: "2026-01-01T00:00:00Z", records: [
  { path: "tickets/a", action: "delete", updateTime: "100:1", reason: "Approved test decision" }, { path: "orders/a", action: "retain", updateTime: "100:1", reason: "Retained billing evidence" },
] });
beforeEach(() => { records.clear(); ledger.clear(); version = "100:1"; nested = false; commitFails = false;
  records.set("tickets/a", { userId: "a", status: "closed" }); records.set("orders/a", { userId: "a", status: "paid" }); records.set("users/a", { shared: true }); records.set("funded_privacy_requests/a", { userId: "a", status: "pending_review", scope: "FYNX Funded only" });
});
describe("reviewed deletion and restoration", () => {
  it("only deletes exact approved records and preserves shared identity and retained billing", async () => {
    const p = plan(); await executeDeletion(db, journal, p, planHash(p));
    expect(records.has("tickets/a")).toBe(false); expect(records.has("orders/a")).toBe(true); expect(records.has("users/a")).toBe(true);
    expect(ledger.size).toBe(2); expect(records.get(p.requestPath).status).toBe("completed");
  });
  it.each(["users/a", "users/a/security/settings", "api_keys/a", "tickets/a/messages/b"])("rejects out-of-scope deletion %s", path => {
    const p = plan(); p.records[0].path = path; expect(() => validatePlan(p)).toThrow();
  });
  it("requires the exact approved plan and a durable ledger", async () => {
    const p = plan(); await expect(executeDeletion(db, journal, p, "changed")).rejects.toThrow(/hash/);
    await expect(executeDeletion(db, { create: async () => { throw Error("ledger unavailable"); } }, p, planHash(p))).rejects.toThrow(/ledger/); expect(records.has("tickets/a")).toBe(true);
  });
  it.each(["changed", "owner", "hold", "open", "nested"])("rejects %s records without partial deletion", async condition => {
    if (condition === "changed") version = "100:2";
    if (condition === "owner") records.set("tickets/a", { userId: "other" });
    if (condition === "hold") records.set("tickets/a", { userId: "a", legalHold: true });
    if (condition === "open") records.set("tickets/a", { userId: "a", status: "open" });
    if (condition === "nested") nested = true;
    const p = plan(); await expect(executeDeletion(db, journal, p, planHash(p))).rejects.toThrow(); expect(records.has("tickets/a")).toBe(true); expect(records.get(p.requestPath).status).toBe("pending_review");
  });
  it("a failed commit leaves an unresolved external ledger that blocks restoration", async () => {
    const p = plan(); commitFails = true; const hash = planHash(p);
    await expect(executeDeletion(db, journal, p, hash)).rejects.toThrow(/commit/);
    const entries: RestoreLedger[] = [{ prepared: ledger.get(`${hash}.prepared`) }];
    await expect(suppressRestoredDeletions(db, entries, { isolated: true, databaseId: db.databaseId })).rejects.toThrow(/incomplete/);
  });
  it("suppresses restored deletions without deleting retained records", async () => {
    const p = plan(), hash = planHash(p); await executeDeletion(db, journal, p, hash);
    records.set("tickets/a", { userId: "a", status: "closed" });
    const entries: RestoreLedger[] = [{ prepared: ledger.get(`${hash}.prepared`), completed: ledger.get(`${hash}.completed`) }];
    expect(await suppressRestoredDeletions(db, entries, { isolated: true, databaseId: db.databaseId })).toMatchObject({ suppressed: 1, releaseApproved: false });
    expect(records.has("orders/a")).toBe(true);
    await expect(suppressRestoredDeletions(db, entries, { isolated: true, databaseId: "(default)" })).rejects.toThrow(/isolated/);
    await expect(suppressRestoredDeletions(db, entries, { isolated: true, databaseId: "funded-restore-somewhere-else" })).rejects.toThrow(/isolated/);
  });
});

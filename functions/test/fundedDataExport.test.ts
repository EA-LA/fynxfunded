import { describe, expect, it } from "vitest";
import { exportFundedData, portableValue } from "../src/fundedDataExport";

function database(extra: Record<string, any> = {}) {
  const records: Record<string, any> = {
    "users/alice": { email: "alice@example.invalid", twoFactorSecret: "SEED", toolsPrivate: "OTHER_PRODUCT" },
    "accounts/alice": { userId: "alice", balance: 0, password: "BROKER_PASSWORD", nested: { accessToken: "TOKEN", currency: "USD" } },
    "challenges/c1": { userId: "alice", currentPhase: 1 },
    "rule_events/e1": { challengeId: "c1", broker_equity: "0" },
    "orders/bob": { userId: "bob", amount: 999 },
    "funded_mfa_private/alice": { secret: "PRIVATE_FACTOR" },
    ...extra,
  };
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), ref: { path }, exists: path in records, data: () => records[path] });
  const collection = (name: string, filters: [string, unknown][] = [], n = Infinity): any => ({
    where: (key: string, _: string, value: unknown) => collection(name, [...filters, [key, value]], n),
    limit: (count: number) => collection(name, filters, count),
    get: async () => ({ docs: Object.keys(records).filter(path => path.startsWith(name + "/") && path.split("/").length === name.split("/").length + 1 && filters.every(([key,value]) => records[path][key] === value)).slice(0, n).map(snapshot) })
  });
  return { doc: (path: string) => ({ get: async () => snapshot(path) }), collection } as any;
}
describe("Funded export", () => {
  it("includes zero balances and owned rule history while excluding other tenants/products/secrets", async () => {
    const result = await exportFundedData(database(), "alice"); const json = JSON.stringify(result);
    expect(result.documents.some(row => row.path === "rule_events/e1")).toBe(true);
    expect(result.documents.find(row => row.path === "accounts/alice")?.data.balance).toBe(0);
    for (const secret of ["SEED", "OTHER_PRODUCT", "BROKER_PASSWORD", "TOKEN", "PRIVATE_FACTOR", "orders/bob"]) expect(json).not.toContain(secret);
  });
  it("rejects ownership conflicts in linked event records", async () => {
    await expect(exportFundedData(database({ "rule_events/bad": { challengeId: "c1", userId: "bob" } }), "alice")).rejects.toThrow("ownership");
  });
  it("never returns a truncated export at document or byte limits", async () => {
    await expect(exportFundedData(database(), "alice", 1)).rejects.toThrow("limit");
    await expect(exportFundedData(database({ "tickets/large": { userId: "alice", message: "x".repeat(4 * 1024 * 1024) } }), "alice")).rejects.toThrow("limit");
  });
  it("rejects unsafe UIDs and limits", async () => {
    for (const uid of ["", "a/b", "a b"]) await expect(exportFundedData(database(), uid)).rejects.toThrow("scope");
    await expect(exportFundedData(database(), "alice", 0)).rejects.toThrow("limit");
  });
  it("includes the private Funded inbox and phase archives without exporting push tokens", async () => {
    const result = await exportFundedData(database({
      "funded_notice_inboxes/alice/items/n": { userId: "alice", read: false },
      "funded_push_devices/d": { userId: "alice", token: "FCM_PRIVATE", enabled: true },
      "funded_phase_archives/c1/phases/1": { userId: "alice", sealed: true },
      "funded_phase_archives/c1/phases/1/events/e": { broker_equity: "10000" },
    }), "alice");
    expect(result.documents.some(d => d.path.endsWith("/items/n"))).toBe(true);
    expect(result.documents.some(d => d.path.endsWith("/events/e"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("FCM_PRIVATE");
  });
  it("redacts nested credentials and normalizes timestamps", () => {
    expect(portableValue({ nested: [{ clientSecret: "secret", document_sha256: "hash" }], time: { toDate: () => new Date("2026-10-07T00:00:00Z") } })).toEqual({ nested: [{ document_sha256: "hash" }], time: "2026-10-07T00:00:00.000Z" });
  });
});

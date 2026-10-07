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
  return { doc: (path: string) => ({ get: async () => snapshot(path) }), collection: (name: string) => ({ where: (key: string, _: string, value: unknown) => ({ limit: (n: number) => ({ get: async () => ({ docs: Object.keys(records).filter(path => path.startsWith(name + "/") && records[path][key] === value).slice(0, n).map(snapshot) }) }) }) }) } as any;
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
  it("redacts nested credentials and normalizes timestamps", () => {
    expect(portableValue({ nested: [{ clientSecret: "secret", document_sha256: "hash" }], time: { toDate: () => new Date("2026-10-07T00:00:00Z") } })).toEqual({ nested: [{ document_sha256: "hash" }], time: "2026-10-07T00:00:00.000Z" });
  });
});

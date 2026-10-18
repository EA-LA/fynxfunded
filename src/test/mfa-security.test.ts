import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ auth: { currentUser: { uid: "owner" } as any }, call: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ auth: fake.auth, db: {}, functions: {}, isFirebaseConfigured: true }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => fake.call }));
vi.mock("firebase/firestore", async importOriginal => ({ ...await importOriginal<any>(), doc: (_: any, ...parts: string[]) => parts.join("/"), getDocFromServer: fake.read }));
import { mfaStatus } from "../services/security";
const pending = (suffix = "") => Object.assign(new Error("Server verification is awaiting activation." + suffix), { code: "functions/failed-precondition" });
beforeEach(() => { vi.clearAllMocks(); fake.auth.currentUser = { uid: "owner" }; fake.read.mockResolvedValue({ data: () => ({ twoFactorEnabled: false }) }); });
it.each(["", " [400]"])("allows only server-confirmed non-MFA users with SDK suffix %s", async suffix => {
  fake.call.mockRejectedValue(pending(suffix)); expect(await mfaStatus()).toEqual({ required: false, verified: true, expiresAt: null }); expect(fake.read).toHaveBeenCalledTimes(2);
});
it.each([0, 1])("keeps a protected customer locked when factor flag %s is set", async index => {
  fake.call.mockRejectedValue(pending(" [400]"));
  fake.read.mockImplementation(async (path: string) => ({ data: () => ({ twoFactorEnabled: index === 0 ? path === "users/owner" : path.endsWith("settings") }) }));
  await expect(mfaStatus()).rejects.toThrow("awaiting activation");
});
it("never substitutes cached flags for an offline server read", async () => {
  fake.call.mockRejectedValue(pending()); fake.read.mockRejectedValue(Error("offline")); await expect(mfaStatus()).rejects.toThrow("offline");
});
it("does not downgrade unrelated server errors", async () => {
  fake.call.mockRejectedValue(Object.assign(Error("Account requires review"), { code: "functions/failed-precondition" })); await expect(mfaStatus()).rejects.toThrow("review"); expect(fake.read).not.toHaveBeenCalled();
});
it("rejects expired and malformed grants", async () => {
  fake.call.mockResolvedValue({ data: { required: true, verified: true, expiresAt: Date.now() - 1 } }); await expect(mfaStatus()).rejects.toThrow("secure session");
  fake.call.mockResolvedValue({ data: { required: false } }); await expect(mfaStatus()).rejects.toThrow("secure session");
});
it("ignores results from an account replaced during verification", async () => {
  fake.call.mockImplementation(async () => { fake.auth.currentUser = { uid: "other" }; return { data: { required: false, verified: true } }; });
  await expect(mfaStatus()).rejects.toThrow("account changed");
});

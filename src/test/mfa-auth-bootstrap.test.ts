import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ records: new Map<string, any>(), auth: { currentUser: null as any }, status: vi.fn(), writes: [] as any[] }));
vi.mock("@/lib/firebase", () => ({ auth: fake.auth, db: {}, functions: {}, isFirebaseConfigured: true }));
vi.mock("@/services/session-tracker", () => ({ recordLoginSession: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/security", () => ({ mfaStatus: fake.status, verifySignInTwoFactor: vi.fn() }));
vi.mock("firebase/firestore", async importOriginal => ({ ...await importOriginal<any>(),
  doc: (_: any, ...parts: string[]) => parts.join("/"),
  getDoc: async (path: string) => ({ exists: () => fake.records.has(path), data: () => fake.records.get(path) }),
  setDoc: async (path: string, data: any, options?: any) => { fake.writes.push({ path, data }); fake.records.set(path, options?.merge ? { ...fake.records.get(path), ...data } : data); }, serverTimestamp: () => "server-time",
}));
vi.mock("firebase/auth", async importOriginal => ({ ...await importOriginal<any>(),
  createUserWithEmailAndPassword: async () => ({ user: fake.auth.currentUser }),
  signInWithPopup: async () => ({ user: fake.auth.currentUser }),
  updateProfile: async (_: any, data: any) => Object.assign(fake.auth.currentUser, data),
  sendEmailVerification: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
}));
import { authService } from "../services/auth";
beforeEach(() => {
  vi.clearAllMocks(); fake.records.clear(); fake.writes = [];
  fake.auth.currentUser = { uid: "qa", email: "qa@example.invalid", displayName: "QA", emailVerified: true, metadata: { creationTime: "2026-10-01" }, providerData: [{ providerId: "google.com" }] };
  fake.status.mockResolvedValue({ required: false, verified: true, expiresAt: null });
});
it("new signup initializes only client-writable security preferences", async () => {
  await authService.signUp("qa@example.invalid", "test-only-password", "QA");
  const settings = fake.records.get("users/qa/security/settings");
  expect(settings).toHaveProperty("loginAlertsEnabled", false);
  expect(settings).not.toHaveProperty("twoFactorSecret"); expect(settings).not.toHaveProperty("twoFactorEnabled"); expect(settings).not.toHaveProperty("backupCodeHashes");
});
it("OAuth completes a profile created first by the server MFA transaction", async () => {
  fake.status.mockImplementation(async () => { fake.records.set("users/qa", { twoFactorEnabled: false, nickname: "keep" }); return { required: false, verified: true, expiresAt: null }; });
  const user = await authService.signInWithGoogle();
  expect(user.email).toBe("qa@example.invalid"); expect(fake.records.get("users/qa")).toMatchObject({ email: "qa@example.invalid", displayName: "QA", nickname: "keep", twoFactorEnabled: false });
});
it("OAuth cannot hydrate protected data before MFA succeeds", async () => {
  fake.status.mockResolvedValue({ required: true, verified: false, expiresAt: null });
  await expect(authService.signInWithGoogle()).rejects.toMatchObject({ code: "auth/two-factor-required" });
  expect(fake.writes).toEqual([]);
});

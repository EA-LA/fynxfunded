import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  records: new Map<string, any>(), auth: { currentUser: null as any }, status: vi.fn(),
  sendVerification: vi.fn(), signOut: vi.fn(), signIn: vi.fn(), create: vi.fn(),
  verifyFactor: vi.fn(), mfaCall: vi.fn(), read: vi.fn(), loginSession: vi.fn(),
  listener: null as any, writes: [] as any[],
}));
vi.mock("@/lib/firebase", () => ({ auth: fake.auth, db: {}, functions: {}, isFirebaseConfigured: true }));
vi.mock("@/services/session-tracker", () => ({ recordLoginSession: fake.loginSession }));
vi.mock("@/services/security", () => ({ mfaCall: fake.mfaCall, mfaStatus: fake.status, verifySignInTwoFactor: fake.verifyFactor }));
vi.mock("firebase/firestore", async importOriginal => ({ ...await importOriginal<any>(),
  doc: (_: any, ...parts: string[]) => parts.join("/"), getDoc: fake.read,
  setDoc: async (path: string, data: any, options?: any) => { fake.writes.push({ path, data }); fake.records.set(path, options?.merge ? { ...fake.records.get(path), ...data } : data); }, serverTimestamp: () => "server-time",
}));
vi.mock("firebase/auth", async importOriginal => ({ ...await importOriginal<any>(),
  createUserWithEmailAndPassword: fake.create,
  signInWithEmailAndPassword: fake.signIn,
  signInWithPopup: async () => ({ user: fake.auth.currentUser }),
  updateProfile: async (user: any, data: any) => Object.assign(user, data),
  sendEmailVerification: fake.sendVerification, signOut: fake.signOut,
  onIdTokenChanged: (_: unknown, callback: any) => { fake.listener = callback; return () => { fake.listener = null; }; },
}));
import { authService } from "../services/auth";
beforeEach(async () => {
  vi.resetAllMocks(); fake.records.clear(); fake.writes = [];
  fake.mfaCall.mockResolvedValue({ revoked: true });
  fake.signOut.mockImplementation(async () => { fake.auth.currentUser = null; });
  await authService.signOut();
  vi.clearAllMocks();
  fake.auth.currentUser = { uid: "qa", email: "qa@example.invalid", displayName: "QA", emailVerified: true, metadata: { creationTime: "2026-10-01" }, providerData: [{ providerId: "google.com" }] };
  fake.create.mockImplementation(async (_auth, email) => { fake.auth.currentUser.emailVerified = false; fake.auth.currentUser.email = email; return { user: fake.auth.currentUser }; });
  fake.sendVerification.mockResolvedValue(undefined);
  fake.signIn.mockImplementation(async () => ({ user: fake.auth.currentUser }));
  fake.status.mockResolvedValue({ required: false, verified: true, expiresAt: null });
  fake.loginSession.mockResolvedValue({});
  fake.read.mockImplementation(async (path: string) => ({ exists: () => fake.records.has(path), data: () => fake.records.get(path) }));
});
it("new signup returns email delivery status and retains an unverified identity without publishing it", async () => {
  const callback = vi.fn(), stop = authService.onAuthStateChange(callback);
  const result = await authService.signUp(" QA@example.invalid ", "test-only-password", "QA");
  expect(result).toMatchObject({ userId: "qa", emailVerified: false, verificationEmailSent: true });
  expect(fake.create).toHaveBeenCalledWith(fake.auth, "qa@example.invalid", "test-only-password");
  expect(fake.records.get("users/qa")).toMatchObject({ email: "qa@example.invalid", displayName: "QA" });
  expect(fake.records.has("users/qa/security/settings")).toBe(false);
  expect(fake.sendVerification).toHaveBeenCalledOnce(); expect(fake.signOut).not.toHaveBeenCalled();
  expect(fake.auth.currentUser.uid).toBe("qa");
  await fake.listener(fake.auth.currentUser);
  expect(callback).toHaveBeenLastCalledWith(null); expect(authService.getCurrentUser()).toBeNull();
  expect(fake.status).not.toHaveBeenCalled(); stop();
});
it("a mail failure returns the created identity and allows email-only retry without recreating it", async () => {
  fake.sendVerification.mockRejectedValueOnce(Error("mail unavailable")).mockResolvedValueOnce(undefined);
  const result = await authService.signUp("qa@example.invalid", "test-only-password", "QA");
  expect(result).toMatchObject({ userId: "qa", emailVerified: false, verificationEmailSent: false });
  expect(result.verificationEmailError).toContain("Your account was created");
  expect(fake.signOut).not.toHaveBeenCalled(); expect(authService.getCurrentUser()).toBeNull();
  await authService.sendEmailVerification();
  expect(fake.create).toHaveBeenCalledOnce(); expect(fake.sendVerification).toHaveBeenCalledTimes(2);
});
it("unverified login permits explicit resend without publishing the user", async () => {
  fake.auth.currentUser.emailVerified = false;
  await expect(authService.signIn(" qa@example.invalid ", "password")).rejects.toMatchObject({ code: "auth/email-not-verified" });
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.writes).toEqual([]); expect(authService.getCurrentUser()).toBeNull();
  await authService.sendEmailVerification(); expect(fake.sendVerification).toHaveBeenCalledOnce();
});
it("verified email login repairs a missing profile and completes", async () => {
  const user = await authService.signIn(" QA@example.invalid ", "password");
  expect(fake.signIn).toHaveBeenCalledWith(fake.auth, "qa@example.invalid", "password");
  expect(user.emailVerified).toBe(true); expect(fake.records.has("users/qa")).toBe(true);
});
it("OAuth completes a profile created first by the server MFA transaction", async () => {
  fake.status.mockImplementation(async () => { fake.records.set("users/qa", { twoFactorEnabled: false, nickname: "keep" }); return { required: false, verified: true, expiresAt: null }; });
  const user = await authService.signInWithGoogle();
  expect(user.email).toBe("qa@example.invalid"); expect(fake.records.get("users/qa")).toMatchObject({ email: "qa@example.invalid", displayName: "QA", nickname: "keep", twoFactorEnabled: false });
});
it("OAuth cannot hydrate protected data before MFA succeeds", async () => {
  fake.status.mockResolvedValue({ required: true, verified: false, expiresAt: null });
  await expect(authService.signInWithGoogle()).rejects.toMatchObject({ code: "auth/two-factor-required" });
  expect(fake.writes).toEqual([]); expect(fake.read).not.toHaveBeenCalled();
});
it("a two-factor code from the previous account cannot verify the current account", async () => {
  fake.auth.currentUser = { ...fake.auth.currentUser, uid: "other", email: "other@example.invalid" };
  await expect(authService.signIn("qa@example.invalid", "", "123456")).rejects.toMatchObject({ code: "auth/session-changed" });
  expect(fake.verifyFactor).not.toHaveBeenCalled(); expect(fake.status).not.toHaveBeenCalled();
  expect(fake.signIn).not.toHaveBeenCalled(); expect(fake.writes).toEqual([]);
});
it("signout while MFA status is pending cannot republish a successful password login", async () => {
  let resolve!: (value: unknown) => void;
  fake.status.mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = authService.signIn("qa@example.invalid", "password");
  const rejected = expect(pending).rejects.toMatchObject({ code: "auth/session-changed" });
  await vi.waitFor(() => expect(fake.status).toHaveBeenCalledOnce());
  await authService.signOut();
  resolve({ required: false, verified: true, expiresAt: null });
  await rejected;
  expect(authService.getCurrentUser()).toBeNull(); expect(fake.writes).toEqual([]); expect(fake.loginSession).not.toHaveBeenCalled();
});
it("signout during profile hydration cannot restore a completed login", async () => {
  let resolve!: (value: unknown) => void;
  fake.records.set("users/qa", { email: "qa@example.invalid", displayName: "QA", provider: "google" });
  fake.read.mockResolvedValueOnce({ exists: () => true, data: () => fake.records.get("users/qa") })
    .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = authService.signIn("qa@example.invalid", "password");
  const rejected = expect(pending).rejects.toMatchObject({ code: "auth/session-changed" });
  await vi.waitFor(() => expect(fake.read).toHaveBeenCalledTimes(2));
  await authService.signOut(); resolve({ exists: () => false });
  await rejected;
  expect(authService.getCurrentUser()).toBeNull(); expect(fake.loginSession).not.toHaveBeenCalled();
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ auth: { currentUser: null as any }, listener: null as any, profile: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ auth: fake.auth, db: {}, isFirebaseConfigured: true }));
vi.mock("@/services/session-tracker", () => ({ recordLoginSession: vi.fn() }));
vi.mock("@/services/security", () => ({ getSecuritySettings: vi.fn(), verifySignInTwoFactor: vi.fn(), mfaStatus: vi.fn().mockResolvedValue({ required: false, verified: true }) }));
vi.mock("firebase/auth", async original => ({ ...await original<any>(), onIdTokenChanged: (_: unknown, cb: any) => { fake.listener = cb; return fake.unsubscribe; } }));
vi.mock("firebase/firestore", async original => ({ ...await original<any>(), doc: vi.fn(), getDoc: fake.profile }));
import { authService } from "@/services/auth";
const user = (uid: string, verified = true) => ({ uid, emailVerified: verified, email: `${uid}@example.invalid`, displayName: uid, metadata: {}, providerData: [] });
beforeEach(() => { vi.clearAllMocks(); fake.auth.currentUser = null; });
describe("authenticated session hydration", () => {
  it("does not restore the previous user after logout while their profile is loading", async () => {
    let resolve: (value: unknown) => void = () => {};
    fake.profile.mockReturnValue(new Promise(done => { resolve = done; })); const callback = vi.fn(); const stop = authService.onAuthStateChange(callback);
    fake.auth.currentUser = user("a"); const pending = fake.listener(fake.auth.currentUser);
    fake.auth.currentUser = null; await fake.listener(null); resolve({ exists: () => false }); await pending;
    expect(callback).toHaveBeenLastCalledWith(null); expect(callback.mock.calls.some(([value]) => value?.userId === "a")).toBe(false); stop();
  });
  it("does not publish an unverified or unsubscribed session", async () => {
    const callback = vi.fn(); const stop = authService.onAuthStateChange(callback);
    fake.auth.currentUser = user("a", false); await fake.listener(fake.auth.currentUser); expect(callback).toHaveBeenLastCalledWith(null); expect(fake.profile).not.toHaveBeenCalled();
    let resolve: (value: unknown) => void = () => {}; fake.profile.mockReturnValue(new Promise(done => { resolve = done; }));
    fake.auth.currentUser = user("b"); const pending = fake.listener(fake.auth.currentUser); stop(); resolve({ exists: () => false }); await pending;
    expect(callback.mock.calls.some(([value]) => value?.userId === "b")).toBe(false); expect(fake.unsubscribe).toHaveBeenCalled();
  });
});

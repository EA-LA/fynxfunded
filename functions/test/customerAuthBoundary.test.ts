import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  records: new Map<string, any>(),
  users: new Map<string, any>(),
  createCustomToken: vi.fn(),
}));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock("firebase-admin", () => {
  const ref = (path: string): any => ({
    path,
    get: async () => ({ exists: fake.records.has(path), data: () => fake.records.get(path) }),
    set: async (value: any, options?: { merge: boolean }) => {
      fake.records.set(path, options?.merge ? { ...fake.records.get(path), ...value } : value);
    },
    delete: async () => { fake.records.delete(path); },
  });
  const db = {
    doc: ref,
    runTransaction: async (run: any) => {
      const writes: Array<() => Promise<void>> = [];
      const result = await run({
        get: (reference: any) => reference.get(),
        set: (reference: any, value: any, options: any) => writes.push(() => reference.set(value, options)),
        update: (reference: any, value: any) => writes.push(() => reference.set(value, { merge: true })),
        delete: (reference: any) => writes.push(() => reference.delete()),
      });
      for (const write of writes) await write();
      return result;
    },
  };
  return {
    firestore: Object.assign(() => db, {
      Timestamp: { fromMillis: (value: number) => value },
      FieldValue: { delete: () => null, serverTimestamp: () => Date.now() },
    }),
    auth: () => ({
      getUser: async (uid: string) => {
        if (!fake.users.has(uid)) throw Object.assign(Error("User not found"), { code: "auth/user-not-found" });
        return fake.users.get(uid);
      },
      createCustomToken: fake.createCustomToken,
    }),
  };
});

import { fundedMfa, requireFundedMfa } from "../src/fundedMfa";
import { codeHash, totp } from "../src/mfaPolicy";

const ownerEmail = "fynxteam5@gmail.com";
const secret = "JBSWY3DPEHPK3PXP";
const proofId = "a".repeat(64);
const call = (request: any): Promise<any> => (fundedMfa as any)(request);
const request = (uid = "customer", action = "status", token: Record<string, unknown> = {}): any => ({
  auth: {
    uid,
    token: {
      email: uid === "owner" ? ownerEmail : "customer@example.invalid",
      email_verified: true,
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: "password" },
      ...(uid === "owner" ? { fundedOwner: true } : {}),
      ...token,
    },
  },
  data: { action },
});
function factor(uid = "customer") {
  fake.records.set(`funded_mfa_private/${uid}`, {
    enabled: true, version: "factor-v1", secret, recoveryHashes: [], lastCounter: -1,
  });
}
function proof(uid = "customer", version = "factor-v1", expiresAt = Date.now() + 60_000) {
  fake.records.set(`funded_mfa_sessions/${proofId}`, { uid, version, expiresAt });
}
beforeEach(() => {
  fake.records.clear();
  fake.users.clear();
  fake.createCustomToken.mockReset().mockResolvedValue("session-token");
  fake.records.set("funded_mfa_rollout/current", { ready: false });
  fake.records.set("funded_private_access/current", { enabled: true, ownerUID: "owner" });
  for (const uid of ["owner", "customer"]) {
    fake.users.set(uid, {
      uid, email: uid === "owner" ? ownerEmail : "customer@example.invalid",
      emailVerified: true, disabled: false,
      tokensValidAfterTime: new Date(Date.now() - 60_000).toUTCString(),
      providerData: [{ providerId: "password" }],
      customClaims: uid === "owner" ? { fundedOwner: true } : {},
    });
  }
});

describe("customer account authentication is separate from private Funded authorization", () => {
  it.each(["password", "google.com", "apple.com"])("accepts verified %s account status without creating a private grant", async provider => {
    const before = [...fake.records];
    await expect(call(request("customer", "status", { firebase: { sign_in_provider: provider } })))
      .resolves.toMatchObject({ required: false, verified: true, expiresAt: null });
    expect([...fake.records]).toEqual(before);
    expect(fake.users.get("customer").customClaims).toEqual({});
    expect(fake.createCustomToken).not.toHaveBeenCalled();
  });

  it("still denies a customer at the private Funded API boundary", async () => {
    await call(request());
    await expect(requireFundedMfa(request())).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("still accepts the configured private owner", async () => {
    await expect(call(request("owner"))).resolves.toMatchObject({ required: false, verified: true });
    await expect(requireFundedMfa(request("owner"))).resolves.toBeUndefined();
  });

  it("does not turn a forged owner claim into private access", async () => {
    await expect(requireFundedMfa(request("customer", "status", { fundedOwner: true, email: ownerEmail })))
      .rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects anonymous and unverified sessions", async () => {
    await expect(call({ data: { action: "status" } })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call(request("customer", "status", { email_verified: false }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it.each([
    ["disabled", { disabled: true }],
    ["email verification revoked", { emailVerified: false }],
    ["tokens revoked", { tokensValidAfterTime: new Date(Date.now() + 60_000).toUTCString() }],
  ])("rejects a currently %s Auth user despite an otherwise valid token", async (_label, changes) => {
    fake.users.set("customer", { ...fake.users.get("customer"), ...changes });
    await expect(call(request())).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it.each([undefined, "invalid", 0, Infinity, Date.now() / 1000 + 3600])("rejects invalid authentication time %s", async authTime => {
    await expect(call(request("customer", "status", { auth_time: authTime }))).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("customer MFA remains fail closed", () => {
  it.each(["funded_mfa_private/customer", "users/customer", "users/customer/security/settings"])(
    "does not bypass an existing factor while rollout is paused (%s)", async path => {
      fake.records.set(path, path.startsWith("funded_mfa_private") ? { enabled: true } : { twoFactorEnabled: true });
      await expect(call(request())).rejects.toMatchObject({ code: "failed-precondition" });
      expect(fake.createCustomToken).not.toHaveBeenCalled();
    },
  );

  it("keeps a private owner's existing factor required during a paused rollout", async () => {
    factor("owner");
    await expect(requireFundedMfa(request("owner"))).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("requires a factor when enrollment is active", async () => {
    fake.records.set("funded_mfa_rollout/current", { ready: true });
    factor();
    await expect(call(request())).resolves.toMatchObject({ required: true, verified: false, expiresAt: null });
  });

  it.each(["wrong user", "wrong version", "expired"])("rejects a %s session proof", async reason => {
    fake.records.set("funded_mfa_rollout/current", { ready: true });
    factor();
    proof(reason === "wrong user" ? "owner" : "customer", reason === "wrong version" ? "old-version" : "factor-v1", reason === "expired" ? Date.now() - 1 : Date.now() + 60_000);
    await expect(call(request("customer", "status", { funded_mfa: proofId })))
      .resolves.toMatchObject({ required: true, verified: false });
  });

  it("a valid MFA proof authenticates the customer but never grants private Funded access", async () => {
    fake.records.set("funded_mfa_rollout/current", { ready: true });
    factor(); proof();
    const customer = request("customer", "status", { funded_mfa: proofId, firebase: { sign_in_provider: "custom" } });
    await expect(call(customer)).resolves.toMatchObject({ required: true, verified: true });
    await expect(requireFundedMfa(customer)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects a bad authenticator code and persists its rate-limit attempt", async () => {
    fake.records.set("funded_mfa_rollout/current", { ready: true });
    factor();
    const attempt = request("customer", "verify"); attempt.data.code = "not-a-code";
    await expect(call(attempt)).rejects.toMatchObject({ code: "permission-denied" });
    expect(fake.records.get("funded_mfa_private/customer").failures).toBe(1);
    expect(fake.createCustomToken).not.toHaveBeenCalled();
  });

  it("issues only a session-scoped MFA proof after a correct authenticator code", async () => {
    fake.records.set("funded_mfa_rollout/current", { ready: true });
    factor();
    const attempt = request("customer", "verify"); attempt.data.code = totp(secret, Math.floor(Date.now() / 30_000));
    await expect(call(attempt)).resolves.toMatchObject({ customToken: "session-token" });
    expect(fake.createCustomToken).toHaveBeenCalledWith("customer", { funded_mfa: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fake.users.get("customer").customClaims).toEqual({});
    await expect(call(attempt)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("consumes recovery codes once", async () => {
    fake.records.set("funded_mfa_rollout/current", { ready: true });
    factor();
    fake.records.get("funded_mfa_private/customer").recoveryHashes = [codeHash("1234-5678-ABCD-EF90")];
    const attempt = request("customer", "verify"); attempt.data.code = "1234-5678-ABCD-EF90";
    await expect(call(attempt)).resolves.toMatchObject({ customToken: "session-token" });
    await expect(call(attempt)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("logout revokes only the authenticated customer's proof", async () => {
    proof("owner");
    await call(request("customer", "logout", { funded_mfa: proofId }));
    expect(fake.records.has(`funded_mfa_sessions/${proofId}`)).toBe(true);
    proof("customer");
    await call(request("customer", "logout", { funded_mfa: proofId }));
    expect(fake.records.has(`funded_mfa_sessions/${proofId}`)).toBe(false);
  });
});

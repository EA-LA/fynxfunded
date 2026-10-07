import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  records: new Map<string, any>(), create: vi.fn(), retrieve: vi.fn(), construct: vi.fn(), mfa: vi.fn(),
}));
vi.mock("../src/fundedMfa", () => ({ requireFundedMfa: fake.mfa }));
vi.mock("firebase-functions/params", () => ({ defineSecret: (name: string) => ({ value: () => name.includes("WEBHOOK") ? "whsec_test" : process.env.TEST_IDENTITY_KEY || "sk_live_mock" }) }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_: unknown, handler: unknown) => handler,
  onRequest: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock("firebase-admin", () => {
  const ref = (path: string) => ({ path, get: async () => ({ data: () => fake.records.get(path) }) });
  const db = { doc: ref, runTransaction: async (run: any) => {
    const writes: any[] = [];
    const result = await run({ get: (r: any) => r.get(), set: (r: any, v: any) => writes.push([r.path, v]) });
    for (const [p, v] of writes) fake.records.set(p, { ...fake.records.get(p), ...v });
    return result;
  } };
  return { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "timestamp" } }) };
});
vi.mock("stripe", () => ({ default: class { identity = { verificationSessions: { create: fake.create, retrieve: fake.retrieve } }; webhooks = { constructEvent: fake.construct }; } }));
import { createKycSession, refreshKycStatus, stripeIdentityWebhook } from "../src/kyc";
const create = createKycSession as any, refresh = refreshKycStatus as any, webhook = stripeIdentityWebhook as any;
const input = { countryOfResidence: "United States", documentType: "passport" };
const request = (data: any = input) => ({ auth: { uid: "user1", token: { email: "test@example.com", email_verified: true } }, data });
const session = (extra: any = {}) => ({ id: "vs_1", livemode: true, status: "requires_input", url: "https://verify.stripe.com/test", metadata: { userId: "user1", platform: "fynx_funded" }, ...extra });
const seed = (extra: any = {}) => fake.records.set("kyc_profiles/user1", { kycSessionId: "vs_1", kycStatus: "pending", ...extra });
const response = () => { const res: any = { code: 0, body: null, set: vi.fn() }; res.status = (code: number) => { res.code = code; return res; }; res.send = res.json = (body: any) => { res.body = body; return res; }; return res; };
beforeEach(() => { fake.records.clear(); vi.clearAllMocks(); delete process.env.FUNCTIONS_EMULATOR; delete process.env.TEST_IDENTITY_KEY; fake.create.mockResolvedValue(session()); fake.retrieve.mockResolvedValue(session()); });
describe("Funded Stripe Identity", () => {
  it("requires authentication", async () => { await expect(create({ data: input })).rejects.toMatchObject({ code: "unauthenticated" }); expect(fake.create).not.toHaveBeenCalled(); });
  it("preserves MFA enforcement", async () => { fake.mfa.mockRejectedValueOnce(new Error("MFA required")); await expect(create(request())).rejects.toThrow("MFA required"); expect(fake.create).not.toHaveBeenCalled(); });
  it.each([null, {}, { ...input, documentType: "__proto__" }, { ...input, countryOfResidence: " " }])("rejects invalid input %j", async data => { await expect(create(request(data))).rejects.toMatchObject({ code: "invalid-argument" }); });
  it("blocks sandbox keys on production", async () => { process.env.TEST_IDENTITY_KEY = "sk_test_mock"; await expect(create(request())).rejects.toMatchObject({ code: "failed-precondition" }); });
  it("creates a selfie and live document check and atomically tracks it", async () => {
    const result = await create(request()); expect(result.redirectUrl).toContain("verify.stripe.com");
    expect(fake.create.mock.calls[0][0].options.document).toEqual({ allowed_types: ["passport"], require_matching_selfie: true, require_live_capture: true });
    expect(fake.records.get("users/user1").kycStatus).toBe("pending");
    expect(fake.records.get("kyc_profiles/user1").kycSessionId).toBe("vs_1");
  });
  it("reuses the same attempt and parameters after a Stripe request failure", async () => {
    fake.create.mockRejectedValueOnce(new Error("network error")); await expect(create(request())).rejects.toThrow();
    await create(request({ countryOfResidence: "Canada", documentType: "national_id" }));
    expect(fake.create.mock.calls[0]).toEqual(fake.create.mock.calls[1]);
  });
  it("reuses processing sessions without creating another", async () => {
    seed(); fake.retrieve.mockResolvedValue(session({ status: "processing", url: null }));
    expect((await create(request())).status).toBe("processing"); expect(fake.create).not.toHaveBeenCalled();
  });
  it("does not mark an untouched session rejected on refresh", async () => {
    seed(); await refresh(request()); expect(fake.records.get("users/user1").kycStatus).toBe("pending");
  });
  it("records a failed check with its retry reason", async () => {
    seed(); fake.retrieve.mockResolvedValue(session({ last_error: { reason: "Document unreadable" } })); await refresh(request());
    expect(fake.records.get("users/user1")).toMatchObject({ kycStatus: "rejected", kycRejectionReason: "Document unreadable" });
  });
  it("refuses sessions belonging to another user", async () => {
    seed(); fake.retrieve.mockResolvedValue(session({ metadata: { userId: "someone_else", platform: "fynx_funded" } }));
    await expect(refresh(request())).rejects.toMatchObject({ code: "failed-precondition" }); expect(fake.records.has("users/user1")).toBe(false);
  });
  it("rejects invalid webhook signatures", async () => {
    fake.construct.mockImplementationOnce(() => { throw new Error("bad signature"); }); const res = response();
    await webhook({ method: "POST", headers: { "stripe-signature": "invalid" }, rawBody: Buffer.from("{}") }, res);
    expect(res.code).toBe(400); expect(fake.retrieve).not.toHaveBeenCalled();
  });
  it("ignores test events", async () => {
    fake.construct.mockReturnValue({ livemode: false, type: "identity.verification_session.verified", data: { object: session() } }); const res = response();
    await webhook({ method: "POST", headers: { "stripe-signature": "signed" } }, res);
    expect(res.code).toBe(200); expect(fake.retrieve).not.toHaveBeenCalled(); expect(fake.records.size).toBe(0);
  });
  it("uses current Stripe state and ignores stale event payload state", async () => {
    seed(); fake.construct.mockReturnValue({ livemode: true, type: "identity.verification_session.requires_input", data: { object: session() } });
    fake.retrieve.mockResolvedValue(session({ status: "verified" })); const res = response();
    await webhook({ method: "POST", headers: { "stripe-signature": "signed" } }, res);
    expect(res.code).toBe(200); expect(fake.records.get("users/user1").kycStatus).toBe("verified");
  });
  it("ignores events from superseded sessions", async () => {
    seed({ kycSessionId: "vs_new" }); fake.construct.mockReturnValue({ livemode: true, type: "identity.verification_session.verified", data: { object: session() } });
    fake.retrieve.mockResolvedValue(session({ status: "verified" })); await webhook({ method: "POST", headers: { "stripe-signature": "signed" } }, response());
    expect(fake.records.has("users/user1")).toBe(false);
  });
  it("asks Stripe to retry when its API is unavailable", async () => {
    fake.construct.mockReturnValue({ id: "evt_1", livemode: true, type: "identity.verification_session.verified", data: { object: session() } });
    fake.retrieve.mockRejectedValueOnce(new Error("network")); const res = response(); await webhook({ method: "POST", headers: { "stripe-signature": "signed" } }, res); expect(res.code).toBe(500);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ records: new Map<string, any>(), paused: true, verifyToken: vi.fn(), mfa: vi.fn(), stripeCreate: vi.fn(), stripeRetrieve: vi.fn(), email: vi.fn(), failCommit: false, sequence: 0 }));
vi.mock("../src/nativeCustomer", () => ({ nativeCustomer: fake.mfa }));
vi.mock("../src/fundedMfa", () => ({ requireFundedMfa: fake.mfa }));
vi.mock("../src/stripe/paymentAvailability", () => ({ paymentsPaused: () => fake.paused }));
vi.mock("firebase-functions/v2/https", () => ({ onRequest: (_: unknown, handler: unknown) => handler }));
vi.mock("firebase-functions/params", () => ({ defineSecret: () => ({ value: () => "sk_test_fixture_not_a_credential" }) }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create: fake.stripeCreate, retrieve: fake.stripeRetrieve } }; } }));
vi.mock("firebase-admin", () => {
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: fake.records.has(path), data: () => fake.records.get(path) });
  const ref = (path: string): any => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path), set: async (value: any) => fake.records.set(path, { ...fake.records.get(path), ...value }) });
  const db = { doc: ref, collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }), runTransaction: async (run: any) => {
    const writes: any[] = [];
    const result = await run({ get: (r: any) => r.get(), set: (r: any, data: any) => writes.push([r.path, data, false]), create: (r: any, data: any) => writes.push([r.path, data, true]) });
    if (fake.failCommit) throw Error("storage unavailable");
    for (const [p, data, create] of writes) { if (create && fake.records.has(p)) throw Error("already exists"); fake.records.set(p, { ...fake.records.get(p), ...data }); }
    return result;
  } };
  return { auth: () => ({ verifyIdToken: fake.verifyToken }), firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => `timestamp-${++fake.sequence}` }, Timestamp: { fromMillis: (value: number) => value } }) };
});
import { createCheckoutSession } from "../src/stripe/createCheckoutSession";
import { verifySession } from "../src/stripe/verifySession";
import { recordCompletedCheckout } from "../src/stripe/webhook";
import { build as buildRules } from "../src/purchasedAgreement";
import { VERSION } from "../src/fundedPolicy";
import { documentHash, recordLegalAcceptance, type LegalRelease } from "../src/fundedLegal";

const release: LegalRelease = { version: "test-only-v1", status: "approved", approvedBy: "test-reviewer", approvedAt: "2026-01-01T00:00:00Z", effectiveAt: "2026-01-01T00:00:00Z", operator: { name: "Test", country: "US", contact: "qa@example.invalid" }, billing: "one_time", documents: (["terms", "privacy", "refund", "risk"] as const).map(kind => ({ kind, version: "fixture", url: `https://www.fynxfunded.com/${kind}`, text: kind, sha256: documentHash(kind) })) };
const consent = { accepted: true, version: release.version, documentHashes: Object.fromEntries(release.documents.map(d => [d.kind, d.sha256])) };
const rules = () => buildRules({ uid: "customer", program: "2-phase", starting_balance: "10000", accepted: true, accepted_version: VERSION });
const order = () => ({ userId: "customer", amount: 79, amountCents: 7900, accountSize: 10000, phase: "2-phase", currency: "USD", style: "normal", status: "pending", createdAt: "original-created", purchasedRules: rules(), legalAcceptance: recordLegalAcceptance(release, consent, "customer") });
const session = (): any => ({ id: "cs_test_order", livemode: false, mode: "payment", payment_status: "paid", amount_total: 7900, currency: "usd", client_reference_id: "customer", customer_email: "qa@example.invalid", metadata: { userId: "customer", accountSize: "10000", phase: "2", style: "normal", rule_policy_version: VERSION, rule_document_sha256: rules().document_sha256, legal_version: release.version }, payment_intent: "pi_test" });
const response = (): any => ({ code: 200, body: null, set: vi.fn(), status(value: number) { this.code = value; return this; }, json(value: unknown) { this.body = value; return this; }, send(value: unknown) { this.body = value; return this; } });
const call = async (handler: any, body: any, authorization = "Bearer fixture") => { const res = response(); await handler({ method: "POST", headers: { authorization, origin: "https://www.fynxfunded.com" }, body }, res); return res; };
beforeEach(() => {
  vi.clearAllMocks(); fake.records.clear(); fake.paused = true; fake.failCommit = false;
  vi.stubEnv("FUNCTIONS_EMULATOR", "true"); vi.stubEnv("FYNX_FUNDED_PURCHASES_APPROVED", "true");
  fake.verifyToken.mockResolvedValue({ uid: "customer", email: "qa@example.invalid", email_verified: true });
  fake.mfa.mockResolvedValue("customer"); fake.email.mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fake.email);
  fake.stripeRetrieve.mockResolvedValue(session());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("hosted checkout gates and recovery", () => {
  it("enforces the hold before authentication or Stripe calls", async () => {
    const res = await call(createCheckoutSession, {}); expect(res.code).toBe(503); expect(res.body.code).toBe("PAYMENTS_PAUSED"); expect(fake.stripeCreate).not.toHaveBeenCalled(); expect(fake.verifyToken).not.toHaveBeenCalled();
  });
  it("cannot create checkout without approved legal publication", async () => {
    fake.paused = false;
    const res = await call(createCheckoutSession, { accountSize: "10k", phase: "2", style: "normal", requestId: "valid-request-123456", acceptRules: true, rulePolicyVersion: VERSION, legalAcceptance: consent });
    expect(res.code).toBe(500); expect(fake.stripeCreate).not.toHaveBeenCalled();
  });
  it("reuses a checkout attempt and never downgrades an already paid order", async () => {
    fake.paused = false; fake.records.set("funded_legal_releases/current", release);
    const open = { ...session(), status: "open", url: "https://checkout.stripe.com/test", expires_at: 1791760000 };
    fake.stripeCreate.mockResolvedValue(open); fake.stripeRetrieve.mockResolvedValue(open);
    const body = { accountSize: "10k", phase: "2", style: "normal", requestId: "valid-request-123456", acceptRules: true, rulePolicyVersion: VERSION, legalAcceptance: consent };
    expect((await call(createCheckoutSession, body)).code).toBe(200);
    fake.records.set("orders/cs_test_order", { ...fake.records.get("orders/cs_test_order"), status: "paid" });
    expect((await call(createCheckoutSession, body)).code).toBe(200); expect(fake.stripeCreate).toHaveBeenCalledTimes(1);
    expect(fake.records.get("orders/cs_test_order").status).toBe("paid");
    expect(fake.stripeCreate.mock.calls[0][1].idempotencyKey).toContain("funded-web-");
  });
  it("a paid Stripe session with an unfinished order remains processing", async () => {
    fake.records.set("orders/cs_test_order", order());
    const res = await call(verifySession, { sessionId: "cs_test_order" }); expect(res.body).toMatchObject({ verified: true, fulfillment: "pending", order: null });
  });
  it("does not expose another customer's order or private checkout fields", async () => {
    fake.records.set("orders/cs_test_order", { ...order(), userId: "someone-else" }); expect((await call(verifySession, { sessionId: "cs_test_order" })).code).toBe(403);
    fake.records.set("orders/cs_test_order", { ...order(), status: "paid", challengeId: "cs_test_order", checkoutUrl: "private-url", clientSecret: "private-value" });
    const res = await call(verifySession, { sessionId: "cs_test_order" }); expect(res.body.fulfillment).toBe("complete"); expect(JSON.stringify(res.body)).not.toContain("private-");
  });
});

describe("webhook fulfillment", () => {
  it("fulfills once and cannot reset a failed challenge on another event or email retry", async () => {
    fake.records.set("orders/cs_test_order", order());
    await recordCompletedCheckout(session(), "evt_one");
    const paidAt = fake.records.get("orders/cs_test_order").paidAt;
    const original = fake.records.get("challenges/cs_test_order");
    fake.records.set("challenges/cs_test_order", { ...original, status: "failed", brokerAccountId: "bound-broker", breachRecorded: true });
    fake.records.set("orders/cs_test_order", { ...fake.records.get("orders/cs_test_order"), status: "refunded" });
    await recordCompletedCheckout(session(), "evt_two");
    expect(fake.records.get("challenges/cs_test_order")).toMatchObject({ status: "failed", brokerAccountId: "bound-broker", breachRecorded: true });
    expect(fake.records.get("orders/cs_test_order")).toMatchObject({ status: "refunded", paidAt, createdAt: "original-created" }); expect(fake.email).toHaveBeenCalledTimes(1);
  });
  it("retries a failed email without resetting the fulfillment", async () => {
    fake.records.set("orders/cs_test_order", order()); fake.email.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(recordCompletedCheckout(session(), "evt_one")).rejects.toThrow(/delivery pending/);
    const challenge = { ...fake.records.get("challenges/cs_test_order"), currentPhase: 2 }; fake.records.set("challenges/cs_test_order", challenge);
    await recordCompletedCheckout(session(), "evt_one"); expect(fake.records.get("challenges/cs_test_order")).toEqual(challenge); expect(fake.email).toHaveBeenCalledTimes(2);
  });
  it.each(["owner", "amount", "legal", "rules"])("rejects conflicting %s evidence atomically", async field => {
    const reserved = order(); const paid = session();
    if (field === "owner") reserved.userId = "other";
    if (field === "amount") paid.amount_total = 1;
    if (field === "legal") paid.metadata.legal_version = "old";
    if (field === "rules") paid.metadata.rule_document_sha256 = "wrong";
    fake.records.set("orders/cs_test_order", reserved);
    await expect(recordCompletedCheckout(paid, "evt_one")).rejects.toThrow(); expect(fake.records.size).toBe(1); expect(fake.email).not.toHaveBeenCalled();
  });
  it("does not grant production entitlements for test payments", async () => {
    vi.stubEnv("FUNCTIONS_EMULATOR", "false"); fake.records.set("orders/cs_test_order", order());
    await recordCompletedCheckout(session(), "evt_test"); expect(fake.records.size).toBe(1);
  });
  it("does not send a confirmation if the transaction fails", async () => {
    fake.records.set("orders/cs_test_order", order()); fake.failCommit = true;
    await expect(recordCompletedCheckout(session(), "evt_one")).rejects.toThrow(/storage/); expect(fake.email).not.toHaveBeenCalled(); expect(fake.records.size).toBe(1);
  });
});

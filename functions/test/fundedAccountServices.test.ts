import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ records: new Map<string, any>(), sent: vi.fn(), n: 0 }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (_: any, handler: any) => handler, HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (_: any, handler: any) => handler }));
vi.mock("../src/nativeCustomer", () => ({ nativeCustomer: async (r: any) => { if (!r.auth?.uid || !r.auth.token.email_verified) throw Error("authentication required"); return r.auth.uid; } }));
vi.mock("firebase-admin", () => {
  const snapshot = (path: string): any => ({ id: path.split("/").at(-1), ref: ref(path), exists: fake.records.has(path), data: () => fake.records.get(path) });
  const ref = (path: string): any => ({ path, get: async () => snapshot(path), set: async (v: any) => fake.records.set(path, v), update: async (v: any) => fake.records.set(path, { ...fake.records.get(path), ...v }), delete: async () => fake.records.delete(path) });
  const collection = (path: string, filters: any[] = [], count = Infinity): any => ({ doc: (id: string) => ref(path + "/" + id), where: (k: string, _: any, v: any) => collection(path, [...filters, [k, v]], count), limit: (n: number) => collection(path, filters, n), orderBy: () => collection(path, filters, count), get: async () => ({ docs: [...fake.records.keys()].filter(k => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1 && filters.every(([f,v]) => fake.records.get(k)[f] === v)).slice(0, count).map(snapshot) }) });
  const db = { doc: ref, collection, runTransaction: async (run: any) => run({ get: (r: any) => r.get(), create: (r: any, v: any) => { if (fake.records.has(r.path)) throw Error("duplicate"); fake.records.set(r.path, v); }, set: (r: any, v: any) => r.set(v), update: (r: any, v: any) => r.update(v), delete: (r: any) => r.delete() }) };
  return { firestore: Object.assign(() => db, { Timestamp: { fromDate: (d: Date) => ({ toMillis: () => d.getTime() }) }, FieldValue: { serverTimestamp: () => ({ toMillis: () => Date.now() }) } }), auth: () => ({ getUser: async () => ({ disabled: false }) }), messaging: () => ({ sendEach: fake.sent }) };
});
import { fundedAccountInsights } from "../src/fundedAccountInsights";
import { fundedNotifications, recordAccountUpdate } from "../src/fundedNotifications";
import { eventKey } from "../src/fundedNotificationPolicy";
import * as admin from "firebase-admin";
const request = (data: any, uid = "owner"): any => ({ auth: { uid, token: { email_verified: true, auth_time: Date.now() / 1000 } }, data });
beforeEach(() => { fake.records.clear(); fake.sent.mockReset(); fake.sent.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] }); });
it("denies another customer's account without leaking existence", async () => {
  fake.records.set("challenges/c", { userId: "other" });
  await expect((fundedAccountInsights as any)(request({ challengeId: "c", phase: 1 }))).rejects.toMatchObject({ code: "not-found" });
});
it("rejects invalid references and phases", async () => {
  await expect((fundedAccountInsights as any)(request({ challengeId: "../c", phase: 1 }))).rejects.toMatchObject({ code: "invalid-argument" });
  await expect((fundedAccountInsights as any)(request({ challengeId: "c", phase: 99 }))).rejects.toMatchObject({ code: "invalid-argument" });
});
it("returns explicit missing history for an owned account and missing archived phase", async () => {
  fake.records.set("challenges/c", { userId: "owner", currentPhase: 2, currency: "USD" });
  const current = await (fundedAccountInsights as any)(request({ challengeId: "c", phase: 2 }));
  expect(current.status).toBe("awaiting_history"); expect(current.payout.available).toBeNull();
  const archived = await (fundedAccountInsights as any)(request({ challengeId: "c", phase: 1 }));
  expect(archived.archived).toBe(true); expect(archived.points).toEqual([]);
});
it("cannot read another user's inbox or mark their notice read", async () => {
  fake.records.set("funded_notice_inboxes/other/items/n", { read: false });
  const response = await (fundedNotifications as any)(request({ action: "inbox" })); expect(response.items).toEqual([]);
  await (fundedNotifications as any)(request({ action: "read", ids: ["n"] })); expect(fake.records.get("funded_notice_inboxes/other/items/n").read).toBe(false);
});
it("transfers a device token on account switching and protects unregistration ownership", async () => {
  const token = "token".repeat(10), path = "funded_push_devices/" + eventKey(token);
  await (fundedNotifications as any)(request({ action: "register", token, enabled: true }));
  await (fundedNotifications as any)(request({ action: "register", token, enabled: true }, "second"));
  await (fundedNotifications as any)(request({ action: "unregister", token })); expect(fake.records.get(path).userId).toBe("second");
  await (fundedNotifications as any)(request({ action: "unregister", token }, "second")); expect(fake.records.has(path)).toBe(false);
});
function event() {
  const before = { userId: "owner", status: "active" }, after = { userId: "owner", status: "funded" };
  fake.records.set("challenges/c", after);
  return { id: "event-1", time: new Date().toISOString(), params: { id: "c" }, data: { before: { exists: true, data: () => before }, after: { exists: true, data: () => after, ref: admin.firestore().doc("challenges/c") } } };
}
it("deduplicates server notices and never sends while rollout is disabled", async () => {
  const e = event(); await recordAccountUpdate("challenges", e); await recordAccountUpdate("challenges", e);
  expect([...fake.records.keys()].filter(k => k.includes("/items/")).length).toBe(1); expect(fake.sent).not.toHaveBeenCalled();
});
it("does not deliver superseded or reassigned source events", async () => {
  const e = event(); fake.records.set("challenges/c", { userId: "other", status: "failed" });
  await recordAccountUpdate("challenges", e); expect([...fake.records.keys()].filter(k => k.includes("/items/")).length).toBe(0);
});
it("sends once to opted-in devices and records acceptance separately from receipt", async () => {
  const e = event(); fake.records.set("funded_notifications_config/current", { enabled: true });
  fake.records.set("funded_push_devices/d", { userId: "owner", token: "token", enabled: true, authTime: Date.now()/1000, updatedAt: { toMillis: () => Date.now() } });
  await recordAccountUpdate("challenges", e); await recordAccountUpdate("challenges", e);
  expect(fake.sent).toHaveBeenCalledTimes(1); expect(fake.records.get("funded_notice_inboxes/owner/items/" + eventKey(e.id)).pushStatus).toBe("accepted");
});

import { fundedOrderStatus } from '../src/fundedOrderStatus';
import { fundedTradingAccess } from '../src/fundedTradingAccess';
import { sealCredential } from '../src/fundedCredentialVault';
import { randomBytes } from 'node:crypto';
const providerAccount = () => ({ userId:'owner', challengeId:'c', provisioningStatus:'ready', providerConfirmedAt:new Date(Date.now()-1000).toISOString(), providerReference:'confirmed',platform:'Test provider',server:'demo',login:'123',environment:'simulated',status:'active' });
function seedProvisioned() { fake.records.set('orders/o',{userId:'owner',status:'paid',challengeId:'c'});fake.records.set('challenges/c',{userId:'owner',orderId:'o',status:'active',brokerAccountId:'a'});fake.records.set('accounts/a',providerAccount()); }
it('order status cannot reveal another customer’s order', async()=>{seedProvisioned();await expect((fundedOrderStatus as any)(request({orderId:'o'},'other'))).rejects.toMatchObject({code:'not-found'});});
it('order status requires coherent order, challenge and account ownership',async()=>{seedProvisioned();fake.records.set('accounts/a',{...providerAccount(),userId:'other'});await expect((fundedOrderStatus as any)(request({orderId:'o'}))).rejects.toMatchObject({code:'failed-precondition'});});
it('order progress reports paid-but-pending and provider readiness independently',async()=>{seedProvisioned();expect((await (fundedOrderStatus as any)(request({orderId:'o'}))).state).toBe('ready');fake.records.delete('accounts/a');expect((await (fundedOrderStatus as any)(request({orderId:'o'}))).state).toBe('account_pending');});
it('metadata strips all credential and private provider fields',async()=>{seedProvisioned();fake.records.set('accounts/a',{...providerAccount(),password:'never-return',secret:'never-return',credentials:{password:'never-return'}});const r=await (fundedTradingAccess as any)(request({action:'metadata'}));expect(JSON.stringify(r)).not.toContain('never-return');expect(r.accounts[0].accountId).toBe('a');});
it('reveal requires a private encrypted record and never falls back to plaintext',async()=>{seedProvisioned();fake.records.set('accounts/a',{...providerAccount(),password:'legacy'});await expect((fundedTradingAccess as any)(request({action:'reveal',accountId:'a',challengeId:'c'}))).rejects.toMatchObject({code:'failed-precondition'});});
it('reveal rejects wrong ownership and stale phase/account bindings',async()=>{seedProvisioned();await expect((fundedTradingAccess as any)(request({action:'reveal',accountId:'a',challengeId:'c'},'other'))).rejects.toMatchObject({code:'not-found'});fake.records.set('challenges/c',{userId:'owner',status:'active',brokerAccountId:'new'});await expect((fundedTradingAccess as any)(request({action:'reveal',accountId:'a',challengeId:'c'}))).rejects.toMatchObject({code:'not-found'});});
it('reveal decrypts for the owner and logs access without logging the credential',async()=>{seedProvisioned();const key=randomBytes(32).toString('base64');vi.stubEnv('FUNDED_TRADING_CREDENTIAL_KEY',key);fake.records.set('funded_account_secrets/a',sealCredential('private-password',{userId:'owner',challengeId:'c',accountId:'a'},key));const r=await (fundedTradingAccess as any)(request({action:'reveal',accountId:'a',challengeId:'c'}));expect(r.password).toBe('private-password');expect(JSON.stringify([...fake.records].filter(([k])=>k.startsWith('funded_credential_access/')))).not.toContain('private-password');vi.unstubAllEnvs();});
it('disabled accounts cannot reveal even previously valid secure credentials',async()=>{seedProvisioned();fake.records.set('accounts/a',{...providerAccount(),status:'suspended'});fake.records.set('funded_account_secrets/a',{});await expect((fundedTradingAccess as any)(request({action:'reveal',accountId:'a',challengeId:'c'}))).rejects.toMatchObject({code:'failed-precondition'});});

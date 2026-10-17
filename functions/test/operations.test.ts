import { beforeEach, expect, it, vi } from 'vitest';
import { operationsSnapshot } from '../src/fundedOperationsPolicy';
const fake = vi.hoisted(() => ({ get: vi.fn(), customer: vi.fn() }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, fn: unknown) => fn, HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock('../src/nativeCustomer', () => ({ nativeCustomer: fake.customer }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ doc: () => ({ get: fake.get }) }) }));
import { fundedOperations } from '../src/fundedOperations';
const now = Date.parse('2026-10-17T12:00:00Z');
const clear = { checkedAt: new Date(now).toISOString(), complete: true, orders: 3, findingsTotal: 0, findingsTruncated: false, findings: [], states: { payment_pending: 3 } };
const request = (email = 'ha6876122@gmail.com'): any => ({ auth: { uid: 'synthetic-owner', token: { email, email_verified: true } }, data: { action: 'status' } });
beforeEach(() => { fake.get.mockReset().mockResolvedValue({ data: () => clear }); fake.customer.mockReset().mockResolvedValue('synthetic-owner'); });
it('does not treat absent, malformed, future or stale reports as clear', () => {
  expect(operationsSnapshot(undefined, now).status).toBe('missing');
  for (const report of [{}, { ...clear, checkedAt: 'invalid' }, { ...clear, checkedAt: new Date(now + 120_000).toISOString() }, { ...clear, findingsTotal: -1 }]) expect(operationsSnapshot(report, now).status).toBe('invalid');
  expect(operationsSnapshot({ ...clear, checkedAt: new Date(now - 121 * 60_000).toISOString() }, now).status).toBe('stale');
  expect(operationsSnapshot(clear, now).status).toBe('clear');
});
it('preserves incomplete scans and findings while stripping private fields', () => {
  const report = operationsSnapshot({ ...clear, complete: false, findingsTotal: 1, password: 'secret', findings: [{ orderId: 'o', reason: 'account_pending', email: 'private@example.com' }] }, now);
  expect(report.status).toBe('incomplete'); expect(report.providerReconciliation).toBe(false);
  expect(JSON.stringify(report)).not.toContain('secret'); expect(JSON.stringify(report)).not.toContain('private@');
  expect(operationsSnapshot({ ...clear, findingsTotal: 1, findings: [{ orderId: 'o', reason: 'binding_conflict' }] }, now).status).toBe('attention');
});
it('bounds the displayed queue without hiding its total', () => {
  const report = operationsSnapshot({ ...clear, findingsTotal: 220, findings: Array.from({ length: 220 }, (_, i) => ({ orderId: 'o' + i, reason: 'account_pending' })) }, now);
  expect(report.findings).toHaveLength(200); expect(report.findingsTotal).toBe(220); expect(report.findingsTruncated).toBe(true);
});
it('denies anonymous, customer and unverified requests before reading the report', async () => {
  const unverified = request(); unverified.auth.token.email_verified = false;
  for (const value of [{ data: { action: 'status' } }, request('customer@example.com'), unverified]) await expect((fundedOperations as any)(value)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(fake.get).not.toHaveBeenCalled();
});
it('requires the owner session and MFA guard and exposes no mutation action', async () => {
  fake.customer.mockRejectedValueOnce(Error('session revoked'));
  await expect((fundedOperations as any)(request())).rejects.toThrow('session revoked'); expect(fake.get).not.toHaveBeenCalled();
  await expect((fundedOperations as any)({ ...request(), data: { action: 'repair' } })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(fake.get).not.toHaveBeenCalled();
  expect(await (fundedOperations as any)(request())).toMatchObject({ purchasesPaused: true, progressionPaused: true, providerReconciliation: false });
  expect(fake.customer).toHaveBeenCalledTimes(3);
});

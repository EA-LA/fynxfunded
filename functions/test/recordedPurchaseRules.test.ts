import { expect, it } from 'vitest';
import { build } from '../src/purchasedAgreement';
import { VERSION } from '../src/fundedPolicy';
import { bindRecordedRules } from '../src/recordedPurchaseRules';
const reorder = (v: any): any => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(reorder) : Object.fromEntries(Object.keys(v).reverse().map(k => [k, reorder(v[k])]));
const purchase = () => build({ uid: 'u', program: '2-phase', starting_balance: '25000', accepted: true, accepted_version: VERSION });
it('binds the original accepted hash after Firestore reorders maps', () => {
  const p = purchase(), input = { uid: 'u', program: '2-phase', starting_balance: '25000', start_timestamp: new Date().toISOString(), order_id: 'o', expected_hash: p.document_sha256 };
  expect(bindRecordedRules(reorder(p), input).agreement.document_sha256).toBe(p.document_sha256);
});
it.each(['rules', 'hash', 'owner', 'acceptance'])('still rejects altered %s', field => {
  const p = reorder(purchase()), input = { uid: 'u', program: '2-phase', starting_balance: '25000', start_timestamp: new Date().toISOString(), order_id: 'o', expected_hash: p.document_sha256 };
  if (field === 'rules') p.document.phases[0].profit_target_percent = '1';
  if (field === 'hash') p.document_sha256 = '0'.repeat(64);
  if (field === 'owner') p.uid = 'other';
  if (field === 'acceptance') p.acceptance_source = 'invented';
  expect(() => bindRecordedRules(p, input)).toThrow();
});

import { expect, it } from 'vitest';
import { parseOrderProgress, parseTradingAccess } from '@/services/funded-access-policy';
const order = { orderId: 'o', challengeId: 'c', accountId: 'a', state: 'ready', title: 'Ready', message: 'Protected access is available.', paymentStatus: 'paid', paymentConfirmed: true, accountReady: true, simulated: true, checkedAt: '2026-10-17T12:00:00.000Z' };
it('requires consistent paid and provider-ready references', () => {
  expect(parseOrderProgress(order, 'o').accountReady).toBe(true);
  for (const patch of [{ orderId: 'other' }, { challengeId: null }, { accountId: null }, { accountId: '../other' }, { paymentStatus: 'refunded' }, { paymentConfirmed: false }, { state: 'account_pending' }, { checkedAt: 'invalid' }, { simulated: false }]) expect(() => parseOrderProgress({ ...order, ...patch }, 'o')).toThrow();
});
it('keeps failed and refunded orders unavailable and accepts processing without provisioning', () => {
  for (const [state, paymentStatus] of [['payment_failed', 'failed'], ['refunded', 'refunded'], ['payment_pending', 'processing']]) {
    expect(parseOrderProgress({ ...order, state, paymentStatus, paymentConfirmed: false, accountReady: false, challengeId: null, accountId: null }, 'o').accountReady).toBe(false);
  }
});
const credential = { userId: 'u', accountId: 'a', challengeId: 'c', environment: 'simulated', platform: 'Demo', server: 'Sandbox', login: 'test', password: 'temporary', tradingUrl: 'https://example.com/trade' };
it('verifies credential ownership, account binding and safe platform links', () => {
  expect(parseTradingAccess(credential, 'u', 'a', 'c').login).toBe('test');
  for (const patch of [{ userId: 'other' }, { accountId: 'old' }, { challengeId: 'old' }, { environment: 'live' }, { password: '' }, { tradingUrl: 'https://user:secret@example.com' }, { tradingUrl: 'https://example.com?token=secret' }, { tradingUrl: 'javascript:alert(1)' }]) expect(() => parseTradingAccess({ ...credential, ...patch }, 'u', 'a', 'c')).toThrow();
});

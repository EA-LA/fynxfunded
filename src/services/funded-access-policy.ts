import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,220}$/);
const paidStates = ['account_pending', 'provisioning', 'provisioning_failed', 'ready', 'account_unavailable'];
const status = z.object({
  orderId: id, challengeId: id.nullable(), accountId: id.nullable(),
  state: z.enum(['payment_pending', 'payment_failed', 'refunded', 'account_pending', 'provisioning', 'provisioning_failed', 'ready', 'account_unavailable', 'review_required']),
  title: z.string().min(1).max(200), message: z.string().min(1).max(1200),
  paymentStatus: z.string().min(1).max(80), paymentConfirmed: z.boolean(), accountReady: z.boolean(),
  checkedAt: z.string().datetime({ offset: true }), simulated: z.literal(true),
});
export function parseOrderProgress(raw: unknown, expectedOrderId: string) {
  // Runtime schemas require these fields; the existing app disables strictNullChecks.
  const value = status.parse(raw) as Required<z.infer<typeof status>>;
  const paid = value.paymentStatus === 'paid';
  if (value.orderId !== expectedOrderId || value.paymentConfirmed !== paid
    || (paidStates.includes(value.state) && !paid)
    || (value.accountReady !== (value.state === 'ready'))
    || (value.accountReady && (!value.challengeId || !value.accountId))
    || (value.state === 'payment_pending' && !['pending', 'processing'].includes(value.paymentStatus))
    || (value.state === 'payment_failed' && value.paymentStatus !== 'failed')
    || (value.state === 'refunded' && value.paymentStatus !== 'refunded')
    || (value.state === 'review_required' && ['paid', 'pending', 'processing', 'failed', 'refunded'].includes(value.paymentStatus))) {
    throw Error('Order status could not be confirmed.');
  }
  return value;
}
const access = z.object({
  userId: z.string().min(1), accountId: id, challengeId: id, environment: z.literal('simulated'),
  platform: z.string().min(1), server: z.string().min(1), login: z.string().min(1), password: z.string().min(1),
  tradingUrl: z.string().url().nullable(),
});
export function parseTradingAccess(raw: unknown, uid: string, accountId: string, challengeId: string) {
  const value = access.parse(raw) as Required<z.infer<typeof access>>;
  if (value.userId !== uid || value.accountId !== accountId || value.challengeId !== challengeId) throw Error('Trading access unavailable.');
  if (value.tradingUrl) {
    const url = new URL(value.tradingUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Trading access unavailable.');
  }
  return value;
}

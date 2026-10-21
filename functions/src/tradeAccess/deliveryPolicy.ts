import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const recipientHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
export const providerMessageId = (id: string) => id.trim().replace(/^<|>$/g, '');
export type DeliveryState = 'delivered' | 'delayed' | 'bounced' | 'complained';
export interface DeliveryEvent {
  id: string; tokenId: string; jobId: string; recipientHash: string;
  providerId: string; state: DeliveryState; timestamp: number;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : '';

/** Mailgun signs timestamp + token, using its webhook signing key, not the sending API key. */
export function verifiedDeliveryEvent(payload: unknown, key: string, now = Date.now()): DeliveryEvent | null {
  const body = record(payload), signature = record(body.signature);
  const timestamp = typeof signature.timestamp === 'number' && Number.isSafeInteger(signature.timestamp)
    ? String(signature.timestamp) : text(signature.timestamp, 16);
  const token = text(signature.token, 256), supplied = text(signature.signature, 64);
  const signedAt = Number(timestamp) * 1000;
  if (key.length < 16 || !/^\d{10,13}$/.test(timestamp) || !token || !/^[a-f0-9]{64}$/i.test(supplied)
    || !Number.isFinite(signedAt) || signedAt > now + 300000 || signedAt < now - 86400000) throw Error('Invalid webhook signature.');
  const expected = createHmac('sha256', key).update(timestamp + token).digest();
  if (!timingSafeEqual(expected, Buffer.from(supplied, 'hex'))) throw Error('Invalid webhook signature.');
  const event = record(body['event-data']), domain = record(event.domain), flags = record(event.flags);
  if (domain.name !== 'mail.fynxfunded.com' || flags['is-test-mode'] === true) return null;
  const state: DeliveryState | null = event.event === 'delivered' ? 'delivered'
    : event.event === 'complained' ? 'complained'
    : event.event === 'failed' && event.severity === 'permanent' ? 'bounced'
    : event.event === 'failed' && event.severity === 'temporary' ? 'delayed' : null;
  if (!state) return null;
  const variables = record(event['user-variables']), headers = record(record(event.message).headers);
  const id = text(event.id, 200), jobId = text(variables['notification-id'], 150);
  const recipient = text(event.recipient, 320), providerId = text(headers['message-id'], 500);
  const at = Number(event.timestamp) * 1000;
  if (!id || !/^(ready|activated)_[A-Za-z0-9_-]{8,100}$/.test(jobId) || !recipient.includes('@') || !providerId
    || !Number.isFinite(at) || at <= 0 || at > now + 300000) throw Error('Invalid webhook event.');
  return { id: createHash('sha256').update(id).digest('hex'), tokenId: createHash('sha256').update(token).digest('hex'),
    jobId, recipientHash: recipientHash(recipient), providerId: providerMessageId(providerId), state, timestamp: at };
}

export function shouldApplyDelivery(current: { deliveryStatus?: string; deliveryEventAt?: number }, next: DeliveryEvent) {
  if (current.deliveryStatus === 'complained') return false;
  if (next.state === 'complained') return true;
  if (['delivered', 'bounced'].includes(current.deliveryStatus ?? '') && next.state === 'delayed') return false;
  return next.timestamp >= (current.deliveryEventAt ?? 0);
}

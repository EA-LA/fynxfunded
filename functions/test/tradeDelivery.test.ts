import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifiedDeliveryEvent, shouldApplyDelivery } from '../src/tradeAccess/deliveryPolicy';
import { accessEmail } from '../src/tradeAccess/mail';
const now = Date.UTC(2026, 9, 20, 12);
const key = 'local-test-webhook-signing-key';
function payload(event = 'delivered', severity?: string) {
  const timestamp = String(now / 1000), token = 'local-webhook-token';
  return { signature: { timestamp, token, signature: createHmac('sha256', key).update(timestamp + token).digest('hex') },
    'event-data': { event, severity, id: 'local-event-id', timestamp: now / 1000, domain: { name: 'mail.fynxfunded.com' },
      recipient: 'owner@example.invalid', message: { headers: { 'message-id': '<local-provider-id>' } },
      'user-variables': { 'notification-id': 'ready_ft_local_account_p1' } } };
}
describe('delivery confirmation and account activation mail', () => {
  it('verifies the signing key and correlates the account message without storing recipient data', () => {
    const result = verifiedDeliveryEvent(payload(), key, now)!;
    expect(result.state).toBe('delivered'); expect(result.providerId).toBe('local-provider-id');
    expect(result.recipientHash).toHaveLength(64); expect(JSON.stringify(result)).not.toContain('owner@');
  });
  it('accepts the documented integer signature timestamp as well as a JSON string', () => {
    const body = payload();
    expect(verifiedDeliveryEvent({ ...body, signature: { ...body.signature, timestamp: Number(body.signature.timestamp) } }, key, now)?.state).toBe('delivered');
  });
  it.each(['', 'wrong-signing-key-value'])('rejects an absent or wrong signing key', invalid => {
    expect(() => verifiedDeliveryEvent(payload(), invalid, now)).toThrow('signature');
  });
  it('rejects stale signatures and future timestamps', () => {
    expect(() => verifiedDeliveryEvent(payload(), key, now + 86400001)).toThrow('signature');
    expect(() => verifiedDeliveryEvent(payload(), key, now - 300001)).toThrow('signature');
  });
  it('rejects malformed signature hex without a timing comparison exception', () => {
    const body = payload(); body.signature.signature = 'z'.repeat(64);
    expect(() => verifiedDeliveryEvent(body, key, now)).toThrow('signature');
  });
  it('ignores other sending domains and unrelated tracking events', () => {
    const body = payload(); body['event-data'].domain.name = 'other.example.com';
    expect(verifiedDeliveryEvent(body, key, now)).toBeNull();
    expect(verifiedDeliveryEvent(payload('opened'), key, now)).toBeNull();
  });
  it('rejects unbound or malformed account notification IDs', () => {
    const body = payload(); body['event-data']['user-variables']['notification-id'] = '../another-job';
    expect(() => verifiedDeliveryEvent(body, key, now)).toThrow('event');
  });
  it.each([['temporary', 'delayed'], ['permanent', 'bounced']])('classifies %s failures', (severity, expected) => {
    expect(verifiedDeliveryEvent(payload('failed', severity), key, now)?.state).toBe(expected);
  });
  it('does not let late delay events undo delivery or let delivery clear a complaint', () => {
    const delayed = verifiedDeliveryEvent(payload('failed', 'temporary'), key, now)!;
    expect(shouldApplyDelivery({ deliveryStatus: 'delivered', deliveryEventAt: now - 1 }, delayed)).toBe(false);
    const delivered = verifiedDeliveryEvent(payload(), key, now)!;
    expect(shouldApplyDelivery({ deliveryStatus: 'complained' }, delivered)).toBe(false);
    expect(shouldApplyDelivery({ deliveryEventAt: now + 1 }, delivered)).toBe(false);
  });
  it('activation mail accurately describes viewing access and uses authenticated links', () => {
    const message = accessEmail('ft_local_account_p1', 25000, true);
    expect(message.subject).toContain('activated');
    expect(message.text).toContain('Trading is not available yet');
    expect(message.text).toContain('does not place an order');
    expect(message.text).toContain('/trade/access?account=ft_local_account_p1');
    expect(message.html).not.toContain('Your purchase is confirmed');
  });
});

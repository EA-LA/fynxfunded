import { describe, expect, it } from 'vitest';
import { accountEmailStatus } from '../trade-access/email-status';
describe('account email customer status', () => {
  it('distinguishes provider acceptance from recipient server delivery', () => {
    expect(accountEmailStatus('provider_accepted')).toContain('not yet confirmed');
    expect(accountEmailStatus('delivered')).toContain('email server accepted');
  });
  it('does not encourage duplicate sends after an uncertain result', () => {
    expect(accountEmailStatus('delivery_unknown')).toContain('check before resending');
    expect(accountEmailStatus('delayed')).toContain('provider is retrying');
  });
  it('keeps failure and unrecognized states explicit', () => {
    expect(accountEmailStatus('bounced')).toContain('could not be delivered');
    expect(accountEmailStatus('unknown')).toContain('not available');
  });
});

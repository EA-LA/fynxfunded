/** A paid order is not evidence of a provisioned trading account. */
export type RecordData = Record<string, any>;
export function confirmedAccount(account: RecordData | undefined) {
  const time = account?.providerConfirmedAt;
  const ms = typeof time?.toMillis === 'function' ? time.toMillis() : Date.parse(String(time ?? ''));
  return account?.provisioningStatus === 'ready' && Number.isFinite(ms) && ms > 0 && ms <= Date.now()
    && Boolean(account?.providerReference && account?.platform && account?.server && account?.login)
    && account?.environment === 'simulated';
}
export function tradingLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? u.href : null; } catch { return null; }
}
export function orderLifecycle(order: RecordData, challenge?: RecordData, account?: RecordData) {
  let state = 'payment_pending', title = 'Payment pending', message = 'Payment has not been confirmed. Check its status before making another payment.';
  if (order.status === 'failed') { state = 'payment_failed'; title = 'Payment failed'; message = 'This payment was not completed. Contact support if your bank shows a charge.'; }
  else if (order.status === 'refunded') { state = 'refunded'; title = 'Payment refunded'; message = 'This order is marked refunded. Contact support for the payment reference or refund timing.'; }
  else if (order.status === 'paid') {
    state = 'account_pending'; title = 'Payment received · account setup pending'; message = 'Your payment is confirmed. Your trading account is not ready yet. Do not pay again.';
    if (challenge && ['failed', 'expired'].includes(challenge.status) || account && ['suspended', 'closed', 'disabled'].includes(account.status)) {
      state = 'account_unavailable'; title = 'Trading access unavailable'; message = 'This account is no longer available for trading. Review your account details or contact support.';
    } else if (challenge?.provisioningStatus === 'failed') {
      state = 'provisioning_failed'; title = 'Account setup needs attention'; message = 'Your payment remains recorded, but account setup could not finish. Contact support with this order reference; do not pay again.';
    } else if (challenge?.provisioningStatus === 'provisioning') {
      state = 'provisioning'; title = 'Creating your trading account'; message = 'Account setup is in progress. Trading access appears only after the provider confirms it.';
    } else if (challenge && ['active', 'passed', 'funded'].includes(challenge.status) && account && confirmedAccount(account) && account.status === 'active') {
      state = 'ready'; title = 'Trading account ready'; message = 'Your provider-confirmed simulated account is ready. Open your account to view protected trading access.';
    }
  } else if (!['pending', 'processing'].includes(order.status)) {
    state = 'review_required'; title = 'Order needs review'; message = 'We could not confirm this order’s payment state. Contact support before making another payment.';
  }
  return { state, title, message, paymentConfirmed: order.status === 'paid', accountReady: state === 'ready', simulated: true };
}

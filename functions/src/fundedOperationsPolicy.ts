const reasons = new Set(['duplicate_payment_reference', 'binding_conflict', 'paid_order_missing_challenge', 'plaintext_credential_requires_migration', 'account_pending', 'provisioning_failed', 'review_required']);
const states = new Set(['payment_pending', 'payment_failed', 'refunded', 'account_pending', 'provisioning', 'provisioning_failed', 'ready', 'account_unavailable', 'review_required']);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** Read-only operator projection. A successful internal scan is not broker verification. */
export function operationsSnapshot(raw: Record<string, any> | undefined, now = Date.now()) {
  const time = typeof raw?.checkedAt === 'string' ? Date.parse(raw.checkedAt) : NaN;
  const valid = !!raw && Number.isFinite(time) && time <= now + 60_000 && count(raw.orders)
    && count(raw.findingsTotal) && typeof raw.complete === 'boolean' && Array.isArray(raw.findings)
    && raw.findingsTotal >= raw.findings.length && raw.findings.every((row: any) =>
      typeof row?.orderId === 'string' && /^[A-Za-z0-9_-]{1,220}$/.test(row.orderId) && reasons.has(row.reason));
  const stale = valid && now - time > 2 * 60 * 60_000;
  const status = !raw ? 'missing' : !valid ? 'invalid' : stale ? 'stale' : !raw.complete ? 'incomplete' : raw.findingsTotal ? 'attention' : 'clear';
  return {
    status, checkedAt: valid ? raw!.checkedAt as string : null, readAt: new Date(now).toISOString(),
    complete: valid && raw!.complete === true, orders: valid ? raw!.orders as number : null,
    findingsTotal: valid ? raw!.findingsTotal as number : null,
    findingsTruncated: valid && (raw!.findingsTruncated === true || raw!.findings.length > 200),
    findings: valid ? raw!.findings.slice(0, 200).map((row: any) => ({ orderId: row.orderId as string, reason: row.reason as string })) : [],
    states: valid ? Object.fromEntries(Object.entries(raw!.states ?? {}).filter(([key, value]) => states.has(key) && count(value))) as Record<string, number> : {},
    freshnessMinutes: 120, providerReconciliation: false,
  };
}

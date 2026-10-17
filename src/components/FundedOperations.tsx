import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getFundedOperations, type OperationsReport } from '@/services/funded-operations';

const titles = {
  missing: 'No reconciliation report yet', invalid: 'Reconciliation report could not be verified',
  stale: 'Reconciliation needs a fresh run', incomplete: 'Reconciliation scan is incomplete',
  attention: 'Reconciliation needs attention', clear: 'No internal exceptions in the latest scan',
};
const reasons: Record<string, string> = {
  duplicate_payment_reference: 'Repeated payment reference', binding_conflict: 'Order/account ownership mismatch',
  paid_order_missing_challenge: 'Paid order has no challenge', plaintext_credential_requires_migration: 'Legacy credential needs migration',
  account_pending: 'Paid order awaiting account setup', provisioning_failed: 'Account setup failed', review_required: 'Payment status needs review',
};
export default function FundedOperations() {
  const { user } = useAuth(); const uid = user?.userId;
  const [result, setResult] = useState<{ uid: string; receivedAt: number; report: OperationsReport } | null>(null);
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let current = true; setResult(null); setError(''); setBusy(true);
    if (!uid) { setBusy(false); return; }
    getFundedOperations().then(report => { if (current) setResult({ uid, receivedAt: Date.now(), report }); })
      .catch(() => { if (current) setError('Operations could not be verified. Check your owner session and refresh.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [uid, attempt]);
  const report = result?.uid === uid ? result.report : null;
  const expired = report?.checkedAt && result && Date.parse(report.readAt) - Date.parse(report.checkedAt) + Math.max(0, now - result.receivedAt) > report.freshnessMinutes * 60_000;
  const status = expired ? 'stale' : report?.status;
  return <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 text-slate-950" aria-label="Reconciliation and launch holds">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Reconciliation and launch holds</h2><p className="mt-1 text-sm text-slate-600">Read-only operational checks. Refresh reads the latest scheduled report.</p></div><button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => setAttempt(n => n + 1)}>{busy ? 'Checking…' : 'Refresh operations'}</button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {report && <>
      <div className="grid gap-3 sm:grid-cols-3">{[['Purchases', report.purchasesPaused ? 'Paused' : 'Check release approval'], ['Phase progression', report.progressionPaused ? 'Paused' : 'Check release approval'], ['Broker reconciliation', 'Not connected']].map(([label, value]) => <div className="rounded-lg border p-3" key={label}><p className="text-xs text-slate-500">{label}</p><p className="font-medium">{value}</p></div>)}</div>
      <div role="status" className={`rounded-lg border p-4 ${status === 'clear' ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}><h3 className="font-medium">{titles[status!]}</h3><p className="mt-1 text-sm">{report.checkedAt ? `Last scan: ${new Date(report.checkedAt).toLocaleString()}. Reports older than ${report.freshnessMinutes} minutes are stale.` : 'A missing or invalid report cannot establish operational health.'}</p>{report.orders !== null && <p className="mt-1 text-sm">{report.orders} orders scanned · {report.findingsTotal} findings · {report.complete ? 'Scan complete' : 'Scan incomplete'}</p>}</div>
      <p className="text-sm text-slate-600">These checks compare internal orders and account records. They do not verify broker balances, trade delivery, payouts or alert receipt. Evaluation does not advance a phase or fund an account.</p>
      {report.findings.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Reconciliation findings</caption><thead><tr className="border-b"><th className="p-2">Order reference</th><th className="p-2">Review needed</th></tr></thead><tbody>{report.findings.map((row, index) => <tr key={`${row.orderId}-${row.reason}-${index}`} className="border-b"><td className="max-w-64 break-all p-2 font-mono text-xs">{row.orderId}</td><td className="p-2">{reasons[row.reason] ?? 'Unrecognized finding; review the operator report'}</td></tr>)}</tbody></table></div>}
      {report.findingsTruncated && <p className="text-sm text-amber-800">Only part of the finding list is shown. Use the full operator reconciliation report before resolving this queue.</p>}
    </>}
  </section>;
}

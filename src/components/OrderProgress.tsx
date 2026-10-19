import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getOrderProgress, type OrderProgress as Progress } from '@/services/funded-access';
export default function OrderProgress({ orderId }: { orderId: string }) {
  const { user } = useAuth(); const uid = user?.userId;
  const [result, setResult] = useState<{ uid: string; orderId: string; data: Progress } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const retry = () => setAttempt(x => x + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);
  useEffect(() => {
    let active = true; setResult(null); setError(''); setLoading(true);
    if (!uid) { setLoading(false); return; }
    getOrderProgress(orderId).then(data => { if (active) setResult({ uid, orderId, data }); }).catch(() => { if (active) setError('Order status could not be confirmed. Retry or contact support; do not pay again while the result is unclear.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, orderId, attempt]);
  const data = result?.uid === uid && result?.orderId === orderId ? result.data : null;
  return <section className="premium-card space-y-4" aria-label="Order progress" aria-live="polite">
    <div className="flex items-start gap-3">{data?.accountReady ? <CheckCircle2 className="shrink-0 text-emerald-500"/> : <Clock className="shrink-0 text-muted-foreground"/>}<div><h2 className="font-semibold">{loading ? 'Checking order status…' : data?.title || 'Order status unavailable'}</h2><p className="mt-2 text-sm text-muted-foreground">{data?.message || error || 'Sign in to the account used at checkout.'}</p></div></div>
    {data && <><ol className="grid gap-3 text-sm sm:grid-cols-3">{[['Payment confirmed', data.paymentConfirmed], ['Challenge recorded', Boolean(data.challengeId) && data.paymentConfirmed], ['Trading account ready', data.accountReady]].map(([label, complete]) => <li key={String(label)} className="flex gap-2 rounded-lg border p-3">{complete ? <CheckCircle2 size={17} className="shrink-0 text-emerald-500"/> : <Clock size={17} className="shrink-0 text-muted-foreground"/>}<span>{label}<span className="block text-xs text-muted-foreground">{complete ? "Complete" : ["payment_failed", "refunded", "account_unavailable"].includes(data.state) ? "Not completed" : "Pending"}</span></span></li>)}</ol><p className="text-xs text-muted-foreground">Simulated trading environment. Account readiness does not confirm a live data feed. Last checked {new Date(data.checkedAt).toLocaleString()}.</p></>}
    {error && <p role="alert" className="text-sm"><AlertCircle size={14} className="inline mr-1"/>{error}</p>}
    <div className="flex flex-wrap gap-3 text-sm"><button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 disabled:opacity-50" disabled={loading} onClick={() => setAttempt(x => x + 1)}><RefreshCw size={14}/>Refresh status</button>{data?.state === "trade_access_ready" && data.accountId && <Link className="rounded-md bg-primary px-3 py-2 text-primary-foreground" to={`/trade/access?account=${encodeURIComponent(data.accountId)}`}>Open FYNX Trade</Link>}{data?.accountReady && data.challengeId && <Link className="rounded-md bg-primary px-3 py-2 text-primary-foreground" to={`/dashboard/accounts/${encodeURIComponent(data.challengeId)}`}>Open trading account</Link>}<Link className="rounded-md border px-3 py-2" to={`/dashboard/support?orderId=${encodeURIComponent(orderId)}`}>Contact support</Link></div>
  </section>;
}

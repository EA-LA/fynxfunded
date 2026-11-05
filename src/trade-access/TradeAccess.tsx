import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Clock, LockKeyhole, Mail, RefreshCw } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { fundedAccessCall } from '@/services/funded-access';
import MarketChart from './MarketChart';
import { accountEmailStatus } from './email-status';
import { accountLimits, tradeAccessError } from './account-limits';
import { formatCountdown, tradingDayStatus } from '@/lib/tradingDayClock';
import { riskPlannerLink } from '@/lib/riskPlanner';

/** Live countdown to the 22:00 UTC daily-loss reset, shown in the viewer's own time. */
function ResetCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  const status = tradingDayStatus(now), local = status.periodEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <div className="rounded-lg border p-3 text-sm"><div className="flex items-center gap-2"><Clock size={14} aria-hidden="true"/><span className="font-medium">Next daily reset in {formatCountdown(status.msUntilReset)}</span></div><p className="mt-1 text-xs text-muted-foreground">22:00 UTC ({local} your time). The daily loss limit is measured from the balance at each reset. <Link className="underline" to="/rules#trading-day">Trading-day clock</Link></p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true"><div className="h-full bg-primary" style={{ width: `${Math.round(status.elapsed * 100)}%` }}/></div></div>;
}

interface Account {
  accountId: string; challengeId: string; orderId: string; platform: string; status: string;
  activationStatus: string; currentPhase: number; startingBalance: number; balance: number; equity: number;
  tradingEnabled: false; tradingHoldReason: string; access?: string; accountEmailStatus?: string;
  rules: { profit_target_percent: string; daily_loss_percent: string; max_loss_percent: string; min_trading_days: number };
}
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export default function TradeAccess() {
  const { user, signOut } = useAuth(), uid = user?.userId;
  const [params, setParams] = useSearchParams(), requested = params.get('account') || '';
  const [accounts, setAccounts] = useState<Account[]>([]), [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [errorKind, setErrorKind] = useState<'private' | 'signin' | 'other'>('other'), [refresh, setRefresh] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const selection = useRef('');
  const reload = useCallback(() => setRefresh(n => n + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setErrorKind('other');
    const key = `${uid}:${requested}`;
    if (selection.current !== key) { setAccount(null); setAccounts([]); setLoadedFor(''); selection.current = key; }
    if (!uid) return;
    (async () => {
      const result = await fundedAccessCall<{ accounts: Account[] }>('fundedTradeAccess', { action: 'list' });
      if (!active) return;
      setAccounts(result.accounts); setLoadedFor(uid);
      const selected = requested || result.accounts[0]?.accountId;
      if (selected) {
        if (!result.accounts.some(a => a.accountId === selected)) throw Error('This account is not available under your current login. Use the FYNX account used at checkout.');
        const opened = await fundedAccessCall<Account>('fundedTradeAccess', { action: 'open', accountId: selected });
        if (active) setAccount(opened);
      }
    })().catch(e => { if (active) { const r = tradeAccessError(e); setErrorKind(r.kind); setError(r.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, requested, refresh]);
  useEffect(() => {
    window.addEventListener('online', reload);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 30000);
    return () => { window.removeEventListener('online', reload); window.clearInterval(timer); };
  }, [reload]);
  const visible = loadedFor === uid ? account : null;
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8"><Link to="/trade/access" className="text-xl font-bold tracking-tight">FYNX <span className="font-normal text-muted-foreground">Trade</span></Link><div className="flex items-center gap-4 text-sm"><Link to="/dashboard" className="inline-flex items-center gap-1"><ArrowLeft size={14}/>Funded dashboard</Link><ThemeToggle/><button onClick={() => void signOut().catch(() => setError('Sign out could not finish. Try again.'))}>Sign out</button></div></div></header>
    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-muted-foreground">Your trading workspace</p><h1 className="mt-2 text-3xl font-semibold">Welcome to FYNX Trade</h1><p className="mt-2 text-sm text-muted-foreground">One FYNX login. Your purchased accounts, together.</p></div><button disabled={loading} onClick={reload} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"><RefreshCw size={14}/>Refresh accounts</button></div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><LockKeyhole size={19} className="mt-0.5 shrink-0 text-amber-600"/><div><p className="font-medium">Account access is open. Trading is coming later.</p><p className="mt-1 text-sm text-muted-foreground">You can review your account and follow market prices. Order placement is disabled.</p></div></div>
      {error && errorKind === 'private' && <div role="status" className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-4 text-sm"><p className="font-medium">{error}</p><p className="mt-1 text-muted-foreground">You can still follow the markets below. Customer accounts open at launch, and each purchase is emailed a secure account link. On the testing team? Sign out, then sign back in with your email and password (Google and Apple sign-in don't open private testing).</p><div className="mt-3 flex flex-wrap gap-3"><button className="underline" onClick={() => void signOut().catch(() => setError('Sign out could not finish. Try again.'))}>Sign out and sign in again</button><Link className="underline" to="/dashboard/support">Contact support</Link></div></div>}
      {error && errorKind !== 'private' && <div role="alert" className="rounded-xl border border-red-500/40 p-4 text-sm">{error} <Link className="underline" to="/dashboard/support">Contact support</Link></div>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <MarketChart/>
        <aside className="min-w-0 space-y-4">
          <section className="rounded-2xl border bg-card p-5"><h2 className="text-lg font-semibold">My accounts</h2>
            {loading && <p className="mt-4 text-sm text-muted-foreground" role="status">Checking your account…</p>}
            {!loading && !error && !accounts.length && <div className="mt-4 space-y-3"><p className="text-sm text-muted-foreground">Your FYNX Trade account will appear after a confirmed challenge purchase. If you already paid, check Billing before paying again.</p><Link to="/challenges" className="inline-flex items-center gap-1 text-sm underline">Explore challenges<ArrowUpRight size={14}/></Link><Link className="block text-sm underline" to="/dashboard/billing">View orders</Link></div>}
            {loadedFor === uid && accounts.length > 0 && <label className="mt-4 block text-xs text-muted-foreground">Select account<select value={requested || accounts[0]?.accountId} onChange={e => setParams({ account: e.target.value })} className="mt-2 w-full min-w-0 rounded-lg border bg-background p-3 text-sm text-foreground">{accounts.map(a => <option key={a.accountId} value={a.accountId}>{money(a.startingBalance)} · …{a.accountId.slice(-9)} · {a.status}</option>)}</select></label>}
            {visible && (() => { const limits = accountLimits(visible.startingBalance, visible.balance, visible.rules); return <div className="mt-5 space-y-4"><div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs"><CheckCircle2 size={13}/>{visible.access === 'history_only' ? 'History only' : 'Access activated'}</div><p className="break-all font-mono text-xs text-muted-foreground">{visible.accountId}</p><div className="grid grid-cols-2 gap-3">{[['Balance', money(visible.balance)], ['Equity', money(visible.equity)], ['Stage', `Phase ${visible.currentPhase}`], ['Funds', 'Simulated']].map(([label, value]) => <div key={label} className="rounded-lg bg-secondary/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div><dl className="space-y-3 text-sm">{[['Profit target', `${visible.rules.profit_target_percent}%`], ['Daily loss limit', `${visible.rules.daily_loss_percent}%`], ['Total loss limit', `${visible.rules.max_loss_percent}%`], ['Minimum trading days', visible.rules.min_trading_days]].map(([k,v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>)}</dl>{limits && <div className="space-y-3 rounded-lg border p-3 text-sm"><div><div className="flex justify-between gap-2"><span className="text-muted-foreground">Progress to target</span><span className="shrink-0 text-right">{money(Math.max(0, limits.profitSoFar))} of {money(limits.targetProfit)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Progress to profit target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(limits.targetProgress * 100)}><div className="h-full bg-emerald-500" style={{ width: `${Math.round(limits.targetProgress * 100)}%` }}/></div></div><dl className="space-y-2">{[['Target balance', money(limits.targetBalance)], ['Daily loss allowance', money(limits.dailyLossAllowance)], ['Maximum loss floor', money(limits.maxLossFloor)], ['Room above the floor', money(limits.roomToMaxFloor)]].map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl><p className="text-xs text-muted-foreground">Worked out from your recorded rules and the balance above. Your official status is on the challenge page.</p></div>}<ResetCountdown/><p className="text-xs text-muted-foreground">Rules recorded with your purchase. Viewing charts does not start a trading day.</p><div className="flex flex-col gap-2 text-sm"><Link className="underline" to={`/dashboard/accounts/${encodeURIComponent(visible.challengeId)}`}>View challenge details</Link><Link className="underline" to={riskPlannerLink({ accountSize: visible.startingBalance, phase: visible.currentPhase })}>Plan your risk per trade for this account</Link></div></div>; })()}
          </section>
          <section className="rounded-2xl border bg-card p-5"><div className="flex items-center gap-2"><Mail size={17}/><h2 className="font-semibold">Your account email</h2></div><p className="mt-3 text-sm text-muted-foreground">After payment and account creation, we email a secure account link. Sign in with your existing FYNX login. No trading password is sent.</p>{visible && <p role="status" className="mt-3 text-sm">{accountEmailStatus(visible.accountEmailStatus)}</p>}<p className="mt-3 text-xs text-muted-foreground">Missing the email? Check spam, then open your account here or contact support.</p></section>
        </aside>
      </div>
    </main>
  </div>;
}

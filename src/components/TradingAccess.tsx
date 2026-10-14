import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { revealTradingAccess, type TradingAccess as Access } from '@/services/funded-access';
export default function TradingAccess({ accountId, challengeId }: { accountId?: string; challengeId: string }) {
  const { user } = useAuth(); const uid = user?.userId;
  const [value, setValue] = useState<Access | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const session = generation;
    const hide = () => { session.current++; setValue(null); setBusy(false); };
    hide(); setError('');
    window.addEventListener('blur', hide); document.addEventListener('visibilitychange', hide);
    return () => { session.current++; window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', hide); };
  }, [accountId, challengeId, uid]);
  useEffect(() => { if (!value) return; const timer = window.setTimeout(() => { generation.current++; setValue(null); }, 60000); return () => clearTimeout(timer); }, [value]);
  const visible = value?.userId === uid && value?.accountId === accountId && value?.challengeId === challengeId ? value : null;
  async function reveal() {
    if (!accountId || busy) return; const ticket = ++generation.current; setBusy(true); setError('');
    try { const result = await revealTradingAccess(accountId, challengeId); if (generation.current === ticket) setValue(result); }
    catch { if (generation.current === ticket) setError('Secure access is not ready or your session could not be verified. Sign in again or contact support.'); }
    finally { if (generation.current === ticket) setBusy(false); }
  }
  return <section className="premium-card space-y-4"><h2 className="font-semibold">Protected trading access</h2><p className="text-sm text-muted-foreground">Sign in to view your simulated trading-platform credentials. They hide after one minute or when you leave this page. Passwords are never sent by email.</p>{visible ? <><dl className="divide-y rounded-lg border">{[['Platform', visible.platform], ['Server', visible.server], ['Login', visible.login], ['Password', visible.password]].map(([label, text]) => <div key={label} className="grid gap-2 p-4 sm:grid-cols-[120px_1fr]"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-all font-mono text-sm select-text">{text}</dd></div>)}</dl><button className="rounded-md border px-4 py-2 text-sm" onClick={() => { generation.current++; setValue(null); }}>Hide credentials</button>{visible.tradingUrl && <a className="ml-3 text-sm underline" href={visible.tradingUrl} target="_blank" rel="noopener noreferrer">Open trading platform</a>}</> : <button className="rounded-md border px-4 py-2 text-sm disabled:opacity-50" disabled={!accountId || busy} onClick={() => void reveal()}>{busy ? 'Verifying access…' : accountId ? 'Reveal trading credentials' : 'Awaiting account setup'}</button>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</section>;
}

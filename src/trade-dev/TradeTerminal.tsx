import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDownRight, ArrowUpRight, ChevronLeft, Moon, Search, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { snapshot, tradeCall } from './api';
import type { OrderKind, Side, Position } from '../../functions/src/tradeDev/engine';
import type { SymbolName } from '../../functions/src/tradeDev/market';
import TradeChart from './TradeChart';
import './trade.css';
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const price = (value?: number) => value === undefined ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: value < 10 ? 5 : 2, maximumFractionDigits: value < 10 ? 5 : 2 });
export default function TradeTerminal() {
  const { user, signOut } = useAuth(), client = useQueryClient();
  const [accountId, setAccountId] = useState(new URLSearchParams(location.search).get('account') || '');
  const [symbol, setSymbol] = useState<SymbolName>('EURUSD'), [timeframe, setTimeframe] = useState(60), [line, setLine] = useState(false), [light, setLight] = useState(false);
  const [filter, setFilter] = useState(''), [side, setSide] = useState<Side>('buy'), [kind, setKind] = useState<OrderKind>('market'), [lots, setLots] = useState('0.10'), [entry, setEntry] = useState(''), [sl, setSl] = useState(''), [tp, setTp] = useState('');
  const [tab, setTab] = useState('positions'), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [protection, setProtection] = useState<{ accountId: string; position: Position; sl: string; tp: string } | null>(null);
  const submitting = useRef(false);
  const currentUser = useRef(user?.userId); currentUser.current = user?.userId;
  const query = useQuery({ queryKey: ['trade-dev', user?.userId, accountId, symbol, timeframe], queryFn: () => snapshot(accountId, symbol, timeframe), enabled: !!user, refetchInterval: 2000, retry: 1, refetchOnWindowFocus: true });
  const data = query.data, account = data?.account, quote = data?.quotes[symbol], spec = data?.instruments.find(i => i.symbol === symbol);
  const stale = !data || Date.now() - data.serverTime > 6000 || query.isError;
  async function command(payload: Record<string, unknown>, success: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    const uid = user?.userId;
    try {
      const result = await tradeCall<{ accountId?: string }>({ ...payload, requestId: crypto.randomUUID() });
      if (uid !== currentUser.current) return;
      if (result.accountId) setAccountId(result.accountId);
      setMessage(success); setProtection(null);
    } catch (e) { if (uid === currentUser.current) setError(e instanceof Error ? e.message.replace(/ \[\d+\]$/, '') : 'Request failed. Refresh the account before retrying.'); }
    finally { await client.invalidateQueries({ queryKey: ['trade-dev'] }); submitting.current = false; setBusy(false); }
  }
  const tradeDisabled = busy || stale || account?.status !== 'active' || account.activationStatus === 'pending';
  const profit = account ? account.balance - account.initialBalance : 0, target = account ? account.initialBalance * (account.phase === 1 ? 0.08 : 0.05) : 2000;
  return <main className={`trade-terminal ${light ? 'trade-light' : ''}`}>
    <div className="trade-dev-banner"><ShieldCheck size={14} /> DEVELOPMENT SIMULATION <span>Synthetic prices · Virtual funds · No real orders or charges</span></div>
    <header className="trade-header">
      <div className="trade-brand"><span className="trade-mark">F</span><strong>FYNX <span>TRADE</span></strong><span className="trade-beta">DEV</span></div>
      <nav><Link to="/dashboard"><ChevronLeft size={14} /> Funded dashboard</Link><button onClick={() => setLight(!light)} aria-label={light ? 'Use dark theme' : 'Use light theme'}>{light ? <Moon size={18} /> : <Sun size={18} />}</button><button onClick={signOut}>Sign out</button></nav>
    </header>
    <section className="trade-account-bar">
      <div><label htmlFor="trade-account">Trading account</label><select id="trade-account" value={account?.accountId ?? accountId} onChange={e => { setAccountId(e.target.value); setError(''); setMessage(''); }} disabled={busy || !data?.accounts.length}>
        {!data?.accounts.length && <option value="">No development accounts</option>}
        {data?.accounts.map(a => <option key={a.accountId} value={a.accountId}>Phase {a.phase} · {a.accountId.slice(-10)} · {a.status}</option>)}
      </select></div>
      <div className="trade-account-state"><span className={`trade-dot ${stale ? 'offline' : ''}`} />{stale ? 'Waiting for server' : 'Synthetic feed connected'}<small>{account ? `Rule version ${account.rulesVersion}` : 'Internal development environment'}</small></div>
      <button className="trade-secondary" disabled={busy || query.isLoading} onClick={() => command({ action: 'purchase' }, 'Internal $25,000 account created. No payment was taken.')}>Create $25K demo</button>
    </section>
    {(error || query.error) && <div role="alert" className="trade-error">{error || (query.error as Error).message}</div>}
    {message && <div role="status" className="trade-message">{message}</div>}
    {account?.status !== 'active' && account && <div className="trade-message">{account.status === 'failed' ? `${account.failureReason}. Trading is disabled; your history is preserved.` : `Phase ${account.phase} passed. This account is history-only.`}{account.nextAccountId && <button onClick={() => setAccountId(account.nextAccountId!)}>Open Phase 2 →</button>}</div>}
    {account?.activationStatus === 'pending' && account.status === 'active' && <div className="trade-message"><strong>Activate this demo account to trade.</strong> Use your existing development login. <button disabled={busy} onClick={() => command({ action: 'activate', accountId: account.accountId }, 'Development account activated. You can now trade synthetic prices.')}>Activate account</button></div>}
    <section className="trade-metrics" aria-label="Server account balances">
      {[['Balance', account?.balance], ['Equity', account?.equity], ['Unrealized P&L', account ? account.equity - account.balance : undefined], ['Used margin', account?.margin], ['Free margin', account?.freeMargin]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong className={label === 'Unrealized P&L' ? Number(value) < 0 ? 'negative' : 'positive' : ''}>{typeof value === 'number' ? money(value) : '—'}</strong></div>)}
    </section>
    <div className="trade-workspace">
      <aside className="trade-panel trade-watchlist"><div className="trade-panel-title">Markets <small>3 synthetic instruments</small></div><label className="trade-search"><Search size={15} /><input aria-label="Search instruments" placeholder="Search markets" value={filter} onChange={e => setFilter(e.target.value)} /></label>
        {data?.instruments.filter(i => `${i.name} ${i.symbol}`.toLowerCase().includes(filter.toLowerCase())).map(i => <button key={i.symbol} className={`trade-symbol ${symbol === i.symbol ? 'selected' : ''}`} onClick={() => { setSymbol(i.symbol); setEntry(''); setSl(''); setTp(''); }}><span><strong>{i.symbol}</strong><small>{i.assetClass}</small></span><span><strong>{price(data.quotes[i.symbol].bid)}</strong><small>Bid · simulated</small></span></button>)}
        <div className="trade-market-note"><Activity size={19} /><strong>Practice execution</strong><p>This feed runs 24/7. Prices are generated locally and do not represent the live market.</p></div>
      </aside>
      <section className="trade-panel trade-chart-panel"><div className="trade-chart-heading"><div><h1>{symbol}</h1><span>{spec?.name || 'Synthetic market'}</span></div><div className="trade-spread">SPREAD <strong>{spec ? price(spec.spreadTicks * spec.tickSize) : '—'}</strong></div></div>
        <div className="trade-chart-toolbar"><div>{[60,300,900].map(t => <button key={t} className={timeframe === t ? 'active' : ''} onClick={() => setTimeframe(t)}>{t / 60}m</button>)}</div><button onClick={() => setLine(!line)}>{line ? 'Line' : 'Candles'} ▾</button><span>Synthetic · USD</span></div>
        <TradeChart key={`${symbol}-${timeframe}`} precision={symbol === "EURUSD" ? 5 : 2} candles={data?.candles ?? []} line={line} light={light} />
        <div className="trade-attribution"><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a> · Copyright (с) 2025 TradingView, Inc.</div>
      </section>
      <aside className="trade-panel trade-ticket"><div className="trade-panel-title">Order ticket <small>{symbol}</small></div>
        <div className="trade-sides"><button className={side === 'sell' ? 'sell selected' : 'sell'} onClick={() => setSide('sell')}><span><ArrowDownRight size={15} /> SELL</span><strong>{price(quote?.bid)}</strong></button><button className={side === 'buy' ? 'buy selected' : 'buy'} onClick={() => setSide('buy')}><span><ArrowUpRight size={15} /> BUY</span><strong>{price(quote?.ask)}</strong></button></div>
        <form onSubmit={e => { e.preventDefault(); command({ action: 'place', accountId: account?.accountId, order: { symbol, side, kind, lots: Number(lots), ...(kind !== 'market' ? { price: Number(entry) } : {}), ...(sl ? { sl: Number(sl) } : {}), ...(tp ? { tp: Number(tp) } : {}) } }, 'Order processed. Check positions, pending orders and account status.'); }}>
          <label>Order type<select value={kind} onChange={e => setKind(e.target.value as OrderKind)}><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option></select></label>
          <label>Volume (lots)<input type="number" min="0.01" max="10" step="0.01" value={lots} onChange={e => setLots(e.target.value)} required /></label>
          {kind !== 'market' && <label>Order price<input type="number" min={spec?.tickSize} step={spec?.tickSize} value={entry} onChange={e => setEntry(e.target.value)} required /></label>}
          <div className="trade-brackets"><label>Stop loss<input aria-label="Stop loss" type="number" step={spec?.tickSize} min={spec?.tickSize} placeholder="Optional" value={sl} onChange={e => setSl(e.target.value)} /></label><label>Take profit<input aria-label="Take profit" type="number" step={spec?.tickSize} min={spec?.tickSize} placeholder="Optional" value={tp} onChange={e => setTp(e.target.value)} /></label></div>
          <dl><div><dt>Leverage</dt><dd>1:{spec?.leverage ?? '—'}</dd></div><div><dt>Contract size</dt><dd>{spec?.contractSize.toLocaleString()} units / lot</dd></div><div><dt>Commission</dt><dd>$3.50 / lot / side</dd></div><div><dt>Slippage</dt><dd>1 tick adverse</dd></div></dl>
          <button className={`trade-submit ${side}`} type="submit" disabled={tradeDisabled}>{busy ? 'Processing…' : !account ? 'Create a demo account first' : account.status !== 'active' ? 'History-only account' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}</button>
          <p className="trade-ticket-note">The server sets the fill price and checks margin and challenge rules. Pending orders do not reserve margin.</p>
        </form>
      </aside>
      <section className="trade-panel trade-activity">{protection && protection.accountId === account?.accountId && <form className="trade-protection" onSubmit={e => { e.preventDefault(); command({ action: 'protect', accountId: protection.accountId, positionId: protection.position.id, sl: protection.sl ? Number(protection.sl) : null, tp: protection.tp ? Number(protection.tp) : null }, 'Position protection updated.'); }}><strong>Edit {protection.position.symbol} protection</strong><label>Stop loss<input aria-label="Edit stop loss" type="number" min="0" step="any" value={protection.sl} onChange={e => setProtection({ ...protection, sl: e.target.value })}/></label><label>Take profit<input aria-label="Edit take profit" type="number" min="0" step="any" value={protection.tp} onChange={e => setProtection({ ...protection, tp: e.target.value })}/></label><span>Leave a field empty to remove that protection.</span><button disabled={tradeDisabled}>Save protection</button><button type="button" onClick={() => setProtection(null)}>Cancel</button></form>}<div className="trade-tabs">{['positions','pending','history','messages'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'messages' ? 'Development inbox' : t[0].toUpperCase()+t.slice(1)}{t === 'positions' ? ` (${account?.positions.length ?? 0})` : t === 'pending' ? ` (${account?.orders.length ?? 0})` : ''}</button>)}</div>
        <div className="trade-table-wrap"><table><thead><tr>{(tab === 'positions' ? ['Instrument','Side / lots','Entry','Stop / target','Actions'] : tab === 'pending' ? ['Instrument','Type','Side / lots','Order price','Actions'] : tab === 'history' ? ['Instrument','Side / lots','Entry → exit','Realized P&L*','Reason'] : ['Event','Account','Status','Created']).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
          {tab === 'positions' && account?.positions.map(p => <tr key={p.id}><td>{p.symbol}</td><td className={p.side === 'buy' ? 'positive' : 'negative'}>{p.side.toUpperCase()} {p.lots}</td><td>{price(p.entry)}</td><td>{price(p.sl)} / {price(p.tp)}</td><td className="trade-close"><button disabled={tradeDisabled} onClick={() => setProtection({ accountId: account.accountId, position: p, sl: p.sl?.toString() ?? '', tp: p.tp?.toString() ?? '' })}>Edit SL/TP</button><button disabled={tradeDisabled} onClick={() => command({ action: 'close', accountId: account.accountId, positionId: p.id, lots: p.lots }, 'Position closed at the server price.')}>Close</button>{p.lots >= 0.02 && <button disabled={tradeDisabled} onClick={() => command({ action: 'close', accountId: account.accountId, positionId: p.id, lots: Math.floor(p.lots * 50) / 100 }, 'Partial close processed.')}>Close ½</button>}</td></tr>)}
          {tab === 'pending' && account?.orders.map(o => <tr key={o.id}><td>{o.symbol}</td><td>{o.kind}</td><td>{o.side.toUpperCase()} {o.lots}</td><td>{price(o.price)}</td><td><button disabled={tradeDisabled} onClick={() => command({ action: 'cancel', accountId: account.accountId, orderId: o.id }, 'Pending order cancelled.')}>Cancel</button></td></tr>)}
          {tab === 'history' && [...(account?.history ?? [])].reverse().map(f => <tr key={f.id}><td>{f.symbol}</td><td>{f.side.toUpperCase()} {f.lots}</td><td>{price(f.entry)} → {price(f.exit)}</td><td className={f.netPnl >= 0 ? 'positive' : 'negative'}>{money(f.netPnl)}</td><td>{f.reason.replace(/_/g, ' ')}</td></tr>)}
          {tab === 'messages' && data?.outbox.map(m => <tr key={`${m.accountId}-${m.type}`}><td><details><summary>{m.subject}</summary><p className="trade-mail-body">{m.text}</p><button onClick={() => setAccountId(m.accountId)}>Open account</button></details></td><td>{m.accountId.slice(-10)}</td><td>{m.status === 'delivered_to_local_mailbox' ? 'Delivered to local test mailbox' : 'Queued for local test mailbox'}</td><td>{new Date(m.createdAt).toLocaleString()}</td></tr>)}
        </tbody></table>
        {((tab === 'positions' && !account?.positions.length) || (tab === 'pending' && !account?.orders.length) || (tab === 'history' && !account?.history.length) || (tab === 'messages' && !data?.outbox.length)) && <div className="trade-empty">{!account ? 'Create an internal demo to start your first simulated trade.' : `No ${tab === 'messages' ? 'messages' : tab} yet.`}</div>}
        {tab === 'history' && <p className="trade-history-note">*Includes exit commission. Entry commission is deducted from balance when the position opens.</p>}
        </div>
      </section>
      <aside className="trade-panel trade-progress"><div className="trade-panel-title">Challenge progress <small>Phase {account?.phase ?? 1}</small></div><div className="trade-progress-number">{money(profit)} <span>/ {money(target)}</span></div><progress value={Math.max(0, profit)} max={target} /><dl><div><dt>Daily loss remaining</dt><dd>{account ? money(Math.max(0, account.equity - (account.dayStartEquity - 1250))) : '—'}</dd></div><div><dt>Maximum loss remaining</dt><dd>{account ? money(Math.max(0, account.equity - 22500)) : '—'}</dd></div><div><dt>Trading days</dt><dd>{account?.tradingDays.length ?? 0} / 1</dd></div></dl><p>Development rules: 8% then 5% profit target, 5% daily loss and 10% maximum loss. Close all positions and pending orders to pass. Phase 2 completion requires review; no payout is created.</p></aside>
    </div>
    <footer className="trade-footer"><span>All balances and executions are server-authoritative.</span><span>{user?.email} · {account ? `Revision ${account.revision}` : 'No active account'}</span></footer>
  </main>;
}

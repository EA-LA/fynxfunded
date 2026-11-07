import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3, CandlestickChart, CheckCircle2, Clock, History, LineChart, ListOrdered, LockKeyhole, Mail, Minus, Plus, RefreshCw, Search, Star, User, Wallet, X } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { fundedAccessCall } from '@/services/funded-access';
import { positionSizeLink } from '@/lib/positionSize';
import { formatCountdown, tradingDayStatus } from '@/lib/tradingDayClock';
import { accountEmailStatus } from './email-status';
import {
  CONTRACT_SIZE, DEFAULT_SYMBOL, FOREX_PAIRS, LOT_MAX, LOT_MIN, LOT_STEP, calculatorKind, findPair, forexMarketOpen,
  loadFavorites, normalizeLots, pairLabel, pairName, saveFavorites, searchPairs, type ForexGroup, type ForexPair,
} from './instruments';
import { parsePips, protectionPrices, rulesInDollars, ticketFigures, type AccountRules } from './ticket';
import { useEngine, type EngineHandle } from './useEngine';
import type { TradingGateway } from '@/engine/gateway';
import type { Snapshot } from '@/engine/venue';
import { profitUsd } from '@/engine/core';
import type { InstrumentSpec, QuoteBook } from '@/engine/types';
import TvWidget, { readLiveConsent, saveLiveConsent } from './TvWidget';

interface Account {
  accountId: string; challengeId: string; orderId: string; platform: string; status: string;
  activationStatus: string; currentPhase: number; startingBalance: number; balance: number; equity: number;
  tradingEnabled: boolean; tradingHoldReason: string; access?: string; accountEmailStatus?: string;
  rules: AccountRules;
}
type Side = 'buy' | 'sell';
type MobileView = 'quotes' | 'chart' | 'trade' | 'history' | 'account';
type ToolTab = 'positions' | 'orders' | 'history' | 'account';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const GROUPS: (ForexGroup | 'Favorites' | 'All')[] = ['All', 'Favorites', 'Majors', 'Minors', 'Exotics'];
const INTERVALS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['60', '1H'], ['240', '4H'], ['D', '1D']] as const;
const TICKER = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'];

export default function TradeAccess({ gateway }: { gateway?: TradingGateway } = {}) {
  const { user, signOut } = useAuth(), uid = user?.userId;
  const { resolvedTheme } = useTheme(), dark = resolvedTheme !== 'light';
  const [params, setParams] = useSearchParams(), requested = params.get('account') || '';
  const [accounts, setAccounts] = useState<Account[]>([]), [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const selection = useRef('');
  const reload = useCallback(() => setRefresh(n => n + 1), []);

  // Account loading is unchanged from the previous portal: list, then open the selected account.
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
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
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Account access could not be loaded. Please retry.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, requested, refresh]);
  useEffect(() => {
    window.addEventListener('online', reload);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 30000);
    return () => { window.removeEventListener('online', reload); window.clearInterval(timer); };
  }, [reload]);
  const visible = loadedFor === uid ? account : null;
  const engine = useEngine(visible?.accountId ?? null, gateway);

  // Terminal state
  const pair = findPair(params.get('symbol')) ?? findPair(DEFAULT_SYMBOL)!;
  const setSymbol = (symbol: string) => setParams(prev => { const next = new URLSearchParams(prev); next.set('symbol', symbol); return next; }, { replace: true });
  const [live, setLive] = useState(readLiveConsent);
  const [view, setView] = useState<MobileView>('chart');
  const [tool, setTool] = useState<ToolTab>('positions');
  const [chartInterval, setChartInterval] = useState('15');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  const enableLive = () => { saveLiveConsent(true); setLive(true); };
  const disableLive = () => { saveLiveConsent(false); setLive(false); };

  const show = (v: MobileView) => `${view === v ? 'flex' : 'hidden'} lg:flex`;
  const rules = visible ? rulesInDollars(visible.startingBalance, visible.rules) : null;
  const marketOpen = forexMarketOpen(now), day = tradingDayStatus(now);

  return <div className="flex min-h-screen flex-col bg-background pb-16 text-foreground lg:pb-0">
    {/* Top bar */}
    <header className="border-b bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/trade" className="flex items-center gap-2 text-lg font-bold tracking-tight"><span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground">F</span>FYNX <span className="font-normal text-muted-foreground">Trade</span></Link>
          {loadedFor === uid && accounts.length > 0 && <label className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="sr-only">Trading account</span>
            <select value={requested || accounts[0]?.accountId} onChange={e => setParams(prev => { const next = new URLSearchParams(prev); next.set('account', e.target.value); return next; })} className="max-w-[260px] truncate rounded-md border bg-background px-2 py-1.5 font-mono text-xs text-foreground">
              {accounts.map(a => <option key={a.accountId} value={a.accountId}>#{a.accountId.slice(-8)} · {money(a.startingBalance)} · {a.status}</option>)}
            </select></label>}
        </div>
        <div className="flex items-center gap-1 text-sm sm:gap-3">
          <span data-testid="engine-status" title={engine.status?.message} className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs md:inline-flex ${engine.status?.execution ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${engine.status?.execution ? 'bg-emerald-500' : engine.status?.connected ? 'bg-amber-500' : 'bg-muted-foreground'}`} />{engine.status?.execution ? 'Trading engine live' : engine.status?.connected ? 'Engine connected · waiting for prices' : 'Engine not connected'}</span>
          <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs md:inline-flex ${marketOpen ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`} title="Approximate forex week: Sunday to Friday, 22:00 UTC (21:00 in US summer time). Broker hours can differ."><span className={`h-1.5 w-1.5 rounded-full ${marketOpen ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />Forex {marketOpen ? 'open' : 'closed'}</span>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:inline-flex" title="The daily loss limit restarts from the balance at 22:00 UTC"><Clock size={13} aria-hidden="true" />Daily reset in {formatCountdown(day.msUntilReset)}</span>
          <button disabled={loading} onClick={reload} aria-label="Refresh accounts" className="rounded-md p-2 hover:bg-secondary disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          <Link to="/dashboard" className="hidden items-center gap-1 rounded-md px-2 py-1.5 hover:bg-secondary sm:inline-flex"><ArrowLeft size={14} />Dashboard</Link>
          <ThemeToggle />
          <button className="rounded-md px-2 py-1.5 hover:bg-secondary" onClick={() => void signOut().catch(() => setError('Sign out could not finish. Try again.'))}>Sign out</button>
        </div>
      </div>
      <AccountStrip account={visible} loading={loading} snapshot={engine.snapshot} />
    </header>

    <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs sm:px-5" role="note">
      <LockKeyhole size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
      <p><span className="font-medium">Trading opens soon.</span> <span className="text-muted-foreground">Prices, charts and the order panel are ready. Order placement unlocks when FYNX switches on trading for your account; until then no order is sent.</span></p>
    </div>
    {error && <div role="alert" className="border-b border-red-500/40 bg-red-500/5 px-3 py-2 text-sm sm:px-5">{error} <Link className="underline" to="/dashboard/support">Contact support</Link></div>}

    {live && <TvWidget title="Live forex ticker" script="ticker-tape" className="hidden h-[46px] overflow-hidden border-b sm:block" config={{ symbols: TICKER.map(s => ({ proName: `OANDA:${s}`, title: s })), showSymbolLogo: false, isTransparent: true, displayMode: 'compact', colorTheme: dark ? 'dark' : 'light', locale: 'en' }} />}

    {/* Workspace */}
    <main className="grid flex-1 gap-px bg-border lg:grid-cols-[270px_minmax(0,1fr)_330px] lg:grid-rows-[minmax(520px,1fr)_auto]">
      <section className={`${show('quotes')} min-h-0 flex-col bg-card lg:row-span-2`} aria-label="Market watch">
        <MarketWatch selected={pair} onSelect={p => { setSymbol(p.symbol); setView('chart'); }} />
      </section>

      <section className={`${show('chart')} min-w-0 flex-col bg-card`} aria-label="Chart">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="min-w-0"><h1 className="text-lg font-semibold leading-tight">{pairLabel(pair)}</h1><p className="truncate text-xs text-muted-foreground">{pairName(pair)} · {pair.group}</p></div>
          <div className="flex items-center gap-1" role="group" aria-label="Chart timeframe">
            {INTERVALS.map(([id, label]) => <button key={id} type="button" aria-pressed={chartInterval === id} onClick={() => setChartInterval(id)} className={`rounded px-2 py-1 text-xs font-medium ${chartInterval === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{label}</button>)}
          </div>
        </div>
        {live && <TvWidget key={`info-${pair.symbol}-${dark}`} title={`${pairLabel(pair)} live price`} script="symbol-info" className="h-[96px] overflow-hidden border-b" config={{ symbol: pair.tvSymbol, width: '100%', locale: 'en', colorTheme: dark ? 'dark' : 'light', isTransparent: true }} />}
        <div className="relative min-h-[420px] flex-1">
          {live
            ? <TvWidget key={`chart-${pair.symbol}-${chartInterval}-${dark}`} title={`${pairLabel(pair)} chart`} script="advanced-chart" className="absolute inset-0" config={{ autosize: true, symbol: pair.tvSymbol, interval: chartInterval, timezone: 'Etc/UTC', theme: dark ? 'dark' : 'light', style: '1', locale: 'en', allow_symbol_change: false, hide_side_toolbar: false, calendar: false, support_host: 'https://www.tradingview.com' }} />
            : <div className="absolute inset-0 grid place-items-center p-6 text-center"><div className="max-w-md"><CandlestickChart size={36} className="mx-auto text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-lg font-semibold">Turn on live prices</p><p className="my-3 text-sm text-muted-foreground">Live charts and quotes for all {FOREX_PAIRS.length} forex pairs come from TradingView. TradingView receives your connection details when they load. We remember your choice on this device.</p><button className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground" onClick={enableLive}>Show live prices</button></div></div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>Prices by <a className="underline" href={`https://www.tradingview.com/symbols/${pair.symbol}/`} target="_blank" rel="noopener noreferrer nofollow">TradingView</a> (OANDA feed) · display only, they don't fill orders or change your balance.</span>
          {live && <button className="underline" onClick={disableLive}>Turn off live prices</button>}
        </div>
      </section>

      <section className={`${show('trade')} min-h-0 flex-col bg-card lg:row-span-2`} aria-label="Order panel">
        <OrderTicket key={pair.symbol} pair={pair} account={visible} dailyLossAmount={rules?.dailyLossAmount ?? null} marketOpen={marketOpen} engine={engine} />
      </section>

      <section className={`${view === 'history' || view === 'account' ? 'flex' : 'hidden'} min-w-0 flex-col bg-card lg:flex`} aria-label="Terminal">
        <Toolbox engine={engine} tab={view === 'account' ? 'account' : tool} setTab={t => { setTool(t); if (view === 'history' && t === 'account') setView('account'); else if (view === 'account' && t !== 'account') setView('history'); }}
          account={visible} accounts={accounts} loading={loading} rules={rules} loadedFor={loadedFor === uid} requested={requested}
          onSelectAccount={id => setParams(prev => { const next = new URLSearchParams(prev); next.set('account', id); return next; })} />
      </section>
    </main>

    {/* Phone navigation, like the MT5 app */}
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-card lg:hidden" aria-label="Terminal sections">
      {([['quotes', 'Quotes', ListOrdered], ['chart', 'Chart', LineChart], ['trade', 'Trade', BarChart3], ['history', 'History', History], ['account', 'Account', User]] as const).map(([id, label, Icon]) =>
        <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => { setView(id); if (id === 'history' && tool === 'account') setTool('positions'); }} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${view === id ? 'text-primary font-semibold' : 'text-muted-foreground'}`}><Icon size={19} aria-hidden="true" />{label}</button>)}
    </nav>
  </div>;
}

function AccountStrip({ account, loading, snapshot }: { account: Account | null; loading: boolean; snapshot: Snapshot | null }) {
  const m = snapshot?.metrics;
  const tone = (v: number) => (v < 0 ? 'text-red-500' : v > 0 ? 'text-emerald-500' : '');
  const items: [string, string, string?][] = m
    ? [['Balance', money(m.balance)], ['Equity', money(m.equity)], ['Floating P/L', money(m.floatingProfit), tone(m.floatingProfit)], ['Margin', money(m.margin)], ['Free margin', money(m.freeMargin)], ['Margin level', m.marginLevel === null ? '—' : `${m.marginLevel.toFixed(0)}%`], ['Room to loss limit', money(m.roomToFloor), m.roomToFloor < 0 ? 'text-red-500' : '']]
    : account
      ? [['Balance', money(account.balance)], ['Equity', money(account.equity)], ['Floating P/L', money(account.equity - account.balance), tone(account.equity - account.balance)], ['Margin', money(0)], ['Free margin', money(account.equity)], ['Stage', `Phase ${account.currentPhase}`]]
      : [['Balance', '—'], ['Equity', '—'], ['Floating P/L', '—'], ['Margin', '—'], ['Free margin', '—'], ['Stage', loading ? 'Loading…' : 'No account']];
  return <dl className="flex gap-px overflow-x-auto border-t bg-border text-xs" aria-label="Account summary">
    {items.map(([label, value, t]) => <div key={label} className="min-w-[110px] flex-1 bg-card px-3 py-1.5"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className={`font-mono text-sm font-semibold tabular-nums ${t ?? ''}`}>{value}</dd></div>)}
  </dl>;
}

function MarketWatch({ selected, onSelect }: { selected: ForexPair; onSelect: (p: ForexPair) => void }) {
  const [query, setQuery] = useState(''), [group, setGroup] = useState<(typeof GROUPS)[number]>('All');
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const toggleFavorite = (symbol: string) => setFavorites(prev => { const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]; saveFavorites(next); return next; });
  const list = useMemo(() => {
    const base = group === 'All' ? FOREX_PAIRS : group === 'Favorites' ? FOREX_PAIRS.filter(p => favorites.includes(p.symbol)) : FOREX_PAIRS.filter(p => p.group === group);
    return searchPairs(base, query);
  }, [group, favorites, query]);
  return <>
    <div className="border-b px-3 pb-2 pt-3">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Market Watch</h2><span className="text-[11px] text-muted-foreground">{FOREX_PAIRS.length} forex pairs</span></div>
      <label className="mt-2 flex items-center gap-2 rounded-md border bg-background px-2"><Search size={14} className="text-muted-foreground" aria-hidden="true" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search EUR, yen, GBP/JPY…" aria-label="Search forex pairs" className="w-full bg-transparent py-1.5 text-sm outline-none" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      <div className="mt-2 flex gap-1 overflow-x-auto" role="group" aria-label="Pair groups">
        {GROUPS.map(g => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`shrink-0 rounded px-2 py-1 text-xs ${group === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{g === 'Favorites' ? `★ ${favorites.length}` : g}</button>)}
      </div>
    </div>
    <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"><span>Symbol</span><span>Pip</span><span className="w-6" /></div>
    <ul className="min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-230px)]" data-testid="market-watch">
      {list.map(p => {
        const active = p.symbol === selected.symbol, fav = favorites.includes(p.symbol);
        return <li key={p.symbol} className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border/50 px-3 ${active ? 'bg-primary/10' : 'hover:bg-secondary/60'}`}>
          <button type="button" onClick={() => onSelect(p)} aria-current={active ? 'true' : undefined} className="min-w-0 py-2 text-left">
            <span className="block font-mono text-sm font-semibold">{p.symbol}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{pairName(p)}</span>
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">{p.pipSize}</span>
          <button type="button" onClick={() => toggleFavorite(p.symbol)} aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} ${p.symbol} ${fav ? 'from' : 'to'} favourites`} className="grid h-6 w-6 place-items-center"><Star size={14} className={fav ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'} /></button>
        </li>;
      })}
      {!list.length && <li className="p-4 text-sm text-muted-foreground">{group === 'Favorites' && !query ? 'Tap the star next to a pair to keep it here.' : 'No pair matches your search.'}</li>}
    </ul>
  </>;
}

function OrderTicket({ pair, account, dailyLossAmount, marketOpen, engine }: { pair: ForexPair; account: Account | null; dailyLossAmount: number | null; marketOpen: boolean; engine: EngineHandle }) {
  const [lotsText, setLotsText] = useState('0.10'), [type, setType] = useState<'market' | 'limit' | 'stop'>('market');
  const [entry, setEntry] = useState(''), [slText, setSlText] = useState(''), [tpText, setTpText] = useState('');
  const [review, setReview] = useState<Side | null>(null), [sent, setSent] = useState('');
  const lots = normalizeLots(lotsText);
  const step = (dir: 1 | -1) => setLotsText(((normalizeLots((lots ?? LOT_MIN) + dir * LOT_STEP) ?? LOT_MIN)).toFixed(2));
  const sl = parsePips(slText), tp = parsePips(tpText);
  const f = ticketFigures({ pair, lots, slPips: sl, tpPips: tp, balance: account?.balance, dailyLossAmount });
  const calc = calculatorKind(pair);
  const sizeLink = positionSizeLink({ accountSize: [5000, 10000, 25000, 50000, 100000, 200000].includes(account?.startingBalance ?? 0) ? account!.startingBalance : 10000, kind: calc.kind, quote: calc.quote, stop: sl ?? undefined });
  const quote = engine.snapshot?.quotes[pair.symbol];
  const canSend = !!(account?.tradingEnabled && engine.status?.execution && engine.snapshot && quote);
  const holdReason = !account ? 'Open a purchased account to trade.' : !account.tradingEnabled ? (account.tradingHoldReason || 'Trading is not available yet.') : !engine.status?.connected ? 'Trading isn\u2019t connected yet.' : !quote ? `No live ${pair.symbol} price from the trading server.` : '';
  const send = async () => {
    if (!review || !lots || !account || !quote) return;
    const entryPrice = type === 'market' ? (review === 'buy' ? quote.ask : quote.bid) : Number(entry.replace(',', '.'));
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) { setSent(''); return; }
    const p = protectionPrices(review, entryPrice, sl, tp, pair.pipSize, pair.digits);
    const ok = await engine.run(g => g.placeOrder(account.accountId, { symbol: pair.symbol, side: review, type, lots, ...(type !== 'market' ? { price: entryPrice } : {}), ...p, clientId: crypto.randomUUID() }));
    if (ok) { setSent(`${review === 'buy' ? 'Bought' : 'Sold'} ${lots.toFixed(2)} ${pair.symbol}${type === 'market' ? '' : ` (${type} order placed)`}.`); setReview(null); }
  };
  const field = 'w-full rounded-md border bg-background px-2.5 py-2 font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring';
  return <div className="flex flex-col gap-4 overflow-y-auto p-4" data-testid="order-ticket">
    <div className="flex items-start justify-between gap-2">
      <div><h2 className="text-sm font-semibold">New order</h2><p className="font-mono text-lg font-bold">{pair.symbol}</p></div>
      <span className={`rounded-full px-2 py-0.5 text-[11px] ${marketOpen ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>Market {marketOpen ? 'open' : 'closed'}</span>
    </div>

    <label className="text-xs text-muted-foreground">Order type
      <select value={type} onChange={e => setType(e.target.value as typeof type)} className={`${field} mt-1 font-sans`}>
        <option value="market">Market execution</option><option value="limit">Pending · Limit</option><option value="stop">Pending · Stop</option>
      </select></label>

    <div>
      <label htmlFor="ticket-lots" className="text-xs text-muted-foreground">Volume (lots)</label>
      <div className="mt-1 flex items-stretch gap-1">
        <button type="button" aria-label="Decrease volume" onClick={() => step(-1)} className="rounded-md border px-3 hover:bg-secondary"><Minus size={14} /></button>
        <input id="ticket-lots" inputMode="decimal" value={lotsText} onChange={e => setLotsText(e.target.value)} onBlur={() => lots && setLotsText(lots.toFixed(2))} className={`${field} text-center text-base font-semibold`} aria-invalid={!lots} />
        <button type="button" aria-label="Increase volume" onClick={() => step(1)} className="rounded-md border px-3 hover:bg-secondary"><Plus size={14} /></button>
      </div>
      <div className="mt-1.5 flex gap-1">{['0.01', '0.10', '0.50', '1.00'].map(v => <button key={v} type="button" onClick={() => setLotsText(v)} className={`flex-1 rounded border py-1 font-mono text-xs ${lotsText === v ? 'border-primary bg-primary/10' : 'hover:bg-secondary'}`}>{v}</button>)}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{lots ? `${f.units?.toLocaleString()} ${pair.base} · ${LOT_MIN}–${LOT_MAX} lots, step ${LOT_STEP}` : `Enter a volume from ${LOT_MIN} to ${LOT_MAX} lots.`}</p>
    </div>

    {type !== 'market' && <label className="text-xs text-muted-foreground">{type === 'limit' ? 'Limit' : 'Stop'} price
      <input inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} placeholder={`e.g. ${pair.quote === 'JPY' ? '150.250' : '1.08500'}`} className={`${field} mt-1`} /></label>}

    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-muted-foreground">Stop loss (pips)<input inputMode="decimal" value={slText} onChange={e => setSlText(e.target.value)} placeholder="Off" className={`${field} mt-1`} /></label>
      <label className="text-xs text-muted-foreground">Take profit (pips)<input inputMode="decimal" value={tpText} onChange={e => setTpText(e.target.value)} placeholder="Off" className={`${field} mt-1`} /></label>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => { setSent(''); setReview('sell'); }} disabled={!lots} className="flex flex-col items-center rounded-lg bg-red-600 py-3 font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50" data-testid="sell-button"><span className="flex items-center gap-1 text-base"><ArrowDownRight size={17} aria-hidden="true" />SELL</span><span className="font-mono text-[11px] font-normal opacity-90">{type === 'market' ? (quote ? quote.bid.toFixed(pair.digits) : 'at bid') : `${type} order`}</span></button>
      <button type="button" onClick={() => { setSent(''); setReview('buy'); }} disabled={!lots} className="flex flex-col items-center rounded-lg bg-blue-600 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50" data-testid="buy-button"><span className="flex items-center gap-1 text-base"><ArrowUpRight size={17} aria-hidden="true" />BUY</span><span className="font-mono text-[11px] font-normal opacity-90">{type === 'market' ? (quote ? quote.ask.toFixed(pair.digits) : 'at ask') : `${type} order`}</span></button>
    </div>

    {review && lots && <div role="status" className={`rounded-lg border p-3 text-sm ${review === 'buy' ? 'border-blue-500/40 bg-blue-500/5' : 'border-red-500/40 bg-red-500/5'}`} data-testid="order-review">
      <div className="flex items-start justify-between gap-2"><p className="font-semibold">{review === 'buy' ? 'Buy' : 'Sell'} {lots.toFixed(2)} {pair.symbol} {type === 'market' ? 'at market' : `${type} at ${entry || '—'}`}</p><button type="button" aria-label="Close order review" onClick={() => setReview(null)}><X size={14} /></button></div>
      <p className="mt-1 text-xs text-muted-foreground">Stop loss {sl ? `${sl} pips` : 'off'} · Take profit {tp ? `${tp} pips` : 'off'}{f.risk !== null ? ` · risk ${money(f.risk)}` : ''}</p>
      {canSend
        ? <button type="button" disabled={engine.busy} onClick={() => void send()} className={`mt-3 w-full rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${review === 'buy' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`} data-testid="confirm-order">{engine.busy ? 'Sending…' : `Confirm ${review === 'buy' ? 'buy' : 'sell'}`}</button>
        : <p className="mt-2 flex items-start gap-1.5 text-xs"><LockKeyhole size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />{holdReason} This order was not sent.</p>}
      {engine.error && <p role="alert" className="mt-2 text-xs text-red-500">{engine.error}</p>}
    </div>}
    {sent && <p role="status" className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400" data-testid="order-sent">{sent}</p>}

    <dl className="space-y-1.5 rounded-lg bg-secondary/40 p-3 text-xs">
      {([
        ['Contract size', `${CONTRACT_SIZE.toLocaleString()} ${pair.base} / lot`],
        ['Pip size', String(pair.pipSize)],
        ['Pip value', f.pipValue !== null ? `${money(f.pipValue)} per pip` : `Moves with the ${pair.quote}/USD rate`],
        ['Risk at stop loss', f.risk !== null ? `${money(f.risk)}${f.riskPercent !== null ? ` (${f.riskPercent}% of balance)` : ''}` : sl ? 'Use the lot size calculator' : 'Set a stop loss'],
        ['Profit at take profit', f.reward !== null ? money(f.reward) : tp ? 'Use the lot size calculator' : '—'],
        ['Reward : risk', f.rewardRatio !== null ? `${f.rewardRatio} : 1` : '—'],
      ] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
    </dl>
    {f.riskShareOfDaily !== null && <p className={`text-xs ${f.riskShareOfDaily >= 100 ? 'text-red-500' : f.riskShareOfDaily >= 50 ? 'text-amber-600' : 'text-muted-foreground'}`} data-testid="daily-share">{f.riskShareOfDaily >= 100 ? `This stop would lose more than your whole daily loss allowance (${money(dailyLossAmount!)}).` : `This stop uses ${f.riskShareOfDaily}% of your ${money(dailyLossAmount!)} daily loss allowance.`}</p>}
    <Link to={sizeLink} className="text-xs underline underline-offset-2">Work out the exact lot size for {pairLabel(pair)}</Link>
    <p className="text-[11px] text-muted-foreground">When trading opens, the server sets the fill price, spread and margin and checks your challenge rules before any order is accepted. Leverage and commissions are confirmed with the broker before launch.</p>
  </div>;
}

function Toolbox({ engine, tab, setTab, account, accounts, loading, rules, loadedFor, requested, onSelectAccount }: {
  engine: EngineHandle; tab: ToolTab; setTab: (t: ToolTab) => void; account: Account | null; accounts: Account[]; loading: boolean; loadedFor: boolean; requested: string;
  rules: ReturnType<typeof rulesInDollars> | null; onSelectAccount: (id: string) => void;
}) {
  const tabs: [ToolTab, string][] = [['positions', 'Positions'], ['orders', 'Pending orders'], ['history', 'History'], ['account', 'Account']];
  const head = 'whitespace-nowrap px-3 py-1.5 text-left font-medium';
  return <div className="flex min-h-[240px] flex-col">
    <div className="flex overflow-x-auto border-b" role="tablist" aria-label="Terminal">
      {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-4 py-2 text-xs font-medium ${tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
    </div>
    {tab !== 'account' && <EngineTables tab={tab} engine={engine} hasAccount={!!account} />}
    {tab === 'account' && <div className="grid gap-4 p-4 md:grid-cols-2" role="tabpanel">
      <div className="space-y-3">
        {loading && !account && <p role="status" className="text-sm text-muted-foreground">Checking your account…</p>}
        {!loading && loadedFor && !accounts.length && <div className="space-y-2 text-sm"><p className="text-muted-foreground">Your FYNX Trade account appears here after a confirmed challenge purchase. If you already paid, check Billing before paying again.</p><Link to="/challenges" className="inline-flex items-center gap-1 underline">Explore challenges<ArrowUpRight size={14} /></Link><Link className="block underline" to="/dashboard/billing">View orders</Link></div>}
        {loadedFor && accounts.length > 0 && <label className="block text-xs text-muted-foreground">Trading account<select value={requested || accounts[0]?.accountId} onChange={e => onSelectAccount(e.target.value)} className="mt-1 w-full min-w-0 rounded-md border bg-background p-2 font-mono text-sm text-foreground">{accounts.map(a => <option key={a.accountId} value={a.accountId}>#{a.accountId.slice(-8)} · {money(a.startingBalance)} · {a.status}</option>)}</select></label>}
        {account && <>
          <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs"><CheckCircle2 size={13} />{account.access === 'history_only' ? 'History only' : 'Access activated'}</span><span className="rounded-full bg-secondary px-3 py-1 text-xs">Simulated funds</span></div>
          <p className="break-all font-mono text-xs text-muted-foreground">Account {account.accountId}</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">{[['Starting balance', money(account.startingBalance)], ['Balance', money(account.balance)], ['Equity', money(account.equity)], ['Stage', `Phase ${account.currentPhase}`]].map(([k, v]) => <div key={k} className="rounded-md bg-secondary/40 p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-mono font-semibold">{v}</dd></div>)}</dl>
          <Link className="block text-sm underline" to={`/dashboard/accounts/${encodeURIComponent(account.challengeId)}`}>View challenge details</Link>
        </>}
      </div>
      <div className="space-y-3">
        {account && rules && <div><h3 className="flex items-center gap-1.5 text-sm font-semibold"><Wallet size={15} aria-hidden="true" />Your rules in dollars</h3>
          <dl className="mt-2 space-y-1.5 text-sm" data-testid="trade-rules">{[
            ['Profit target', `${account.rules.profit_target_percent}%${rules.targetAmount !== null ? ` · +${money(rules.targetAmount)} (balance ${money(rules.targetBalance!)})` : ''}`],
            ['Daily loss limit', `${account.rules.daily_loss_percent}%${rules.dailyLossAmount !== null ? ` · ${money(rules.dailyLossAmount)} from the 22:00 UTC balance` : ''}`],
            ['Maximum loss', `${account.rules.max_loss_percent}%${rules.maxLossFloor !== null ? ` · equity must not fall below ${money(rules.maxLossFloor)}` : ''}`],
            ['Minimum trading days', String(account.rules.min_trading_days)],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl>
          <p className="mt-2 text-xs text-muted-foreground">Rules recorded with your purchase. Viewing prices does not start a trading day.</p></div>}
        <div className="rounded-md border p-3"><p className="flex items-center gap-1.5 text-sm font-semibold"><Mail size={15} aria-hidden="true" />Account email</p><p className="mt-1 text-xs text-muted-foreground">After payment and account creation we email a secure link to this account. Sign in with your FYNX login; no trading password is emailed.</p>{account && <p role="status" className="mt-2 text-xs">{accountEmailStatus(account.accountEmailStatus)}</p>}</div>
      </div>
    </div>}
  </div>;
}

function floatingUsd(symbol: string, side: Side, lots: number, entry: number, current: number | undefined, quotes: QuoteBook): number {
  const pair = findPair(symbol);
  if (!pair || current === undefined) return NaN;
  try { return profitUsd({ contractSize: CONTRACT_SIZE, quote: pair.quote } as InstrumentSpec, side, lots, entry, current, quotes); } catch { return NaN; }
}

const time = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const px = (symbol: string, v?: number) => v === undefined ? '—' : v.toFixed(findPair(symbol)?.digits ?? 5);

function EngineTables({ tab, engine, hasAccount }: { tab: Exclude<ToolTab, 'account'>; engine: EngineHandle; hasAccount: boolean }) {
  const snap = engine.snapshot, accountId = snap?.state.accountId;
  const head = 'whitespace-nowrap px-3 py-1.5 text-left font-medium';
  const cell = 'whitespace-nowrap px-3 py-1.5 font-mono';
  const empty = (what: string) => <p className="p-4 text-sm text-muted-foreground">{what} {!engine.status?.connected && hasAccount ? 'They will appear here once trading opens on this account.' : ''}</p>;
  const headers = tab === 'positions' ? ['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S/L', 'T/P', 'Current', 'Profit', '']
    : tab === 'orders' ? ['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S/L', 'T/P', '']
    : ['Symbol', 'Closed', 'Type', 'Volume', 'Open', 'Close', 'Commission', 'Profit', 'Reason'];
  const rows = tab === 'positions' ? snap?.state.positions ?? [] : tab === 'orders' ? snap?.state.orders ?? [] : [...(snap?.state.history ?? [])].reverse();
  return <div className="overflow-x-auto" role="tabpanel" data-testid={`engine-${tab}`}>
    <table className="w-full text-xs"><thead className="bg-secondary/40 text-muted-foreground"><tr>{headers.map((h, i) => <th key={h || i} scope="col" className={head}>{h}</th>)}</tr></thead>
      <tbody>
        {tab === 'positions' && snap?.state.positions.map(p => { const q = snap.quotes[p.symbol]; const cur = q ? (p.side === 'buy' ? q.bid : q.ask) : undefined; const pr = floatingUsd(p.symbol, p.side, p.lots, p.entryPrice, cur, snap.quotes); return <tr key={p.id} className="border-b border-border/60">
          <td className={`${cell} font-semibold`}>{p.symbol}</td><td className={cell}>{p.id}</td><td className={cell}>{time(p.openedAt)}</td><td className={`${cell} ${p.side === 'buy' ? 'text-blue-500' : 'text-red-500'}`}>{p.side}</td><td className={cell}>{p.lots.toFixed(2)}</td><td className={cell}>{px(p.symbol, p.entryPrice)}</td><td className={cell}>{px(p.symbol, p.stopLoss)}</td><td className={cell}>{px(p.symbol, p.takeProfit)}</td><td className={cell}>{px(p.symbol, cur)}</td>
          <td className={`${cell} ${pr < 0 ? 'text-red-500' : pr > 0 ? 'text-emerald-500' : ''}`}>{Number.isFinite(pr) ? money(pr) : '—'}</td>
          <td className="px-3 py-1"><button type="button" disabled={engine.busy} onClick={() => accountId && void engine.run(g => g.closePosition(accountId, p.id))} className="rounded border px-2 py-0.5 hover:bg-secondary" aria-label={`Close ${p.symbol} position ${p.id}`}><X size={12} /></button></td>
        </tr>; })}
        {tab === 'orders' && snap?.state.orders.map(o => <tr key={o.id} className="border-b border-border/60">
          <td className={`${cell} font-semibold`}>{o.symbol}</td><td className={cell}>{o.id}</td><td className={cell}>{time(o.createdAt)}</td><td className={cell}>{o.side} {o.type}</td><td className={cell}>{o.lots.toFixed(2)}</td><td className={cell}>{px(o.symbol, o.price)}</td><td className={cell}>{px(o.symbol, o.stopLoss)}</td><td className={cell}>{px(o.symbol, o.takeProfit)}</td>
          <td className="px-3 py-1"><button type="button" disabled={engine.busy} onClick={() => accountId && void engine.run(g => g.cancelOrder(accountId, o.id))} className="rounded border px-2 py-0.5 hover:bg-secondary" aria-label={`Cancel ${o.symbol} order ${o.id}`}><X size={12} /></button></td>
        </tr>)}
        {tab === 'history' && [...(snap?.state.history ?? [])].reverse().map(d => <tr key={d.id} className="border-b border-border/60">
          <td className={`${cell} font-semibold`}>{d.symbol}</td><td className={cell}>{time(d.closedAt)}</td><td className={cell}>{d.side}</td><td className={cell}>{d.lots.toFixed(2)}</td><td className={cell}>{px(d.symbol, d.entryPrice)}</td><td className={cell}>{px(d.symbol, d.exitPrice)}</td><td className={cell}>{money(-d.commission)}</td>
          <td className={`${cell} ${d.netProfit < 0 ? 'text-red-500' : d.netProfit > 0 ? 'text-emerald-500' : ''}`}>{money(d.netProfit)}</td><td className="whitespace-nowrap px-3 py-1.5">{d.reason.replace(/_/g, ' ')}</td>
        </tr>)}
      </tbody>
    </table>
    {!rows.length && (tab === 'positions' ? empty('No open positions.') : tab === 'orders' ? empty('No pending orders.') : <div className="p-4 text-sm"><p className="text-muted-foreground">No closed trades on this account yet.</p><Link className="mt-2 inline-block text-sm underline" to="/dashboard/trades">Open your full trade journal</Link></div>)}
    {engine.error && <p role="alert" className="px-4 pb-3 text-xs text-red-500">{engine.error}</p>}
  </div>;
}

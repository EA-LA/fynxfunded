import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3, CandlestickChart, CheckCircle2, Clock, History, Info, LineChart, ListOrdered, LockKeyhole, Mail, Minus, Pencil, Plus, RefreshCw, Search, Star, User, Wallet, X } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { fundedAccessCall } from '@/services/funded-access';
import { positionSizeLink } from '@/lib/positionSize';
import { formatCountdown, tradingDayStatus } from '@/lib/tradingDayClock';
import { accountEmailStatus } from './email-status';
import {
  CONTRACT_SIZE, DEFAULT_SYMBOL, FOREX_PAIRS, LOT_MAX, LOT_MIN, LOT_STEP, calculatorKind, findPair,
  loadFavorites, normalizeLots, pairLabel, pairName, saveFavorites, searchPairs, type ForexGroup, type ForexPair,
} from './instruments';
import { parsePips, protectionPrices, rulesInDollars, ticketFigures, type AccountRules } from './ticket';
import { orderCosts, weekdayName } from './costs';
import { reasonLabel } from './statement';
import TicketRiskSize from './TicketRiskSize';
import StatementBar from './StatementBar';
import { engineLabel, useEngine, type EngineHandle } from './useEngine';
import type { TradingGateway } from '@/engine/gateway';
import type { Snapshot } from '@/engine/venue';
import { profitUsd } from '@/engine/core';
import type { Deal, HistoryPage, InstrumentSpec, QuoteBook } from '@/engine/types';
import TvWidget, { readLiveConsent, saveLiveConsent } from './TvWidget';
import PositionEditor from './PositionEditor';
import OrderEditor from './OrderEditor';
import BulkClose from './BulkClose';
import { parseDeviation, parseTrailing, trailingPreview } from './protection';
import ExpiryPicker from './ExpiryPicker';
import OcoPicker from './OcoPicker';
import { chosenLink, orderLabel } from './oco';
import { expiryAt, expiryLabel, expiryValue, type ExpiryChoice } from './expiry';
import TargetProgress from './TargetProgress';
import DailyStatement from './DailyStatement';
import { todayLow } from './daily-statement';
import ContractSpec from './ContractSpec';
import AlertsPanel from './AlertsPanel';
import { firedSentence, newlyFired } from './alerts';
import { toast } from 'sonner';
import { spreadOf } from './contract-spec';
import { FOREX_HOURS, marketState } from '@/engine/hours';
import { closedSentence, localAt, pairMarket, untilLabel, useNow, type PairMarket } from './market-hours';
import type { GatewayStatus } from '@/engine/gateway';
import { metricsGaps } from './live-account';

interface Account {
  accountId: string; challengeId: string; orderId: string; platform: string; status: string;
  activationStatus: string; currentPhase: number; startingBalance: number; balance: number; equity: number;
  tradingEnabled: boolean; tradingHoldReason: string; access?: string; accountEmailStatus?: string;
  rules: AccountRules;
}
type Side = 'buy' | 'sell';
type MobileView = 'quotes' | 'chart' | 'trade' | 'history' | 'account';
type ToolTab = 'positions' | 'orders' | 'history' | 'alerts' | 'account';

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
  // Price alerts that fire while the terminal is open pop up once; ones that fired earlier are only listed in the Alerts tab.
  const seenAlerts = useRef<{ account: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const snap = engine.snapshot;
    if (!snap) return;
    const fired = snap.state.triggeredAlerts;
    if (seenAlerts.current?.account !== snap.state.accountId) { seenAlerts.current = { account: snap.state.accountId, ids: new Set((fired ?? []).map(a => a.id)) }; return; }
    for (const a of newlyFired(fired, seenAlerts.current.ids)) toast(`Price alert: ${firedSentence(a, findPair(a.symbol)?.digits ?? 5)}`, { description: a.note });
  }, [engine.snapshot]);

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
  const market = marketState(FOREX_HOURS, now.getTime()), marketOpen = market.open, day = tradingDayStatus(now);
  const pairState = pairMarket(engine.status, pair.symbol, now.getTime());

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
          <span data-testid="engine-status" title={engine.status?.message} className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs md:inline-flex ${engine.status?.execution ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${engine.status?.execution ? 'bg-emerald-500' : engine.status?.connected ? 'bg-amber-500' : 'bg-muted-foreground'}`} />{engineLabel(engine.status)}</span>
          <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs md:inline-flex ${marketOpen ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`} title={`Forex week: Sunday 17:00 to Friday 17:00 New York time (22:00 UTC, 21:00 in US summer). ${market.nextChange ? `${marketOpen ? 'Closes' : 'Opens'} ${localAt(market.nextChange)} your time.` : ''} Broker hours can differ.`}><span className={`h-1.5 w-1.5 rounded-full ${marketOpen ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />Forex {marketOpen ? 'open' : 'closed'}</span>
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
        <MarketWatch selected={pair} status={engine.status} quotes={engine.snapshot?.quotes} now={now.getTime()} onSelect={p => { setSymbol(p.symbol); setView('chart'); }} />
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
        <OrderTicket key={pair.symbol} pair={pair} account={visible} dailyLossAmount={rules?.dailyLossAmount ?? null} market={pairState} now={now.getTime()} engine={engine} />
      </section>

      <section className={`${view === 'history' || view === 'account' ? 'flex' : 'hidden'} min-w-0 flex-col bg-card lg:flex`} aria-label="Terminal">
        <Toolbox engine={engine} pair={pair} now={now.getTime()} tab={view === 'account' ? 'account' : tool} setTab={t => { setTool(t); if (view === 'history' && t === 'account') setView('account'); else if (view === 'account' && t !== 'account') setView('history'); }}
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
  const gaps = m ? metricsGaps(m) : null;
  const tone = (v: number) => (v < 0 ? 'text-red-500' : v > 0 ? 'text-emerald-500' : '');
  const wait = 'Waiting…';
  const eq = !!gaps?.equityKnown, mg = eq && !!gaps?.marginKnown;
  const items: [string, string, string?][] = m
    ? [['Balance', money(m.balance)], ['Equity', eq ? money(m.equity) : wait], ['Floating P/L', eq ? money(m.floatingProfit) : wait, eq ? tone(m.floatingProfit) : ''], ['Margin', gaps?.marginKnown ? money(m.margin) : wait], ['Free margin', mg ? money(m.freeMargin) : wait], ['Margin level', !mg ? wait : m.marginLevel === null ? '—' : `${m.marginLevel.toFixed(0)}%`], ['Room to loss limit', eq ? money(m.roomToFloor) : wait, eq && m.roomToFloor < 0 ? 'text-red-500' : '']]
    : account
      ? [['Balance', money(account.balance)], ['Equity', money(account.equity)], ['Floating P/L', money(account.equity - account.balance), tone(account.equity - account.balance)], ['Margin', money(0)], ['Free margin', money(account.equity)], ['Stage', `Phase ${account.currentPhase}`]]
      : [['Balance', '—'], ['Equity', '—'], ['Floating P/L', '—'], ['Margin', '—'], ['Free margin', '—'], ['Stage', loading ? 'Loading…' : 'No account']];
  return <div className="border-t">
    <dl className="flex gap-px overflow-x-auto bg-border text-xs" aria-label="Account summary">
      {items.map(([label, value, t]) => <div key={label} className="min-w-[110px] flex-1 bg-card px-3 py-1.5"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className={`font-mono text-sm font-semibold tabular-nums ${t ?? ''}`}>{value}</dd></div>)}
    </dl>
    {gaps?.message && <p role="status" data-testid="strip-prices-missing" className="bg-amber-500/10 px-3 py-1 text-[11px] text-amber-700 dark:text-amber-300">{gaps.message}</p>}
  </div>;
}

function MarketWatch({ selected, onSelect, status, quotes, now }: { selected: ForexPair; onSelect: (p: ForexPair) => void; status: GatewayStatus | null; quotes?: QuoteBook | null; now: number }) {
  const [query, setQuery] = useState(''), [group, setGroup] = useState<(typeof GROUPS)[number]>('All');
  const [specFor, setSpecFor] = useState<ForexPair | null>(null);
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
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"><span>Symbol</span><span>Pip</span><span className="w-6" /><span className="w-6" /></div>
    <ul className="min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-230px)]" data-testid="market-watch">
      {list.map(p => {
        const active = p.symbol === selected.symbol, fav = favorites.includes(p.symbol);
        const m = pairMarket(status, p.symbol, now), special = !m.open && m.reason && m.reason !== 'Outside trading hours' ? m.reason : '';
        return <li key={p.symbol} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-border/50 px-3 ${active ? 'bg-primary/10' : 'hover:bg-secondary/60'}`}>
          <button type="button" onClick={() => onSelect(p)} aria-current={active ? 'true' : undefined} className="min-w-0 py-2 text-left">
            <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">{p.symbol}{!m.open && <span data-testid={`closed-${p.symbol}`} title={closedSentence(p.symbol, m, now)} className="inline-flex items-center gap-0.5 rounded bg-secondary px-1 py-px font-sans text-[10px] font-normal text-muted-foreground"><LockKeyhole size={9} aria-hidden="true" />{special || 'Closed'}</span>}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{pairName(p)}</span>
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">{p.pipSize}</span>
          <button type="button" onClick={() => setSpecFor(p)} aria-label={`Contract specification for ${p.symbol}`} data-testid={`watch-spec-${p.symbol}`} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"><Info size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => toggleFavorite(p.symbol)} aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} ${p.symbol} ${fav ? 'from' : 'to'} favourites`} className="grid h-6 w-6 place-items-center"><Star size={14} className={fav ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'} /></button>
        </li>;
      })}
      {!list.length && <li className="p-4 text-sm text-muted-foreground">{group === 'Favorites' && !query ? 'Tap the star next to a pair to keep it here.' : 'No pair matches your search.'}</li>}
    </ul>
    {specFor && <ContractSpec pair={specFor} status={status} quotes={quotes} market={pairMarket(status, specFor.symbol, now)} now={now} open onOpenChange={o => { if (!o) setSpecFor(null); }} trigger={false} />}
  </>;
}

/** Optional trailing stop in the order ticket, with where it starts for this entry. */
function TicketTrailing({ pair, text, onText, type, entry, quote }: { pair: ForexPair; text: string; onText: (v: string) => void; type: 'market' | 'limit' | 'stop'; entry: string; quote?: { bid: number; ask: number } }) {
  const t = parseTrailing(text);
  const ref = type === 'market' ? null : Number(entry.replace(',', '.'));
  const fmt = (v: number) => v.toFixed(pair.digits);
  const pre = (side: Side, at: number | undefined) => t.ok && t.value !== null && at !== undefined && Number.isFinite(at) && at > 0 ? fmt(trailingPreview(pair, side, at, undefined, t.value, null).startsAt) : null;
  const buyAt = pre('buy', type === 'market' ? quote?.ask : ref ?? undefined), sellAt = pre('sell', type === 'market' ? quote?.bid : ref ?? undefined);
  return <div>
    <label htmlFor="ticket-trailing" className="text-xs text-muted-foreground">Trailing stop (pips)</label>
    <div className="mt-1 flex items-stretch gap-1">
      <input id="ticket-trailing" inputMode="decimal" value={text} onChange={e => onText(e.target.value)} placeholder="Off" aria-invalid={!t.ok} aria-describedby="ticket-trailing-help" className="w-full rounded-md border bg-background px-2.5 py-2 font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring" />
      {['15', '30'].map(v => <button key={v} type="button" onClick={() => onText(text === v ? '' : v)} aria-pressed={text === v} aria-label={`Trailing stop ${v} pips`} className={`rounded border px-2 font-mono text-xs ${text === v ? 'border-primary bg-primary/10' : 'hover:bg-secondary'}`}>{v}</button>)}
    </div>
    <p id="ticket-trailing-help" data-testid="ticket-trailing-help" className={`mt-1 text-[11px] ${t.ok ? 'text-muted-foreground' : 'text-red-500'}`}>
      {t.ok === false ? t.error
        : t.value === null ? 'Off. With a distance, the trading server moves your stop behind the price once the trade is that far in profit, even with this page closed.'
        : `Starts ${t.value} pips in profit with the stop at break-even, then follows the price and never moves back.${buyAt && sellAt ? ` From ${type === 'market' ? 'the current price' : 'this order price'} it starts at ${buyAt} on a buy, ${sellAt} on a sell.` : ''}${type !== 'market' ? ' Applied when the order fills.' : ''}`}
    </p>
  </div>;
}

/** Market orders: optional price protection (largest move against the trader between Confirm and the fill). */
function TicketDeviation({ pair, text, onText }: { pair: ForexPair; text: string; onText: (v: string) => void }) {
  const d = parseDeviation(text);
  const pipText = pair.pipSize.toFixed(pair.digits - 1);
  return <div>
    <label htmlFor="ticket-deviation" className="text-xs text-muted-foreground">Price protection (pips)</label>
    <div className="mt-1 flex items-stretch gap-1">
      <input id="ticket-deviation" inputMode="decimal" value={text} onChange={e => onText(e.target.value)} placeholder="Off" aria-invalid={!d.ok} aria-describedby="ticket-deviation-help" className="w-full rounded-md border bg-background px-2.5 py-2 font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring" />
      {['0', '1', '3'].map(v => <button key={v} type="button" onClick={() => onText(text === v ? '' : v)} aria-pressed={text === v} aria-label={`Price protection ${v} pips`} className={`rounded border px-2 font-mono text-xs ${text === v ? 'border-primary bg-primary/10' : 'hover:bg-secondary'}`}>{v}</button>)}
    </div>
    <p id="ticket-deviation-help" data-testid="ticket-deviation-help" className={`mt-1 text-[11px] ${d.ok ? 'text-muted-foreground' : 'text-red-500'}`}>
      {d.ok === false ? d.error
        : d.value === null ? 'Off: the order fills at the price on the trading server when it arrives, even if it moved since you pressed Confirm.'
        : d.value === 0 ? 'Fills only at the price you see when you press Confirm, or better. If it moved against you, nothing is opened.'
        : `Fills only if the price moved no more than ${d.value} pips (${(d.value * pair.pipSize).toFixed(pair.digits)}) against you after Confirm; one pip is ${pipText}. A better price always fills.`}
    </p>
  </div>;
}

function OrderTicket({ pair, account, dailyLossAmount, market, now, engine }: { pair: ForexPair; account: Account | null; dailyLossAmount: number | null; market: PairMarket; now: number; engine: EngineHandle }) {
  const marketOpen = market.open;
  const [lotsText, setLotsText] = useState('0.10'), [type, setType] = useState<'market' | 'limit' | 'stop'>('market');
  const [entry, setEntry] = useState(''), [slText, setSlText] = useState(''), [tpText, setTpText] = useState(''), [trailText, setTrailText] = useState(''), [deviationText, setDeviationText] = useState('');
  const [review, setReview] = useState<Side | null>(null), [sent, setSent] = useState('');
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>('gtc'), [expiryText, setExpiryText] = useState('');
  const [ocoChoice, setOcoChoice] = useState('');
  const pendingOrders = engine.snapshot?.state.orders ?? [];
  // A link only applies to pending orders and only while the other order is still pending.
  const ocoWith = type === 'market' ? '' : chosenLink(ocoChoice, pendingOrders);
  const ocoPartner = pendingOrders.find(o => o.id === ocoWith);
  const lots = normalizeLots(lotsText);
  const step = (dir: 1 | -1) => setLotsText(((normalizeLots((lots ?? LOT_MIN) + dir * LOT_STEP) ?? LOT_MIN)).toFixed(2));
  const sl = parsePips(slText), tp = parsePips(tpText);
  const trail = parseTrailing(trailText), trailPips = trail.ok ? trail.value : null;
  // Price protection only applies to market orders; pending orders fill at their own price.
  const deviation = type === 'market' ? parseDeviation(deviationText) : { ok: true as const, value: null };
  const deviationPips = deviation.ok ? deviation.value : null;
  // Expiry only applies to pending orders; market orders fill at once.
  const expiry = type === 'market' ? { ok: true as const, value: null } : expiryValue(expiryChoice, expiryText, now);
  // The trading server's balance and prices when connected; the account record otherwise.
  const balance = engine.snapshot?.metrics.balance ?? account?.balance;
  const f = ticketFigures({ pair, lots, slPips: sl, tpPips: tp, balance, dailyLossAmount, quotes: engine.snapshot?.quotes });
  // Leverage, commission and swap only from the trading server's published conditions.
  const conditions = engine.status?.instruments?.[pair.symbol] ?? null;
  const gaps = engine.snapshot ? metricsGaps(engine.snapshot.metrics) : null;
  const figuresKnown = !gaps?.missing.length;
  // Free margin and room are only used while every open trade is valued.
  const costs = orderCosts({ pair, lots, conditions, quotes: engine.snapshot?.quotes, freeMargin: figuresKnown ? engine.snapshot?.metrics.freeMargin : null });
  const notConnected = 'Shown once trading is connected';
  const calc = calculatorKind(pair);
  const sizeLink = positionSizeLink({ accountSize: [5000, 10000, 25000, 50000, 100000, 200000].includes(account?.startingBalance ?? 0) ? account!.startingBalance : 10000, kind: calc.kind, quote: calc.quote, stop: sl ?? undefined });
  const quote = engine.snapshot?.quotes[pair.symbol];
  const spread = spreadOf(pair, quote, engine.snapshot?.quotes);
  const canSend = !!(marketOpen && account?.tradingEnabled && engine.status?.execution && engine.snapshot && quote);
  const holdReason = !marketOpen ? closedSentence(pair.symbol, market, now) : !account ? 'Open a purchased account to trade.' : !account.tradingEnabled ? (account.tradingHoldReason || 'Trading is not available yet.') : !engine.status?.connected ? 'Trading isn\u2019t connected yet.' : !quote ? `No live ${pair.symbol} price from the trading server.` : !engine.status.execution ? (engine.status.message || 'The trading server is not accepting orders right now.') : !engine.snapshot ? 'Loading this account from the trading server.' : '';
  const send = async () => {
    if (!review || !lots || !account || !quote || !trail.ok || !expiry.ok || !deviation.ok) return;
    // "End of today" is worked out at the moment of sending.
    const exp = type === 'market' ? { ok: true as const, value: null } : expiryValue(expiryChoice, expiryText, Date.now());
    if (!exp.ok) return;
    const entryPrice = type === 'market' ? (review === 'buy' ? quote.ask : quote.bid) : Number(entry.replace(',', '.'));
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) { setSent(''); return; }
    const p = protectionPrices(review, entryPrice, sl, tp, pair.pipSize, pair.digits);
    const ok = await engine.run(g => g.placeOrder(account.accountId, { symbol: pair.symbol, side: review, type, lots, ...(type !== 'market' ? { price: entryPrice } : {}), ...p, ...(trailPips !== null ? { trailingPips: trailPips } : {}), ...(exp.value !== null ? { expiresAt: exp.value } : {}), ...(type === 'market' && deviationPips !== null ? { expectedPrice: entryPrice, maxDeviationPips: deviationPips } : {}), ...(ocoWith ? { ocoWith } : {}), clientId: crypto.randomUUID() }));
    if (ok) { setSent(`${review === 'buy' ? 'Bought' : 'Sold'} ${lots.toFixed(2)} ${pair.symbol}${type === 'market' ? '' : ` (${type} order placed${exp.value !== null ? `, expires ${expiryAt(exp.value)}` : ''}${ocoWith ? `, linked with order ${ocoWith}: one cancels the other` : ''})`}.`); setReview(null); setOcoChoice(''); }
  };
  const field = 'w-full rounded-md border bg-background px-2.5 py-2 font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring';
  return <div className="flex flex-col gap-4 overflow-y-auto p-4" data-testid="order-ticket">
    <div className="flex items-start justify-between gap-2">
      <div><h2 className="text-sm font-semibold">New order</h2><p className="font-mono text-lg font-bold">{pair.symbol}</p></div>
      <div className="flex flex-col items-end gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${marketOpen ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>Market {marketOpen ? 'open' : 'closed'}</span>
        <ContractSpec pair={pair} status={engine.status} quotes={engine.snapshot?.quotes} market={market} now={now} />
      </div>
    </div>
    {!marketOpen && <MarketClosedNote market={market} now={now} symbol={pair.symbol} />}

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
      <TicketRiskSize pair={pair} slPips={sl} balance={balance} quotes={engine.snapshot?.quotes} roomToFloor={figuresKnown ? engine.snapshot?.metrics.roomToFloor : null} dailyLossAmount={dailyLossAmount} currentLots={lots} onUse={v => setLotsText(v.toFixed(2))} />
    </div>

    {type !== 'market' && <label className="text-xs text-muted-foreground">{type === 'limit' ? 'Limit' : 'Stop'} price
      <input inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} placeholder={`e.g. ${pair.quote === 'JPY' ? '150.250' : '1.08500'}`} className={`${field} mt-1`} /></label>}

    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-muted-foreground">Stop loss (pips)<input inputMode="decimal" value={slText} onChange={e => setSlText(e.target.value)} placeholder="Off" className={`${field} mt-1`} /></label>
      <label className="text-xs text-muted-foreground">Take profit (pips)<input inputMode="decimal" value={tpText} onChange={e => setTpText(e.target.value)} placeholder="Off" className={`${field} mt-1`} /></label>
    </div>
    <TicketTrailing pair={pair} text={trailText} onText={setTrailText} type={type} entry={entry} quote={quote} />
    {type === 'market' && <TicketDeviation pair={pair} text={deviationText} onText={setDeviationText} />}
    {type !== 'market' && <ExpiryPicker id="ticket" choice={expiryChoice} onChoice={setExpiryChoice} dateText={expiryText} onDateText={setExpiryText} now={now} />}
    {type !== 'market' && <OcoPicker id="ticket" orders={pendingOrders} value={ocoWith} onChange={setOcoChoice} draft={review && Number.isFinite(Number(entry.replace(',', '.'))) && entry ? { symbol: pair.symbol, side: review, type, price: Number(entry.replace(',', '.')) } : null} />}

    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => { setSent(''); setReview('sell'); }} disabled={!lots} className="flex flex-col items-center rounded-lg bg-red-600 py-3 font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50" data-testid="sell-button"><span className="flex items-center gap-1 text-base"><ArrowDownRight size={17} aria-hidden="true" />SELL</span><span className="font-mono text-[11px] font-normal opacity-90">{type === 'market' ? (quote ? quote.bid.toFixed(pair.digits) : 'at bid') : `${type} order`}</span></button>
      <button type="button" onClick={() => { setSent(''); setReview('buy'); }} disabled={!lots} className="flex flex-col items-center rounded-lg bg-blue-600 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50" data-testid="buy-button"><span className="flex items-center gap-1 text-base"><ArrowUpRight size={17} aria-hidden="true" />BUY</span><span className="font-mono text-[11px] font-normal opacity-90">{type === 'market' ? (quote ? quote.ask.toFixed(pair.digits) : 'at ask') : `${type} order`}</span></button>
    </div>
    <p className="-mt-2 text-center text-[11px] text-muted-foreground" data-testid="ticket-spread">{spread ? `Spread ${spread.pips.toFixed(1)} pips${spread.usdPerLot !== null ? ` · ${lots ? `${money(Math.round(spread.usdPerLot * lots * 100) / 100)} on ${lots.toFixed(2)} lots` : `${money(spread.usdPerLot)} per lot`}` : ''}` : 'Spread: from the trading server\u2019s live prices'}</p>

    {review && lots && <div role="status" className={`rounded-lg border p-3 text-sm ${review === 'buy' ? 'border-blue-500/40 bg-blue-500/5' : 'border-red-500/40 bg-red-500/5'}`} data-testid="order-review">
      <div className="flex items-start justify-between gap-2"><p className="font-semibold">{review === 'buy' ? 'Buy' : 'Sell'} {lots.toFixed(2)} {pair.symbol} {type === 'market' ? 'at market' : `${type} at ${entry || '—'}`}</p><button type="button" aria-label="Close order review" onClick={() => setReview(null)}><X size={14} /></button></div>
      <p className="mt-1 text-xs text-muted-foreground">Stop loss {sl ? `${sl} pips` : 'off'} · Take profit {tp ? `${tp} pips` : 'off'}{trailPips !== null ? ` · trailing stop ${trailPips} pips` : ''}{f.risk !== null ? ` · risk ${money(f.risk)}` : ''}{type !== 'market' && expiry.ok ? ` · ${expiry.value === null ? 'good till cancelled' : `expires ${expiryAt(expiry.value)}`}` : ''}{type === 'market' && deviationPips !== null ? ` · ${deviationPips === 0 ? 'fills only at the price shown or better' : `fills only within ${deviationPips} pips of the price shown`}` : ''}</p>
      {ocoPartner && <p className="mt-1 text-xs" data-testid="review-oco">Linked with {orderLabel(ocoPartner)}: if either fills, the other is cancelled.</p>}
      {type === 'market' && deviationPips !== null && quote && <p className="mt-1 text-xs" data-testid="review-protection">Price now {(review === 'buy' ? quote.ask : quote.bid).toFixed(pair.digits)} ({review === 'buy' ? 'ask' : 'bid'}). {review === 'buy' ? 'Highest' : 'Lowest'} fill accepted: {(review === 'buy' ? quote.ask + deviationPips * pair.pipSize : quote.bid - deviationPips * pair.pipSize).toFixed(pair.digits)}, counted from the price when you press Confirm.</p>}
      {costs.margin !== null && <p className="mt-1 text-xs" data-testid="review-costs">Margin {money(costs.margin)}{costs.freeMarginAfter !== null ? ` · free margin after ${money(costs.freeMarginAfter)}` : ''}{costs.commissionRoundTurn !== null ? ` · commission ${money(costs.commissionRoundTurn)} round turn` : ''}</p>}
      {!figuresKnown && <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300" data-testid="review-prices-missing">The trading server has no price yet for your open {gaps!.missing.join(', ')} trade{gaps!.missing.length === 1 ? '' : 's'}, so it cannot work out free margin and will refuse new orders for a moment. Try again shortly.</p>}
      {costs.notEnoughMargin && <p role="alert" className="mt-2 text-xs text-red-500" data-testid="margin-warning">Not enough free margin: this order needs {money(costs.margin!)} and the account has {money(engine.snapshot!.metrics.freeMargin)} free. The trading server will refuse it; lower the volume.</p>}
      {costs.volumeProblem && <p role="alert" className="mt-2 text-xs text-red-500" data-testid="volume-warning">{costs.volumeProblem} The trading server will refuse this volume.</p>}
      {deviation.ok === false && <p role="alert" className="mt-2 text-xs text-red-500">{deviation.error} Fix it or clear the field to send.</p>}
      {trail.ok === false && <p role="alert" className="mt-2 text-xs text-red-500">{trail.error} Fix it or clear the field to send.</p>}
      {'error' in expiry && <p role="alert" className="mt-2 text-xs text-red-500">{expiry.error} Fix it to send.</p>}
      {canSend
        ? <button type="button" disabled={engine.busy || !trail.ok || !expiry.ok || !deviation.ok} onClick={() => void send()} className={`mt-3 w-full rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${review === 'buy' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`} data-testid="confirm-order">{engine.busy ? 'Sending…' : `Confirm ${review === 'buy' ? 'buy' : 'sell'}`}</button>
        : <p className="mt-2 flex items-start gap-1.5 text-xs"><LockKeyhole size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />{holdReason} This order was not sent.</p>}
      {engine.error && <p role="alert" className="mt-2 text-xs text-red-500">{engine.error}</p>}
    </div>}
    {sent && <p role="status" className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400" data-testid="order-sent">{sent}</p>}

    <dl className="space-y-1.5 rounded-lg bg-secondary/40 p-3 text-xs">
      {([
        ['Contract size', `${(conditions?.contractSize ?? CONTRACT_SIZE).toLocaleString()} ${pair.base} / lot`],
        ['Pip size', String(pair.pipSize)],
        ['Pip value', f.pipValue !== null ? `${money(f.pipValue)} per pip${f.pipSource === 'server' ? ' at the server\u2019s price now' : ''}` : `Moves with the ${pair.quote}/USD rate`],
        ['Risk at stop loss', f.risk !== null ? `${money(f.risk)}${f.riskPercent !== null ? ` (${f.riskPercent}% of balance)` : ''}` : sl ? 'Use the lot size calculator' : 'Set a stop loss'],
        ['Profit at take profit', f.reward !== null ? money(f.reward) : tp ? 'Use the lot size calculator' : '\u2014'],
        ['Reward : risk', f.rewardRatio !== null ? `${f.rewardRatio} : 1` : '—'],
        ['Leverage', costs.leverage !== null ? `1:${costs.leverage}` : notConnected],
        ['Margin needed', costs.margin !== null ? `${money(costs.margin)}${costs.marginSource === 'server' ? ' at the server\u2019s price now' : ''}` : !conditions ? notConnected : lots ? `Needs a live ${pair.base}/USD price` : '\u2014'],
        ...(costs.freeMarginAfter !== null ? [['Free margin after', money(costs.freeMarginAfter)] as const] : []),
        ['Commission', costs.commissionRoundTurn !== null ? `${money(costs.commissionRoundTurn)} open + close (${money(conditions!.commissionPerLotPerSide)} per lot per side)` : conditions ? `${money(conditions.commissionPerLotPerSide)} per lot per side` : notConnected],
        ['Swap per night', !conditions ? notConnected : costs.swapNone ? 'None on this pair' : costs.swapBuy !== null ? `Buy ${money(costs.swapBuy)} · Sell ${money(costs.swapSell!)} (×3 ${weekdayName(costs.tripleWeekday!)})` : '\u2014'],
      ] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
    </dl>
    {f.riskShareOfDaily !== null && <p className={`text-xs ${f.riskShareOfDaily >= 100 ? 'text-red-500' : f.riskShareOfDaily >= 50 ? 'text-amber-600' : 'text-muted-foreground'}`} data-testid="daily-share">{f.riskShareOfDaily >= 100 ? `This stop would lose more than your whole daily loss allowance (${money(dailyLossAmount!)}).` : `This stop uses ${f.riskShareOfDaily}% of your ${money(dailyLossAmount!)} daily loss allowance.`}</p>}
    <Link to={sizeLink} className="text-xs underline underline-offset-2">Work out the exact lot size for {pairLabel(pair)}</Link>
    <p className="text-[11px] text-muted-foreground" data-testid="conditions-note">{conditions ? 'Leverage, commission and swap are the trading server\u2019s own settings for this pair; the server sets the fill price and checks margin and your challenge rules again before any order is accepted.' : 'When trading opens, the server sets the fill price, spread and margin and checks your challenge rules before any order is accepted. Leverage and commissions are confirmed with the broker before launch.'}</p>
  </div>;
}

function Toolbox({ engine, pair, now, tab, setTab, account, accounts, loading, rules, loadedFor, requested, onSelectAccount }: {
  engine: EngineHandle; pair: ForexPair; now: number; tab: ToolTab; setTab: (t: ToolTab) => void; account: Account | null; accounts: Account[]; loading: boolean; loadedFor: boolean; requested: string;
  rules: ReturnType<typeof rulesInDollars> | null; onSelectAccount: (id: string) => void;
}) {
  const tabs: [ToolTab, string][] = [['positions', 'Positions'], ['orders', 'Pending orders'], ['history', 'History'], ['alerts', `Alerts${engine.snapshot?.state.alerts?.length ? ` (${engine.snapshot.state.alerts.length})` : ''}`], ['account', 'Account']];
  const head = 'whitespace-nowrap px-3 py-1.5 text-left font-medium';
  return <div className="flex min-h-[240px] flex-col">
    <div className="flex overflow-x-auto border-b" role="tablist" aria-label="Terminal">
      {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-4 py-2 text-xs font-medium ${tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
    </div>
    {tab !== 'account' && tab !== 'alerts' && <EngineTables key={tab} tab={tab} engine={engine} hasAccount={!!account} />}
    {tab === 'alerts' && <AlertsPanel key={pair.symbol} engine={engine} pair={pair} now={now} />}
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
        {engine.snapshot?.report && <TargetProgress report={engine.snapshot.report} />}
        <div className="rounded-md border p-3"><p className="flex items-center gap-1.5 text-sm font-semibold"><Mail size={15} aria-hidden="true" />Account email</p><p className="mt-1 text-xs text-muted-foreground">After payment and account creation we email a secure link to this account. Sign in with your FYNX login; no trading password is emailed.</p>{account && <p role="status" className="mt-2 text-xs">{accountEmailStatus(account.accountEmailStatus)}</p>}</div>
      </div>
      {engine.snapshot && <div className="md:col-span-2"><DailyStatement accountId={engine.snapshot.state.accountId} closes={engine.snapshot.state.dayCloses} now={now} today={todayLow(engine.snapshot.state, engine.snapshot.metrics)} /></div>}
    </div>}
  </div>;
}

function MarketClosedNote({ market, now, symbol }: { market: PairMarket; now: number; symbol: string }) {
  const special = market.reason && market.reason !== 'Outside trading hours' ? market.reason : '';
  return <div className="rounded-lg border bg-secondary/40 p-3 text-xs" role="note" data-testid="market-closed">
    <p className="flex items-center gap-1.5 font-semibold"><Clock size={13} aria-hidden="true" />{special ? `${symbol} market closed · ${special}` : 'Forex market closed'}</p>
    {market.nextChange && <p className="mt-1">Opens <span className="font-medium">{localAt(market.nextChange)}</span> your time ({new Date(market.nextChange).toUTCString().slice(0, 22)} UTC) · in {untilLabel(market.nextChange - now)}.</p>}
    <p className="mt-1 text-muted-foreground">While the market is closed no order is filled, changed or closed. Pending orders and stops wait for the first price after the open; after a weekend gap that price can be beyond your level, and the order fills there.</p>
  </div>;
}

function floatingUsd(symbol: string, side: Side, lots: number, entry: number, current: number | undefined, quotes: QuoteBook): number {
  const pair = findPair(symbol);
  if (!pair || current === undefined) return NaN;
  try { return profitUsd({ contractSize: CONTRACT_SIZE, quote: pair.quote } as InstrumentSpec, side, lots, entry, current, quotes); } catch { return NaN; }
}

const time = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const px = (symbol: string, v?: number) => v === undefined ? '—' : v.toFixed(findPair(symbol)?.digits ?? 5);

function EngineTables({ tab, engine, hasAccount }: { tab: Exclude<ToolTab, 'account' | 'alerts'>; engine: EngineHandle; hasAccount: boolean }) {
  const snap = engine.snapshot, accountId = snap?.state.accountId;
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const now = useNow();
  const archive = useArchivePages(engine, accountId, snap?.state.archived?.chunks ?? 0);
  const editingOpen = !!editing && (tab === 'positions' ? !!snap?.state.positions.some(p => p.id === editing) : !!snap?.state.orders.some(o => o.id === editing));
  const head = 'whitespace-nowrap px-3 py-1.5 text-left font-medium';
  const cell = 'whitespace-nowrap px-3 py-1.5 font-mono';
  const empty = (what: string) => <p className="p-4 text-sm text-muted-foreground">{what} {!engine.status?.connected && hasAccount ? 'They will appear here once trading opens on this account.' : ''}</p>;
  const headers = tab === 'positions' ? ['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S/L', 'T/P', 'Current', 'Swap', 'Profit', '']
    : tab === 'orders' ? ['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S/L', 'T/P', 'Expires', '']
    : ['Symbol', 'Closed', 'Type', 'Volume', 'Open', 'Close', 'Commission', 'Swap', 'Profit', 'Result (R)', 'Reason'];
  const rows = tab === 'positions' ? snap?.state.positions ?? [] : tab === 'orders' ? snap?.state.orders ?? [] : [...(snap?.state.history ?? [])].reverse();
  return <div className="overflow-x-auto" role="tabpanel" data-testid={`engine-${tab}`}>
    {tab === 'positions' && snap && <BulkClose snapshot={snap} engine={engine} now={now} />}
    {tab === 'history' && snap && <StatementBar accountId={snap.state.accountId} deals={[...snap.state.history, ...archive.pages.flatMap(p => p.deals)]} archivedNotLoaded={Math.max(0, (snap.state.archived?.deals ?? 0) - archive.shown)} />}
    <table className="w-full text-xs"><thead className="bg-secondary/40 text-muted-foreground"><tr>{headers.map((h, i) => <th key={h || i} scope="col" className={head}>{h}</th>)}</tr></thead>
      <tbody>
        {tab === 'positions' && snap?.state.positions.map(p => { const q = snap.quotes[p.symbol]; const cur = q ? (p.side === 'buy' ? q.bid : q.ask) : undefined; const pr = floatingUsd(p.symbol, p.side, p.lots, p.entryPrice, cur, snap.quotes) + (p.swap ?? 0); return <Fragment key={p.id}><tr className="border-b border-border/60">
          <td className={`${cell} font-semibold`}>{p.symbol}</td><td className={cell}>{p.id}</td><td className={cell}>{time(p.openedAt)}</td><td className={`${cell} ${p.side === 'buy' ? 'text-blue-500' : 'text-red-500'}`}>{p.side}</td><td className={cell}>{p.lots.toFixed(2)}</td><td className={cell}>{px(p.symbol, p.entryPrice)}</td><td className={cell}>{px(p.symbol, p.stopLoss)}{p.trailingStop && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary" title={`Trailing stop ${p.trailingStop.pips} pips: the stop follows the price and only moves towards profit`}>trail {p.trailingStop.pips}p</span>}</td><td className={cell}>{px(p.symbol, p.takeProfit)}</td><td className={cell}>{px(p.symbol, cur)}</td><td className={cell}>{money(p.swap ?? 0)}</td>
          <td className={`${cell} ${pr < 0 ? 'text-red-500' : pr > 0 ? 'text-emerald-500' : ''}`}>{Number.isFinite(pr) ? money(pr) : '—'}</td>
          <td className="whitespace-nowrap px-3 py-1"><button type="button" aria-expanded={editing === p.id} onClick={() => { setNotice(''); setEditing(editing === p.id ? null : p.id); }} className="mr-1 rounded border px-2 py-0.5 hover:bg-secondary" aria-label={`Edit stop loss, take profit or volume of ${p.symbol} position ${p.id}`}><Pencil size={12} /></button>{(() => { const m = pairMarket(engine.status, p.symbol, now); return <button type="button" disabled={engine.busy || !m.open} title={m.open ? undefined : closedSentence(p.symbol, m, now)} onClick={() => accountId && void engine.run(g => g.closePosition(accountId, p.id))} className="rounded border px-2 py-0.5 hover:bg-secondary disabled:opacity-40" aria-label={m.open ? `Close ${p.symbol} position ${p.id}` : `Close ${p.symbol} position ${p.id} (market closed)`}><X size={12} /></button>; })()}</td>
        </tr>{editing === p.id && <tr className="border-b border-border/60"><td colSpan={headers.length} className="p-0"><PositionEditor position={p} snapshot={snap} engine={engine} hours={pairMarket(engine.status, p.symbol, now)} now={now} onDone={m => { setEditing(null); setNotice(m); }} /></td></tr>}</Fragment>; })}
        {tab === 'orders' && snap?.state.orders.map(o => <Fragment key={o.id}><tr className="border-b border-border/60">
          <td className={`${cell} font-semibold`}>{o.symbol}</td><td className={cell}>{o.id}</td><td className={cell}>{time(o.createdAt)}</td><td className={cell}>{o.side} {o.type}{o.ocoWith !== undefined && <span data-testid={`oco-${o.id}`} className="ml-1 rounded bg-amber-500/15 px-1 font-sans text-[10px] text-amber-700 dark:text-amber-400" title={`One cancels the other: linked with order ${o.ocoWith}. If either fills, the other is cancelled.`}>OCO {o.ocoWith}</span>}</td><td className={cell}>{o.lots.toFixed(2)}</td><td className={cell}>{px(o.symbol, o.price)}</td><td className={cell}>{px(o.symbol, o.stopLoss)}{o.trailingPips !== undefined && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary" title={`The position gets a ${o.trailingPips}-pip trailing stop when this order fills`}>trail {o.trailingPips}p</span>}</td><td className={cell}>{px(o.symbol, o.takeProfit)}</td><td className={`${cell} font-sans`} data-testid={`expires-${o.id}`}>{o.expiresAt === undefined ? <span className="text-muted-foreground" title="Good till cancelled">GTC</span> : <span title={expiryLabel(o.expiresAt, now)}>{time(o.expiresAt)} <span className="text-muted-foreground">{o.expiresAt > now ? `in ${untilLabel(o.expiresAt - now)}` : 'due now'}</span></span>}</td>
          <td className="whitespace-nowrap px-3 py-1"><button type="button" aria-expanded={editing === o.id} onClick={() => { setNotice(''); setEditing(editing === o.id ? null : o.id); }} className="mr-1 rounded border px-2 py-0.5 hover:bg-secondary" aria-label={`Edit price, stop loss, take profit, trailing stop or expiry of ${o.symbol} order ${o.id}`}><Pencil size={12} /></button><button type="button" disabled={engine.busy} onClick={() => accountId && void engine.run(g => g.cancelOrder(accountId, o.id))} className="rounded border px-2 py-0.5 hover:bg-secondary" aria-label={`Cancel ${o.symbol} order ${o.id}`}><X size={12} /></button></td>
        </tr>{editing === o.id && <tr className="border-b border-border/60"><td colSpan={headers.length} className="p-0"><OrderEditor order={o} snapshot={snap} engine={engine} hours={pairMarket(engine.status, o.symbol, now)} now={now} onDone={m => { setEditing(null); setNotice(m); }} /></td></tr>}</Fragment>)}
        {tab === 'history' && [...(snap?.state.history ?? [])].reverse().map(d => <DealRow key={d.id} d={d} cell={cell} />)}
      </tbody>
      {tab === 'history' && archive.pages.map(page => <tbody key={page.index} data-testid={`archive-page-${page.index}`}>
        <tr className="border-b border-border/60 bg-secondary/30"><th scope="rowgroup" colSpan={headers.length} className="px-3 py-1 text-left font-medium text-muted-foreground">Archived · {time(page.firstClosedAt)} – {time(page.lastClosedAt)} · {page.deals.length} trade{page.deals.length === 1 ? '' : 's'} · net {money(page.deals.reduce((t, d) => t + d.netProfit, 0))}</th></tr>
        {[...page.deals].reverse().map(d => <DealRow key={d.id} d={d} cell={cell} />)}
      </tbody>)}
    </table>
    {tab === 'history' && snap?.state.archived && snap.state.archived.deals > 0 && <p data-testid="history-archived" className="border-t px-4 py-2 text-xs text-muted-foreground">
      Showing the latest {snap.state.history.length} closed trade{snap.state.history.length === 1 ? '' : 's'}. {snap.state.archived.deals} older trade{snap.state.archived.deals === 1 ? '' : 's'} ({time(snap.state.archived.firstClosedAt)} – {time(snap.state.archived.lastClosedAt)}, net {money(snap.state.archived.netProfit)}) {snap.state.archived.deals === 1 ? 'is' : 'are'} kept in the account archive and still count toward your balance, best day and progress.
      <span className="mt-1.5 flex flex-wrap items-center gap-2">
        {archive.next !== null
          ? <button type="button" data-testid="archive-more" disabled={archive.loading} onClick={() => void archive.loadMore()} className="rounded border px-2 py-1 font-medium text-foreground hover:bg-secondary disabled:opacity-50">{archive.loading ? 'Loading…' : archive.pages.length ? 'Show earlier trades' : 'Show older trades'}</button>
          : <span role="status">All {snap.state.archived.deals} archived trade{snap.state.archived.deals === 1 ? '' : 's'} shown.</span>}
        {archive.pages.length > 0 && <span>{archive.shown} of {snap.state.archived.deals} archived shown</span>}
      </span>
      {archive.error && <span role="alert" className="mt-1 block text-red-500">{archive.error}</span>}
    </p>}
    {!rows.length && (tab === 'positions' ? empty('No open positions.') : tab === 'orders' ? empty('No pending orders.') : snap?.state.archived?.deals ? null : <div className="p-4 text-sm"><p className="text-muted-foreground">No closed trades on this account yet.</p><Link className="mt-2 inline-block text-sm underline" to="/dashboard/trades">Open your full trade journal</Link></div>)}
    {tab === 'orders' && !!snap?.state.expiredOrders?.length && <section data-testid="expired-orders" aria-labelledby="expired-orders-title" className="border-t px-4 py-3 text-xs">
      <h3 id="expired-orders-title" className="font-medium">Expired orders</h3>
      <p className="mt-0.5 text-muted-foreground">These pending orders reached their expiry time without filling, so the trading server cancelled them. Nothing was bought or sold and no money changed.</p>
      <ul className="mt-2 space-y-1">{snap.state.expiredOrders.slice(0, 5).map(o => <li key={o.id} className="font-mono">{o.symbol} {o.side} {o.type} {o.lots.toFixed(2)} at {px(o.symbol, o.price)} <span className="font-sans text-muted-foreground">· {o.id} · expired {expiryAt(o.expiresAt)}</span></li>)}</ul>
      {snap.state.expiredOrders.length > 5 && <p className="mt-1 text-muted-foreground">and {snap.state.expiredOrders.length - 5} earlier.</p>}
    </section>}
    {tab === 'orders' && !!snap?.state.ocoCancelled?.length && <section data-testid="oco-cancelled" aria-labelledby="oco-cancelled-title" className="border-t px-4 py-3 text-xs">
      <h3 id="oco-cancelled-title" className="font-medium">Cancelled by a linked order</h3>
      <p className="mt-0.5 text-muted-foreground">Each of these orders was linked with another order (one cancels the other). The other order filled, so the trading server cancelled this one. Nothing else was bought or sold.</p>
      <ul className="mt-2 space-y-1">{snap.state.ocoCancelled.slice(0, 5).map(o => <li key={o.id} className="font-mono">{o.symbol} {o.side} {o.type} {o.lots.toFixed(2)} at {px(o.symbol, o.price)} <span className="font-sans text-muted-foreground">· {o.id} · cancelled {time(o.cancelledAt)} when order {o.ocoWith} filled (position {o.positionId})</span></li>)}</ul>
      {snap.state.ocoCancelled.length > 5 && <p className="mt-1 text-muted-foreground">and {snap.state.ocoCancelled.length - 5} earlier.</p>}
    </section>}
    {tab === 'orders' && notice && !editingOpen && <p role="status" data-testid="order-notice" className="px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
    {tab === 'positions' && notice && !editingOpen && <p role="status" data-testid="position-notice" className="px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
    {engine.error && <p role="alert" className="px-4 pb-3 text-xs text-red-500">{engine.error}</p>}
  </div>;
}

/** Result of a closed trade in R (net ÷ dollars the entry stop loss risked); "—" without an entry stop. */
export function dealR(d: Pick<Deal, 'netProfit' | 'entryRisk'>): string {
  if (!d.entryRisk || !(d.entryRisk.amount > 0)) return '—';
  const r = Math.round((d.netProfit / d.entryRisk.amount) * 100) / 100;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}R`;
}

function DealRow({ d, cell }: { d: Deal; cell: string }) {
  return <tr className="border-b border-border/60">
    <td className={`${cell} font-semibold`}>{d.symbol}</td><td className={cell}>{time(d.closedAt)}</td><td className={cell}>{d.side}</td><td className={cell}>{d.lots.toFixed(2)}</td><td className={cell}>{px(d.symbol, d.entryPrice)}</td><td className={cell}>{px(d.symbol, d.exitPrice)}</td><td className={cell}>{money(-d.commission)}</td><td className={cell}>{money(d.swap ?? 0)}</td>
    <td className={`${cell} ${d.netProfit < 0 ? 'text-red-500' : d.netProfit > 0 ? 'text-emerald-500' : ''}`}>{money(d.netProfit)}</td><td className={cell} title={d.entryRisk ? `1R = ${money(d.entryRisk.amount)} at risk from the entry stop loss` : 'Opened without a stop loss: no R'}>{dealR(d)}</td><td className="whitespace-nowrap px-3 py-1.5">{reasonLabel(d.reason)}</td>
  </tr>;
}

/**
 * Pages through the account archive newest page first (the highest chunk
 * index), one page per click. Starts over when the account changes or the
 * server archives more trades while the list is open.
 */
function useArchivePages(engine: EngineHandle, accountId: string | undefined, chunks: number) {
  const [pages, setPages] = useState<HistoryPage[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const key = `${accountId}:${chunks}`, keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; setPages([]); setError(''); setLoading(false); }, [key]);
  const next = chunks - 1 - pages.length >= 0 ? chunks - 1 - pages.length : null;
  const loadMore = async () => {
    if (!accountId || next === null || loading) return;
    const asked = key;
    setLoading(true); setError('');
    try {
      const page = await engine.gateway.archivedDeals(accountId, next);
      if (keyRef.current === asked) setPages(p => p.some(x => x.index === page.index) ? p : [...p, page]);
    } catch (e) {
      if (keyRef.current === asked) setError(e instanceof Error ? e.message : 'Could not load older trades.');
    } finally { if (keyRef.current === asked) setLoading(false); }
  };
  return { pages, next, loading, error, loadMore, shown: pages.reduce((t, p) => t + p.deals.length, 0) };
}

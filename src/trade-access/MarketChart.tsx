import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

/** TradingView display symbols, grouped for the picker. Display only: never read into the execution engine. */
export const MARKET_GROUPS: { label: string; markets: [string, string][] }[] = [
  { label: 'Forex majors', markets: [['FX:EURUSD', 'EUR / USD'], ['FX:GBPUSD', 'GBP / USD'], ['FX:USDJPY', 'USD / JPY'], ['FX:USDCHF', 'USD / CHF'], ['FX:AUDUSD', 'AUD / USD'], ['FX:USDCAD', 'USD / CAD'], ['FX:NZDUSD', 'NZD / USD']] },
  { label: 'Forex crosses', markets: [['FX:EURGBP', 'EUR / GBP'], ['FX:EURJPY', 'EUR / JPY'], ['FX:GBPJPY', 'GBP / JPY']] },
  { label: 'Metals & energy', markets: [['OANDA:XAUUSD', 'Gold / USD'], ['OANDA:XAGUSD', 'Silver / USD'], ['TVC:USOIL', 'US crude oil']] },
  { label: 'Indices', markets: [['OANDA:SPX500USD', 'US 500'], ['OANDA:NAS100USD', 'US Tech 100'], ['OANDA:US30USD', 'US 30'], ['OANDA:DE30EUR', 'Germany 40']] },
  { label: 'Crypto', markets: [['COINBASE:BTCUSD', 'Bitcoin / USD'], ['COINBASE:ETHUSD', 'Ether / USD'], ['COINBASE:SOLUSD', 'Solana / USD']] },
];
const ALL = MARKET_GROUPS.flatMap(g => g.markets);
export const INTERVALS: [string, string][] = [['5', '5m'], ['15', '15m'], ['60', '1h'], ['240', '4h'], ['D', '1D']];
const STORE = 'fynx-trade-chart';

function saved(): { symbol: string; interval: string } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return { symbol: ALL.some(m => m[0] === v.symbol) ? v.symbol : ALL[0][0], interval: INTERVALS.some(i => i[0] === v.interval) ? v.interval : '15' };
  } catch { return { symbol: ALL[0][0], interval: '15' }; }
}

export default function MarketChart() {
  const host = useRef<HTMLDivElement>(null), { resolvedTheme } = useTheme();
  const [initial] = useState(saved);
  const [symbol, setSymbol] = useState(initial.symbol), [interval, setChartInterval] = useState(initial.interval);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(false);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ symbol, interval })); } catch { /* storage unavailable */ } }, [symbol, interval]);
  useEffect(() => {
    if (!loaded || !host.current) return;
    const container = host.current;
    setError(false);
    const chart = document.createElement('div');
    chart.className = 'tradingview-widget-container__widget'; chart.style.height = '100%'; chart.style.width = '100%';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; script.async = true;
    script.textContent = JSON.stringify({ autosize: true, symbol, interval, timezone: 'Etc/UTC', theme: resolvedTheme === 'dark' ? 'dark' : 'light', style: '1', locale: 'en', allow_symbol_change: false, hide_side_toolbar: false, calendar: false, support_host: 'https://www.tradingview.com' });
    script.onerror = () => setError(true);
    container.append(chart, script);
    return () => { script.onerror = null; container.replaceChildren(); };
  }, [symbol, interval, loaded, resolvedTheme]);
  const name = ALL.find(m => m[0] === symbol)?.[1];
  return <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Market prices">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
      <div><h2 className="font-semibold">Market watch</h2><p className="text-xs text-muted-foreground">Quotes supplied by TradingView · View only · Times in UTC</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs">Market <select aria-label="Market" className="ml-2 max-w-full rounded-md border bg-background p-2 text-sm" value={symbol} onChange={e => setSymbol(e.target.value)}>{MARKET_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.markets.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}</select></label>
        <div role="group" aria-label="Chart timeframe" className="inline-flex overflow-hidden rounded-md border">{INTERVALS.map(([id, label]) => <button key={id} type="button" aria-pressed={interval === id} onClick={() => setChartInterval(id)} className={`px-2.5 py-1.5 text-xs ${interval === id ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}>{label}</button>)}</div>
      </div>
    </div>
    {!loaded && <div className="grid min-h-[420px] place-items-center p-6 text-center"><div><p className="text-lg font-semibold">Follow the real market.</p><p className="my-3 max-w-md text-sm text-muted-foreground">Load a free TradingView chart for {name}: forex, metals, indices and crypto. TradingView receives your connection details when the chart loads.</p><button className="rounded-lg bg-primary px-5 py-3 text-primary-foreground" onClick={() => setLoaded(true)}>Load market chart</button></div></div>}
    {loaded && <div className="h-[520px] w-full"><div ref={host} className="tradingview-widget-container h-full w-full" /></div>}
    {error && <p role="alert" className="p-4 text-sm">The chart could not load. Try again or open the chart on TradingView below.</p>}
    <div className="border-t p-3 text-center text-xs text-muted-foreground"><a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer nofollow" className="underline">{name} chart</a> by TradingView. Availability and delays depend on the source. These quotes do not execute orders or change your account balance.</div>
  </section>;
}

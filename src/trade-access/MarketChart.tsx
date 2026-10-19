import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

const markets = [ ['FX:EURUSD', 'EUR / USD'], ['OANDA:XAUUSD', 'Gold / USD'], ['COINBASE:BTCUSD', 'Bitcoin / USD'], ['COINBASE:ETHUSD', 'Ether / USD'] ];
/** Official hosted display widget. Never read its prices into our execution engine. */
export default function MarketChart() {
  const host = useRef<HTMLDivElement>(null), { resolvedTheme } = useTheme();
  const [symbol, setSymbol] = useState(markets[0][0]), [loaded, setLoaded] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    if (!loaded || !host.current) return;
    const container = host.current;
    setError(false);
    const chart = document.createElement('div');
    chart.className = 'tradingview-widget-container__widget'; chart.style.height = '100%'; chart.style.width = '100%';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; script.async = true;
    script.textContent = JSON.stringify({ autosize: true, symbol, interval: '15', timezone: 'Etc/UTC', theme: resolvedTheme === 'dark' ? 'dark' : 'light', style: '1', locale: 'en', allow_symbol_change: false, hide_side_toolbar: false, calendar: false, support_host: 'https://www.tradingview.com' });
    script.onerror = () => setError(true);
    container.append(chart, script);
    return () => { script.onerror = null; container.replaceChildren(); };
  }, [symbol, loaded, resolvedTheme]);
  return <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Market prices">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-semibold">Market watch</h2><p className="text-xs text-muted-foreground">Quotes supplied by TradingView · View only</p></div><label className="text-xs">Market <select className="ml-2 max-w-full rounded-md border bg-background p-2 text-sm" value={symbol} onChange={e => setSymbol(e.target.value)}>{markets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
    {!loaded && <div className="grid min-h-[420px] place-items-center p-6 text-center"><div><p className="text-lg font-semibold">Follow the real market.</p><p className="my-3 max-w-md text-sm text-muted-foreground">Load a free TradingView chart to see market prices. TradingView receives your connection details when the chart loads.</p><button className="rounded-lg bg-primary px-5 py-3 text-primary-foreground" onClick={() => setLoaded(true)}>Load market chart</button></div></div>}
    {loaded && <div className="h-[520px] w-full"><div ref={host} className="tradingview-widget-container h-full w-full" /></div>}
    {error && <p role="alert" className="p-4 text-sm">The chart could not load. Try again or open the chart on TradingView below.</p>}
    <div className="border-t p-3 text-center text-xs text-muted-foreground"><a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer nofollow" className="underline">{markets.find(m => m[0] === symbol)?.[1]} chart</a> by TradingView. Availability and delays depend on the source. These quotes do not execute orders or change your account balance.</div>
  </section>;
}

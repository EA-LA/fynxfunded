import { useMemo, useState } from "react";
import { useTradingData } from "@/hooks/use-trading-data";
import { Search, Download, ListX, Radio, ShieldCheck, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { DEFAULT_SORT, EMPTY_FILTERS, filterTrades, hasActiveFilters, nextSort, sortTrades, summarizeTrades, type JournalFilters, type JournalSort, type SortKey } from "@/lib/tradeJournal";

const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
const selectClass = "bg-card border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30";

export default function Trades() {
  const data = useTradingData(); const { hasTrades, trades } = data;
  const [filters, setFilters] = useState<JournalFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<JournalSort>(DEFAULT_SORT);
  const setFilter = <K extends keyof JournalFilters>(key: K, value: JournalFilters[K]) => setFilters(f => ({ ...f, [key]: value }));

  const filtering = hasActiveFilters(filters);
  const filtered = useMemo(() => sortTrades(filterTrades(trades, filters), sort), [trades, filters, sort]);
  const summary = useMemo(() => summarizeTrades(filtered), [filtered]);
  const exportCsv=()=>{if(!filtered.length)return;const rows=[["Trade ID","Symbol","Side","Open","Close","Lots","P/L","Pips","Risk %","R:R","Session","Result"],...filtered.map(t=>[t.id,t.symbol,t.type,t.openTime,t.closeTime,t.lots,t.pnl,t.pips,t.riskPercent,t.rr,t.session,t.result])];const blob=new Blob([rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filtering?"fynx-trades-filtered.csv":"fynx-trades.csv";a.click();URL.revokeObjectURL(a.href)};

  const sortHeader = (k: SortKey, label: string, align: "left" | "right" = "left") => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th key={k} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-3 px-2 font-medium text-muted-foreground text-xs ${align === "right" ? "text-right" : "text-left"}`}>
        <button type="button" onClick={() => setSort(s => nextSort(s, k))} className={`inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-foreground" : ""}`}>
          {label}<Icon size={12} aria-hidden="true" />
        </button>
      </th>
    );
  };
  const th = (label: string, align: "left" | "right" | "center" = "left") => <th scope="col" className={`py-3 px-2 font-medium text-muted-foreground text-xs text-${align}`}>{label}</th>;

  if (data.loading || data.error) return <div className="space-y-4"><h1 className="text-2xl font-bold">Trades</h1><p role={data.error ? "alert" : "status"}>{data.error || "Loading account records…"}</p></div>;
  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trades</h1>
        <p className="text-sm text-muted-foreground mt-1">Recorded closed trades · {data.accountName}</p>
      </div>

      {data.loading && <p role="status">Loading trading records…</p>}{data.error && <p role="alert">{data.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Trades",filtering?`${summary.count} of ${trades.length}`:summary.count],["Net P/L",signedUsd(summary.netPnl)],["Win rate",`${summary.winRate.toFixed(1)}%`],["Volume",`${summary.volume.toFixed(2)} lots`]].map(([k,v])=><div className="premium-card" key={k}><p className="text-xs text-muted-foreground">{k}{filtering&&<span className="ml-1">· filtered</span>}</p><p className="mt-2 text-2xl font-bold">{v}</p></div>)}</div>
      {summary.count>0&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="journal-breakdown">{[["Wins / losses / breakeven",`${summary.wins} / ${summary.losses} / ${summary.breakeven}`],["Average win",summary.wins?signedUsd(summary.averageWin):"—"],["Average loss",summary.losses?signedUsd(summary.averageLoss):"—"],["Largest win / loss",`${summary.wins?signedUsd(summary.largestWin):"—"} / ${summary.losses?signedUsd(summary.largestLoss):"—"}`]].map(([k,v])=><div className="rounded-lg bg-secondary/50 px-4 py-3" key={k}><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-sm font-semibold tabular-nums">{v}</p></div>)}</div>}
      <div className="premium-card flex flex-wrap items-center gap-3"><Radio size={17}/><div className="mr-auto"><p className="text-sm font-semibold">{data.brokerConnected?"Broker feed connected":"Live broker feed unverified"}</p><p className="text-xs text-muted-foreground">Closed trades appear here automatically after the broker writes verified records.</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs">{data.brokerConnected?"Listening live":"Recorded data"}</span></div>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-xs">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                aria-label="Filter by symbol"
                placeholder="Filter by symbol..."
                value={filters.symbol}
                onChange={(e) => setFilter("symbol", e.target.value)}
                className="w-full bg-card border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 transition-shadow"
              />
            </div>
            <select aria-label="Filter by result" value={filters.result} onChange={(e) => setFilter("result", e.target.value as JournalFilters["result"])} className={selectClass}>
              <option value="">All results</option>
              <option value="Win">Wins</option>
              <option value="Loss">Losses</option>
              <option value="Breakeven">Breakeven</option>
            </select>
            <select aria-label="Filter by side" value={filters.side} onChange={(e) => setFilter("side", e.target.value as JournalFilters["side"])} className={selectClass}>
              <option value="">Buys and sells</option>
              <option value="Buy">Buys</option>
              <option value="Sell">Sells</option>
            </select>
            <select aria-label="Filter by session" value={filters.session} onChange={(e) => setFilter("session", e.target.value as JournalFilters["session"])} className={selectClass}>
              <option value="">All sessions</option>
              <option value="Asia">Asia</option>
              <option value="London">London</option>
              <option value="New York">New York</option>
            </select>
            {filtering && <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"><X size={14} aria-hidden="true" />Clear filters</button>}
            <button disabled={!filtered.length} onClick={exportCsv} className="ml-auto inline-flex items-center gap-2 bg-secondary text-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-40">
              <Download size={14} />
              {filtering ? "Export filtered CSV" : "Export CSV"}
            </button>
          </div>

          {/* Table */}
          <div className="premium-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {th("Trade ID")}
                  {sortHeader("symbol", "Symbol")}
                  {th("Type")}
                  {th("Open")}
                  {sortHeader("closeTime", "Close")}
                  {sortHeader("lots", "Lots", "right")}
                  {sortHeader("pips", "Pips", "right")}
                  {sortHeader("pnl", "P/L", "right")}
                  {th("Duration", "center")}
                  {sortHeader("riskPercent", "Risk %", "right")}
                  {sortHeader("rr", "R:R", "right")}
                  {th("Session", "center")}
                  {th("Result", "center")}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-secondary/50 transition-colors">
                    <td className="py-3 px-2 text-xs text-muted-foreground font-mono">{t.id}</td>
                    <td className="py-3 px-2 font-medium">{t.symbol}</td>
                    <td className="py-3 px-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${t.type === "Buy" ? "bg-secondary" : "bg-secondary text-muted-foreground"}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-muted-foreground text-xs">{t.openTime}</td>
                    <td className="py-3 px-2 text-muted-foreground text-xs">{t.closeTime}</td>
                    <td className="py-3 px-2 text-right">{t.lots}</td>
                    <td className={`py-3 px-2 text-right ${t.pips >= 0 ? "" : "text-muted-foreground"}`}>{t.pips >= 0 ? "+" : ""}{t.pips}</td>
                    <td className={`py-3 px-2 text-right font-medium ${t.pnl >= 0 ? "" : "text-muted-foreground"}`}>
                      {signedUsd(t.pnl)}
                    </td>
                    <td className="py-3 px-2 text-center text-xs text-muted-foreground">{t.duration}</td>
                    <td className="py-3 px-2 text-right text-xs">{t.riskPercent.toFixed(1)}%</td>
                    <td className="py-3 px-2 text-right text-xs">{t.rr.toFixed(1)}</td>
                    <td className="py-3 px-2 text-center text-xs text-muted-foreground">{t.session}</td>
                    <td className="py-3 px-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${t.result === "Win" ? "bg-secondary" : "bg-secondary text-muted-foreground"}`}>
                        {t.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-14 text-center"><ListX className="mx-auto text-muted-foreground"/><p className="mt-3 text-sm font-semibold">{hasTrades?"No trades match these filters":"No closed trades yet"}</p>{hasTrades&&filtering&&<button type="button" onClick={()=>setFilters(EMPTY_FILTERS)} className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">Clear filters</button>}<p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">The journal is ready. It will show ticket, instrument, side, timestamps, volume, P/L, pips, risk, R:R and market session from the connected broker.</p></div>
            )}
          </div>
      {!hasTrades&&<div className="grid gap-4 md:grid-cols-3">{[[ShieldCheck,"Verified records","Only server-side broker imports can create official trade records."],[Radio,"Automatic sync","New closed trades update this page and analytics in real time."],[Download,"Portable journal","Export the filtered journal to CSV whenever records are available."]].map(([Icon,t,d]:any)=><div className="premium-card" key={t}><Icon size={19}/><p className="mt-3 font-semibold">{t}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></div>)}</div>}
    </div>
  );
}

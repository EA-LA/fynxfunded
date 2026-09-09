import { useState } from "react";
import { useTradingData } from "@/hooks/use-trading-data";
import { Search, Download, ListX, Radio, ShieldCheck } from "lucide-react";

export default function Trades() {
  const data = useTradingData(); const { hasTrades, trades } = data;
  const [symbolFilter, setSymbolFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<"" | "Win" | "Loss">("");

  const filtered = trades.filter((t) => {
    if (symbolFilter && !t.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false;
    if (resultFilter && t.result !== resultFilter) return false;
    return true;
  });
  const total=trades.reduce((s,t)=>s+t.pnl,0),wins=trades.filter(t=>t.pnl>=0).length,lots=trades.reduce((s,t)=>s+t.lots,0);
  const exportCsv=()=>{if(!filtered.length)return;const rows=[["Trade ID","Symbol","Side","Open","Close","Lots","P/L","Pips","Risk %","R:R","Session"],...filtered.map(t=>[t.id,t.symbol,t.type,t.openTime,t.closeTime,t.lots,t.pnl,t.pips,t.riskPercent,t.rr,t.session])];const blob=new Blob([rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="fynx-trades.csv";a.click();URL.revokeObjectURL(a.href)};

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trades</h1>
        <p className="text-sm text-muted-foreground mt-1">Full trade history for your active account.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Trades",trades.length],["Net P/L",`${total>=0?"+":""}$${total.toFixed(2)}`],["Win rate",`${trades.length?(wins/trades.length*100).toFixed(1):"0.0"}%`],["Volume",`${lots.toFixed(2)} lots`]].map(([k,v])=><div className="premium-card" key={k}><p className="text-xs text-muted-foreground">{k}</p><p className="mt-2 text-2xl font-bold">{v}</p></div>)}</div>
      <div className="premium-card flex flex-wrap items-center gap-3"><Radio size={17}/><div className="mr-auto"><p className="text-sm font-semibold">{data.brokerConnected?"Broker feed connected":"Broker feed not connected"}</p><p className="text-xs text-muted-foreground">Closed trades appear here automatically after the broker writes verified records.</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs">{data.brokerConnected?"Listening live":"Waiting for setup"}</span></div>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter by symbol..."
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="w-full bg-card border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 transition-shadow"
              />
            </div>
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value as "" | "Win" | "Loss")}
              className="bg-card border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 appearance-none"
            >
              <option value="">All Results</option>
              <option value="Win">Wins</option>
              <option value="Loss">Losses</option>
            </select>
            <button disabled={!filtered.length} onClick={exportCsv} className="ml-auto inline-flex items-center gap-2 bg-secondary text-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-40">
              <Download size={14} />
              Export CSV
            </button>
          </div>

          {/* Table */}
          <div className="premium-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground text-xs">Trade ID</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground text-xs">Symbol</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground text-xs">Type</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground text-xs">Open</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground text-xs">Close</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground text-xs">Lots</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground text-xs">Pips</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground text-xs">P/L</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground text-xs">Duration</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground text-xs">Risk %</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground text-xs">R:R</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground text-xs">Session</th>
                  <th className="text-center py-3 px-2 font-medium text-muted-foreground text-xs">Result</th>
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
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
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
              <div className="py-14 text-center"><ListX className="mx-auto text-muted-foreground"/><p className="mt-3 text-sm font-semibold">{hasTrades?"No trades match this filter":"No closed trades yet"}</p><p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">The journal is ready. It will show ticket, instrument, side, timestamps, volume, P/L, pips, risk, R:R and market session from the connected broker.</p></div>
            )}
          </div>
      {!hasTrades&&<div className="grid gap-4 md:grid-cols-3">{[[ShieldCheck,"Verified records","Only server-side broker imports can create official trade records."],[Radio,"Automatic sync","New closed trades update this page and analytics in real time."],[Download,"Portable journal","Export the filtered journal to CSV whenever records are available."]].map(([Icon,t,d]:any)=><div className="premium-card" key={t}><Icon size={19}/><p className="mt-3 font-semibold">{t}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></div>)}</div>}
    </div>
  );
}

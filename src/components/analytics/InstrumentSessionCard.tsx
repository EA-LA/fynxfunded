import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Grid3X3 } from "lucide-react";
import type { Trade } from "@/lib/tradingData";
import {
  BREAKDOWN_SESSIONS, MIN_TRADES_FOR_HIGHLIGHT, breakdownHighlights, instrumentBreakdown, sessionTotals,
  type BreakdownSort, type CellStats,
} from "@/lib/instrumentBreakdown";

const money = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const tone = (v: number) => (v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground");
const ROWS_COLLAPSED = 8;
const SORTS: Array<[BreakdownSort, string]> = [["pnl", "Net P/L"], ["count", "Most traded"], ["winRate", "Win rate"], ["symbol", "A–Z"]];

function Cell({ c }: { c: CellStats }) {
  if (!c.count) return <td className="p-2 text-center text-xs text-muted-foreground">—</td>;
  return (
    <td className="p-2 text-right tabular-nums">
      <span className={`block font-semibold ${tone(c.pnl)}`}>{money(c.pnl)}</span>
      <span className="block text-[11px] text-muted-foreground">{plural(c.count, "trade")} · {c.winRate.toFixed(0)}% won</span>
    </td>
  );
}

/** Closed P/L per instrument, split by the journal's Asia / London / New York labels. */
export default function InstrumentSessionCard({ trades }: { trades: Trade[] }) {
  const [sort, setSort] = useState<BreakdownSort>("pnl");
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => instrumentBreakdown(trades, sort), [trades, sort]);
  const totals = useMemo(() => sessionTotals(rows), [rows]);
  const { strongest, weakest } = useMemo(() => breakdownHighlights(rows), [rows]);
  const visible = showAll ? rows : rows.slice(0, ROWS_COLLAPSED);
  const total = rows.reduce((s, r) => s + r.pnl, 0);
  const count = rows.reduce((s, r) => s + r.count, 0);

  return (
    <section className="premium-card" aria-labelledby="instrument-session-title" data-testid="instrument-session">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="instrument-session-title" className="flex items-center gap-2 font-semibold"><Grid3X3 size={16} aria-hidden="true" />Instruments by session</h3>
          <p className="mt-1 text-xs text-muted-foreground">Closed P/L for each instrument, split by the session label of the hour the trade was opened (UTC)</p>
        </div>
        {rows.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort by
            <select value={sort} onChange={e => setSort(e.target.value as BreakdownSort)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Each instrument you trade will get a row here, split by session, once closed trades are recorded in this period.</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="instrument-highlights">
            <div className="rounded-lg bg-secondary/50 p-4">
              <p className="text-xs text-muted-foreground">Strongest combination</p>
              {strongest
                ? <p className="mt-1 text-sm"><b>{strongest.symbol} · {strongest.session}</b> <span className={tone(strongest.stats.pnl)}>{money(strongest.stats.pnl)}</span> <span className="text-muted-foreground">over {plural(strongest.stats.count, "trade")}</span></p>
                : <p className="mt-1 text-sm text-muted-foreground">Needs a profitable combination with at least {MIN_TRADES_FOR_HIGHLIGHT} trades</p>}
            </div>
            <div className="rounded-lg bg-secondary/50 p-4">
              <p className="text-xs text-muted-foreground">Weakest combination</p>
              {weakest
                ? <p className="mt-1 text-sm"><b>{weakest.symbol} · {weakest.session}</b> <span className={tone(weakest.stats.pnl)}>{money(weakest.stats.pnl)}</span> <span className="text-muted-foreground">over {plural(weakest.stats.count, "trade")}</span></p>
                : <p className="mt-1 text-sm text-muted-foreground">No losing combination with at least {MIN_TRADES_FOR_HIGHLIGHT} trades</p>}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Closed profit and loss by instrument and session</caption>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="p-2 text-left font-medium">Instrument</th>
                  <th scope="col" className="p-2 text-right font-medium">Trades</th>
                  <th scope="col" className="p-2 text-right font-medium">Net P/L</th>
                  <th scope="col" className="p-2 text-right font-medium">Avg / trade</th>
                  {BREAKDOWN_SESSIONS.map(s => <th scope="col" key={s} className="p-2 text-right font-medium">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr key={r.symbol} className="border-b border-border/50">
                    <th scope="row" className="p-2 text-left font-medium">
                      {r.symbol}
                      <span className="block text-[11px] font-normal text-muted-foreground">{r.longs} buy · {r.shorts} sell · best {money(r.best)} · worst {money(r.worst)}</span>
                    </th>
                    <td className="p-2 text-right tabular-nums">{r.count}<span className="block text-[11px] text-muted-foreground">{r.winRate.toFixed(0)}% won</span></td>
                    <td className={`p-2 text-right font-semibold tabular-nums ${tone(r.pnl)}`}>{money(r.pnl)}</td>
                    <td className={`p-2 text-right tabular-nums ${tone(r.average)}`}>{money(r.average)}</td>
                    {BREAKDOWN_SESSIONS.map(s => <Cell key={s} c={r.sessions[s]} />)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-xs">
                  <th scope="row" className="p-2 text-left font-semibold">All instruments</th>
                  <td className="p-2 text-right tabular-nums">{count}</td>
                  <td className={`p-2 text-right font-semibold tabular-nums ${tone(total)}`}>{money(total)}</td>
                  <td className="p-2" />
                  {BREAKDOWN_SESSIONS.map(s => <Cell key={s} c={totals[s]} />)}
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.length > ROWS_COLLAPSED && (
            <button type="button" onClick={() => setShowAll(v => !v)} aria-expanded={showAll} className="mt-3 text-xs font-medium underline underline-offset-4">
              {showAll ? "Show fewer instruments" : `Show all ${rows.length} instruments`}
            </button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Session labels are the dashboard's own UTC hour groups (Asia 00–08, London 08–13, New York 13–24), not broker trading hours. <Link to="/rules#trading-day" className="underline underline-offset-2">See them in your time</Link>. Small samples can mislead; a combination is only called out after {MIN_TRADES_FOR_HIGHLIGHT} trades.
          </p>
        </>
      )}
    </section>
  );
}

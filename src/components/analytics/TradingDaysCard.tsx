import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays } from "lucide-react";
import type { Trade } from "@/lib/tradingData";
import { CONSISTENCY_LIMIT_PERCENT } from "@/lib/ruleCalculator";
import { pnlByTradingDay, summarizeTradingDays, type TradingDayResult } from "@/lib/tradeTiming";

const money = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
const CHART_DAYS = 30;
const dayLabel = (d: TradingDayResult) => new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Closed P/L per trading day (22:00 UTC to 22:00 UTC, the daily loss window). */
export default function TradingDaysCard({ trades }: { trades: Trade[] }) {
  const days = useMemo(() => pnlByTradingDay(trades), [trades]);
  const summary = useMemo(() => summarizeTradingDays(days), [days]);
  const chart = days.slice(-CHART_DAYS).map(d => ({ ...d, label: dayLabel(d) }));
  const share = summary.consistency.sharePercent;

  return (
    <section className="premium-card" aria-labelledby="trading-days-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="trading-days-title" className="flex items-center gap-2 font-semibold"><CalendarDays size={16} aria-hidden="true" />P/L by trading day</h3>
          <p className="mt-1 text-xs text-muted-foreground">Each trading day runs 22:00–22:00 UTC, the same window as the daily loss limit · trades count on the day they closed</p>
        </div>
        <Link to="/rules#trading-day" className="text-xs font-medium underline underline-offset-4 hover:text-foreground">How the trading day works</Link>
      </div>

      {days.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Day-by-day results will appear here once closed trades are recorded in this period.</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="trading-day-stats">
            {[
              ["Trading days", `${summary.days}`, `${summary.greenDays} up · ${summary.redDays} down · ${summary.flatDays} flat`],
              ["Average day", money(summary.averageDay), "Net closed P/L per trading day"],
              ["Best day", summary.bestDay ? money(summary.bestDay.pnl) : "—", summary.bestDay ? `${dayLabel(summary.bestDay)} · ${summary.bestDay.count} trade${summary.bestDay.count === 1 ? "" : "s"}` : "No profitable day yet"],
              ["Worst day", summary.worstDay ? money(summary.worstDay.pnl) : "—", summary.worstDay ? `${dayLabel(summary.worstDay)} · ${summary.worstDay.count} trade${summary.worstDay.count === 1 ? "" : "s"}` : "No losing day yet"],
            ].map(([k, v, d]) => (
              <div key={k} className="rounded-lg bg-secondary/50 px-4 py-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-lg font-bold">{v}</p><p className="text-xs text-muted-foreground">{d}</p></div>
            ))}
          </div>

          <div className="mt-5 h-56" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -12, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                <XAxis dataKey="label" fontSize={10} minTickGap={12} />
                <YAxis fontSize={10} />
                <Tooltip formatter={(v: number) => [money(v), "Day P/L"]} />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {chart.map(d => <Cell key={d.start} fill={d.pnl >= 0 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"} fillOpacity={d.pnl >= 0 ? 0.8 : 0.45} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {days.length > CHART_DAYS && <p className="mt-2 text-xs text-muted-foreground">Chart shows the last {CHART_DAYS} of {days.length} trading days.</p>}

          <div className="mt-4 rounded-lg border px-4 py-3" data-testid="consistency-estimate">
            <p className="text-xs text-muted-foreground">Best day as a share of total profit (the {CONSISTENCY_LIMIT_PERCENT}% consistency check)</p>
            <p className="mt-1 text-sm font-semibold">
              {share === null
                ? "Not applicable: closed P/L in this period is not positive"
                : `${share.toFixed(1)}% · ${share <= CONSISTENCY_LIMIT_PERCENT ? `within ${CONSISTENCY_LIMIT_PERCENT}%` : `above ${CONSISTENCY_LIMIT_PERCENT}%: total profit would need to reach $${summary.consistency.profitNeededForBestDay.toFixed(2)} for this best day to fit`}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Estimate from closed trades in the selected period only. Your official status is on <Link to="/dashboard/objectives" className="underline underline-offset-4">Objectives</Link>.</p>
          </div>

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Show every trading day ({days.length})</summary>
            <table className="mt-3 w-full text-xs">
              <caption className="sr-only">Closed P/L by trading day</caption>
              <thead><tr className="border-b text-left text-muted-foreground"><th scope="col" className="py-2">Trading day</th><th scope="col" className="py-2 text-right">Trades</th><th scope="col" className="py-2 text-right">Net P/L</th></tr></thead>
              <tbody className="divide-y">
                {days.slice().reverse().map(d => <tr key={d.start}><th scope="row" className="py-2 text-left font-medium">{dayLabel(d)}</th><td className="py-2 text-right">{d.count}</td><td className="py-2 text-right font-semibold">{money(d.pnl)}</td></tr>)}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

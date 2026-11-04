import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock } from "lucide-react";
import type { Trade } from "@/lib/tradingData";
import { MIN_SAMPLE, performanceByHour, performanceByWeekday, timeZoneLabel, timingHighlights, type TimeZoneMode, type TimingBucket } from "@/lib/tradeTiming";
import TimeZoneToggle from "./TimeZoneToggle";

const money = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
type View = "weekday" | "hour";

/** "When you trade best": closed P/L by weekday or hour of day, in local time or UTC. */
export default function TradeTimingCard({ trades, mode, onModeChange }: { trades: Trade[]; mode: TimeZoneMode; onModeChange: (m: TimeZoneMode) => void }) {
  const [view, setView] = useState<View>("weekday");
  const buckets = useMemo(() => view === "weekday" ? performanceByWeekday(trades, mode) : performanceByHour(trades, mode), [trades, mode, view]);
  const highlights = timingHighlights(buckets);
  const zone = timeZoneLabel(mode);
  const unit = view === "weekday" ? "day" : "hour";
  const used = buckets.filter(b => b.count > 0);
  const describe = (b: TimingBucket) => `${view === "hour" ? `${b.label}–${String((b.key + 1) % 24).padStart(2, "0")}:00` : b.label}: ${money(b.pnl)} over ${b.count} trade${b.count === 1 ? "" : "s"} (${b.winRate.toFixed(0)}% won)`;

  return (
    <section className="premium-card" aria-labelledby="timing-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="timing-title" className="flex items-center gap-2 font-semibold"><Clock size={16} aria-hidden="true" />When you trade best</h3>
          <p className="mt-1 text-xs text-muted-foreground">Closed P/L grouped by when each trade was opened · times in {zone}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border p-1" role="group" aria-label="Group trades by">
            {([["weekday", "By weekday"], ["hour", "By hour"]] as const).map(([v, text]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-xs ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{text}</button>
            ))}
          </div>
          <TimeZoneToggle mode={mode} onChange={onModeChange} />
        </div>
      </div>

      {used.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Your results by {unit} will appear here once closed trades are recorded in this period.</p>
      ) : (
        <>
          <div className="mt-5 h-56" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ left: -12, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                <XAxis dataKey="label" fontSize={10} interval={view === "hour" ? 2 : 0} tickFormatter={(v: string) => view === "hour" ? v.slice(0, 2) : v} />
                <YAxis fontSize={10} />
                <Tooltip formatter={(v: number) => [money(v), "Net P/L"]} labelFormatter={(l: string) => `${l} (${zone})`} />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {buckets.map(b => <Cell key={b.key} fill={b.pnl >= 0 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"} fillOpacity={b.pnl >= 0 ? 0.8 : 0.45} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="timing-highlights">
            <div className="rounded-lg bg-secondary/50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Strongest {unit}</p>
              <p className="mt-1 text-sm font-semibold">{highlights.best ? describe(highlights.best) : highlights.smallSample ? "Not enough trades yet" : `No profitable ${unit} with ${MIN_SAMPLE}+ trades`}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Weakest {unit}</p>
              <p className="mt-1 text-sm font-semibold">{highlights.worst ? describe(highlights.worst) : highlights.smallSample ? "Not enough trades yet" : `No losing ${unit} with ${MIN_SAMPLE}+ trades`}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A {unit} is only called out once it has at least {MIN_SAMPLE} trades. Small samples can mislead: use this to review your habits, not as a forecast.
          </p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Show the numbers ({used.length} {unit}{used.length === 1 ? "" : "s"} with trades)</summary>
            <table className="mt-3 w-full text-xs">
              <caption className="sr-only">Closed P/L by {unit} in {zone}</caption>
              <thead><tr className="border-b text-left text-muted-foreground"><th scope="col" className="py-2">{view === "weekday" ? "Day" : "Hour"}</th><th scope="col" className="py-2 text-right">Trades</th><th scope="col" className="py-2 text-right">Won</th><th scope="col" className="py-2 text-right">Net P/L</th></tr></thead>
              <tbody className="divide-y">
                {used.map(b => <tr key={b.key}><th scope="row" className="py-2 text-left font-medium">{b.label}</th><td className="py-2 text-right">{b.count}</td><td className="py-2 text-right">{b.winRate.toFixed(0)}%</td><td className="py-2 text-right font-semibold">{money(b.pnl)}</td></tr>)}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

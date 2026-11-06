import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { CONSISTENCY_LIMIT_PERCENT, type RulePlan } from "@/lib/ruleCalculator";
import type { ReplayDay, ReplayResult } from "@/lib/recordReplay";
import GlossaryTip from "@/components/GlossaryTip";

const usd = (n: number) => {
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const cents = Number.isInteger(abs) ? 0 : 2;
  return `${n < 0 && abs > 0 ? "-" : ""}${abs.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents, maximumFractionDigits: cents })}`;
};
const signed = (n: number) => (n > 0 ? `+${usd(n)}` : usd(n));
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** "Mon, Oct 5, 2026" for a trading day's YYYY-MM-DD date. */
export const dayDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayName = (d: ReplayDay) => (d.date ? `${dayDate(d.date)} (trading day ${d.index})` : `trading day ${d.index}`);

const ROWS_SHOWN = 30;

const eventNote = (d: ReplayDay) =>
  d.event === "phasePassed"
    ? `Phase ${d.phase} passed`
    : d.event === "dailyBreach"
      ? "Daily loss limit broken"
      : d.event === "maxBreach"
        ? "Maximum loss limit broken"
        : d.event === "targetWaiting"
          ? "Target reached, other conditions not yet met"
          : "";

/**
 * The result of a day-by-day replay: verdict, key figures, balance chart and a
 * row per trading day. Shared by the Rules page replay (pasted records) and the
 * dashboard replay (the trader's own journal).
 */
export default function ReplayResultView({ result, plan, recordLabel = "This record" }: { result: ReplayResult; plan: RulePlan; recordLabel?: string }) {
  const accountSize = plan.accountSize;
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [result]);
  const phaseLabel = result.phases.length > 1 ? `all ${result.phases.length} phases` : `phase ${result.phases[0]}`;
  const days = result?.days ?? [];
  const visibleDays = showAll ? days : days.slice(0, ROWS_SHOWN);
  const multiPhase = result ? result.phases.length > 1 : false;

  // Balance chart: closing balance per trading day against the target and floors.
  const chart = useMemo(() => {
    if (!result || !result.days.length) return null;
    const W = 600;
    const H = 200;
    const pad = 6;
    const target = (p: number) => plan.phases[p - 1].targetBalance;
    const values = result.days.flatMap((d) => [d.startBalance, d.endBalance, d.lowBalance, d.floor, target(d.phase)]);
    const lo = Math.min(...values, plan.maxLossFloor);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const n = result.days.length;
    const x = (i: number) => pad + (i / n) * (W - 2 * pad);
    const y = (v: number) => pad + (1 - (v - lo) / span) * (H - 2 * pad);
    const step = (get: (d: ReplayDay) => number) =>
      result.days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(d)).toFixed(1)} L${x(i + 1).toFixed(1)},${y(get(d)).toFixed(1)}`).join(" ");
    const balance = result.days
      .map((d, i) => `${i === 0 ? `M${x(0).toFixed(1)},${y(d.startBalance).toFixed(1)} ` : d.startBalance !== result.days[i - 1].endBalance ? `M${x(i).toFixed(1)},${y(d.startBalance).toFixed(1)} ` : ""}L${x(i + 1).toFixed(1)},${y(d.endBalance).toFixed(1)}`)
      .join(" ");
    const markers = result.days.filter((d) => d.event && d.event !== "targetWaiting").map((d) => ({ cx: x(d.index), cy: y(d.endBalance), event: d.event }));
    return { W, H, floor: step((d) => d.floor), target: step((d) => target(d.phase)), maxFloor: y(plan.maxLossFloor), balance, markers, lo, hi };
  }, [result, plan]);

  const verdict = (() => {
    if (!result || !result.finalDay) return null;
    const last = result.finalDay;
    if (result.outcome === "passed") {
      const passes = result.days.filter((d) => d.event === "phasePassed");
      return {
        tone: "border-emerald-500/50 bg-emerald-500/10",
        title: `${recordLabel} would have passed ${phaseLabel}`,
        lines: passes.map((d) => `Phase ${d.phase} passed at the close of ${dayName(d)}, after ${plural(d.phaseDay, "trading day")} in that phase, with ${usd(d.endBalance - accountSize)} profit.`),
      };
    }
    if (result.outcome === "dailyBreach" || result.outcome === "maxBreach") {
      const daily = result.outcome === "dailyBreach";
      const allowance = Math.round((last.startBalance - last.floor) * 100) / 100;
      return {
        tone: "border-red-500/50 bg-red-500/10",
        title: `The ${daily ? "daily loss" : "maximum loss"} limit would have been broken on ${dayName(last)}`,
        lines: [
          `${result.phasesPassed ? `After passing ${plural(result.phasesPassed, "phase")}, phase ${last.phase}: ` : ""}The day started at ${usd(last.startBalance)} and its lowest allowed balance was ${usd(last.floor)} (${last.binding === "daily" ? `the daily limit, ${usd(allowance)} below the start` : "the static maximum-loss floor, which was higher than the daily limit that day"}). After trade ${last.trades} of the day the closed balance was ${usd(last.endBalance)}, ${usd(Math.abs(last.roomAtLow))} below it.`,
          result.tradesTotal > result.tradesUsed ? `The other ${plural(result.tradesTotal - result.tradesUsed, "result")} in your record came after the breach and were not replayed.` : "",
        ].filter(Boolean),
      };
    }
    const p = result.progress!;
    const needs: string[] = [];
    if (p.profit < p.targetProfit) needs.push(`${usd(p.targetProfit - p.profit)} more profit (${usd(p.profit)} of the ${usd(p.targetProfit)} target)`);
    if (p.tradingDays < p.minDays) needs.push(`${plural(p.minDays - p.tradingDays, "more trading day")} (${p.tradingDays} of the ${p.minDays} minimum)`);
    if (p.consistency.totalProfit > 0 && !p.consistency.passes)
      needs.push(`a smaller best-day share: the best day is ${p.consistency.sharePercent}% of profit, the limit is ${CONSISTENCY_LIMIT_PERCENT}%, so total profit needs to reach ${usd(p.consistency.profitNeededForBestDay)}`);
    return {
      tone: "border-border bg-secondary/40",
      title: `Not passed yet: the record ran out during phase ${p.phase}`,
      lines: [
        `${result.phasesPassed ? `${plural(result.phasesPassed, "phase")} passed first. ` : ""}After ${plural(p.tradingDays, "trading day")} in phase ${p.phase} the account stood at ${usd(accountSize + p.profit)}, with no loss limit broken.`,
        needs.length ? `Still needed: ${needs.join("; ")}.` : "",
      ].filter(Boolean),
    };
  })();

  if (!verdict) return null;
  return (
    <div className="mt-6 space-y-6">
      <div className={`rounded-md border p-4 ${verdict.tone}`} data-testid="replay-verdict">
        <h3 className="flex items-start gap-2 text-base font-semibold">
          {result.outcome === "passed" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" /> : result.outcome === "unfinished" ? null : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />}
          {verdict.title}
        </h3>
        {verdict.lines.map((line) => (
          <p key={line} className="mt-2 text-sm">{line}</p>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Trading days replayed</dt>
          <dd className="text-xl font-bold tabular-nums">{result.days.length}</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Trades used</dt>
          <dd className="text-xl font-bold tabular-nums">{result.tradesUsed} <span className="text-sm font-normal text-muted-foreground">of {result.tradesTotal}</span></dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Balance at the end</dt>
          <dd className="text-xl font-bold tabular-nums">{usd(result.finalDay!.endBalance)}</dd>
          {multiPhase && <dd className="text-xs text-muted-foreground">phase {result.finalDay!.phase}{result.finalDay!.event === "phasePassed" ? ", before the reset" : ""}</dd>}
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Closest call <GlossaryTip term="breach" /></dt>
          <dd className="text-xl font-bold tabular-nums" data-testid="replay-closest">{result.closestCall ? usd(result.closestCall.roomAtLow) : "—"}</dd>
          {result.closestCall && <dd className="text-xs text-muted-foreground">above the floor, {result.closestCall.date ? dayDate(result.closestCall.date) : `day ${result.closestCall.index}`}</dd>}
        </div>
      </dl>

      {chart && (
        <figure>
          <figcaption className="text-sm font-medium">Closing balance per trading day</figcaption>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="mt-2 h-48 w-full rounded-md border border-border bg-background" preserveAspectRatio="none" aria-hidden="true">
            <path d={chart.target} fill="none" stroke="rgb(16 185 129)" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            <path d={chart.floor} fill="none" stroke="rgb(245 158 11)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={chart.W} y1={chart.maxFloor} y2={chart.maxFloor} stroke="rgb(239 68 68)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={chart.balance} fill="none" stroke="currentColor" className="text-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {chart.markers.map((m) => (
              <circle key={`${m.cx}-${m.event}`} cx={m.cx} cy={m.cy} r="4" fill={m.event === "phasePassed" ? "rgb(16 185 129)" : "rgb(239 68 68)"} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-primary" aria-hidden="true" />Closing balance</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed border-emerald-500" aria-hidden="true" />Profit target</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dotted border-amber-500" aria-hidden="true" />That day's lowest allowed balance</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-red-500" aria-hidden="true" />Maximum-loss floor</span>
            <span className="tabular-nums">Range {usd(chart.lo)} – {usd(chart.hi)}</span>
          </div>
        </figure>
      )}

      <div>
        <h3 className="text-sm font-semibold">Every trading day</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm tabular-nums" data-testid="replay-days">
            <caption className="sr-only">Replay of your record by trading day</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-2">Trading day</th>
                {multiPhase && <th scope="col" className="p-2">Phase</th>}
                <th scope="col" className="p-2">Trades</th>
                <th scope="col" className="p-2">Day result</th>
                <th scope="col" className="p-2">Closing balance</th>
                <th scope="col" className="p-2">Lowest allowed</th>
                <th scope="col" className="p-2">Room at the day's low</th>
                <th scope="col" className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {visibleDays.map((d) => (
                <tr key={d.index} className={`border-t border-border ${d.event === "dailyBreach" || d.event === "maxBreach" ? "bg-red-500/10" : d.event === "phasePassed" ? "bg-emerald-500/10" : ""}`}>
                  <th scope="row" className="p-2 font-normal whitespace-nowrap">{d.date ? dayDate(d.date) : `Day ${d.index}`}</th>
                  {multiPhase && <td className="p-2">{d.phase} · day {d.phaseDay}</td>}
                  <td className="p-2">{d.trades}</td>
                  <td className={`p-2 ${d.pnl < 0 ? "text-destructive" : ""}`}>{signed(d.pnl)}</td>
                  <td className="p-2">{usd(d.endBalance)}</td>
                  <td className="p-2">{usd(d.floor)}<span className="block text-xs text-muted-foreground">{d.binding === "daily" ? "daily limit" : "maximum loss"}</span></td>
                  <td className={`p-2 ${d.roomAtLow < 0 ? "text-destructive font-medium" : ""}`}>{usd(d.roomAtLow)}</td>
                  <td className="p-2 text-xs">{eventNote(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {days.length > ROWS_SHOWN && (
          <button type="button" className="mt-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? `Show the first ${ROWS_SHOWN} days` : `Show all ${days.length} trading days`}
          </button>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CalendarDays, Download } from 'lucide-react';
import type { DayClose } from '@/engine/types';
import { dailyStatementCsv, dailyStatementFileName, dailySummary, dayChange, dayEndsAt, dayLabel, sortedDays } from './daily-statement';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const tone = (n: number) => n < 0 ? 'text-red-500' : n > 0 ? 'text-emerald-500' : '';
const local = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const SHOWN = 10;

/**
 * Account tab "Daily statement": one row per trading day the engine closed
 * (balance at the start and end, closing equity, trades, room above the loss
 * limits, positions held overnight, swap), totals and a CSV download.
 */
export default function DailyStatement({ accountId, closes, now, resetHourUtc = 22, compact = false }: { accountId: string; closes: readonly DayClose[] | undefined; now: number; resetHourUtc?: number; compact?: boolean }) {
  const [all, setAll] = useState(false);
  const days = sortedDays(closes);
  const s = dailySummary(closes);
  const nextReset = (() => { const d = new Date(now); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), resetHourUtc); return t > now ? t : t + 86_400_000; })();
  const download = () => {
    const blob = new Blob([dailyStatementCsv(accountId, closes, resetHourUtc)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = dailyStatementFileName(accountId, Date.now());
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  };
  const limit = compact ? 5 : SHOWN;
  const shown = all ? days : days.slice(0, limit);
  return <section className="rounded-md border p-3" aria-labelledby={`daily-${accountId}`} data-testid="daily-statement">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`daily-${accountId}`} className="flex items-center gap-1.5 text-sm font-semibold"><CalendarDays size={15} aria-hidden="true" />{compact ? 'Recent trading days' : 'Daily statement'}</h3>
      {days.length > 0 && !compact && <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium hover:bg-secondary" data-testid="daily-download"><Download size={12} aria-hidden="true" />Download daily statement (CSV)</button>}
    </div>
    {!days.length ? <p className="mt-2 text-xs text-muted-foreground" data-testid="daily-empty">The trading server writes one record when each trading day ends at {String(resetHourUtc).padStart(2, '0')}:00 UTC. The first one appears after the next reset ({local(nextReset)} your time).</p> : <>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" data-testid="daily-summary">
        <div><dt className="text-muted-foreground">Days recorded</dt><dd className="font-mono font-medium">{s.days} · {s.up} up, {s.down} down{s.flat ? `, ${s.flat} flat` : ''}</dd></div>
        <div><dt className="text-muted-foreground">Net change</dt><dd className={`font-mono font-medium ${tone(s.net)}`}>{signed(s.net)}</dd></div>
        <div><dt className="text-muted-foreground">Best / worst day</dt><dd className="font-mono font-medium">{s.best ? <span className="text-emerald-500">{signed(s.best.change)}</span> : '—'} / {s.worst ? <span className="text-red-500">{signed(s.worst.change)}</span> : '—'}</dd></div>
        <div><dt className="text-muted-foreground">Closest to a limit at a close</dt><dd className="font-mono font-medium">{s.closestCall ? `${money(s.closestCall.room)} on ${dayLabel(s.closestCall.day)}` : '—'}</dd></div>
      </dl>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <caption className="sr-only">One row per trading day, newest first</caption>
          <thead className="text-muted-foreground"><tr>{['Day', 'Start balance', 'Closing balance', 'Change', 'Closing equity', 'Trades', 'Room at close', 'Held overnight', 'Swap'].map(h => <th key={h} scope="col" className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{shown.map(d => { const c = dayChange(d); return <tr key={d.tradingDay} className="border-t" data-testid="daily-row">
            <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{dayLabel(d.tradingDay)}{d.late && <span title="Recorded after the reset because the trading server was not running then" className="ml-0.5 text-muted-foreground">*</span>}{d.status !== 'active' && <span className="ml-1 rounded bg-secondary px-1 text-[10px] uppercase">{d.status}</span>}</th>
            <td className="px-2 py-1.5 font-mono">{money(d.startBalance)}</td>
            <td className="px-2 py-1.5 font-mono">{money(d.closingBalance)}</td>
            <td className={`px-2 py-1.5 font-mono ${tone(c)}`}>{signed(c)}</td>
            <td className="px-2 py-1.5 font-mono">{d.closingEquity === null ? 'No price' : money(d.closingEquity)}</td>
            <td className="px-2 py-1.5 font-mono">{d.trades}</td>
            <td className="px-2 py-1.5 font-mono">{d.roomAtClose === null ? '—' : money(d.roomAtClose)}</td>
            <td className="px-2 py-1.5 font-mono">{d.openPositions ? `${d.openPositions} · ${d.openLots.toFixed(2)} lots` : 'None'}</td>
            <td className={`px-2 py-1.5 font-mono ${tone(d.swapAtRollover)}`}>{d.swapAtRollover ? signed(d.swapAtRollover) : '—'}</td>
          </tr>; })}</tbody>
        </table>
      </div>
      {days.length > limit && <button type="button" onClick={() => setAll(v => !v)} className="mt-2 text-xs underline" aria-expanded={all}>{all ? `Show the latest ${limit}` : `Show all ${days.length} days`}</button>}
      <p className="mt-2 text-xs text-muted-foreground">Each day runs {String(resetHourUtc).padStart(2, '0')}:00–{String(resetHourUtc).padStart(2, '0')}:00 UTC (the daily loss limit's day) and ends {local(dayEndsAt(days[0].tradingDay, resetHourUtc))} your time for the latest one. "Room at close" is equity above the higher of the daily and maximum loss levels when the day ended. Swap is what the overnight rollover charged or paid on trades held through it.{s.late ? ' * Recorded after the reset because the trading server was not running at that moment: balances are exact, equity is from that later check.' : ''}</p>
    </>}
  </section>;
}

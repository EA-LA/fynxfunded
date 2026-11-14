import { Target } from 'lucide-react';
import type { TargetReport } from '@/engine/types';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/** Target, minimum days and 40% best-day progress from the engine (shown only when the engine sends a report). */
export default function TargetProgress({ report }: { report: TargetReport }) {
  const share = report.bestDayShare;
  const pct = report.targetProfit ? Math.max(0, Math.min(100, (report.profit / report.targetProfit) * 100)) : 0;
  const rows: [string, string, boolean | null][] = [
    ['Profit target', report.targetProfit === null ? 'None (funded account)' : `${money(report.profit)} of ${money(report.targetProfit)}${report.profitToGo ? ` · ${money(report.profitToGo)} to go` : ''}`, report.targetProfit === null ? null : report.targetMet],
    ['Trading days', `${report.tradingDays} of ${report.minTradingDays}`, report.daysMet],
    ['Best day', report.consistencyLimit === null ? 'No best-day rule' : report.bestDay && share !== null ? `${money(report.bestDay.profit)} on ${report.bestDay.day} · ${share.toFixed(1)}% of profit (limit ${report.consistencyLimit}%)` : `Limit ${report.consistencyLimit}% of total profit`, report.consistencyLimit === null ? null : report.consistencyMet],
    ['Open positions', String(report.openPositions), report.openPositions === 0],
  ];
  return <div className="rounded-md border p-3" data-testid="target-progress">
    <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Target size={15} aria-hidden="true" />Progress on this account</h3>
    {report.targetProfit !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Profit target progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>}
    <dl className="mt-2 space-y-1.5 text-xs">{rows.map(([k, v, ok]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}{ok !== null && <span className={`ml-1.5 ${ok ? 'text-emerald-500' : 'text-muted-foreground'}`}>{ok ? '✓' : '·'}</span>}</dd></div>)}</dl>
    <p className="mt-2 text-xs" role="status">{report.ready ? 'Every condition is met. The result goes to the official review; it is not a pass until confirmed.' : report.missing.length ? `Still needed: ${report.missing.join(' ')}` : ''}</p>
  </div>;
}

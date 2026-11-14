import { Download } from 'lucide-react';
import type { Deal } from '@/engine/types';
import { statementCsv, statementFileName, statementSummary } from './statement';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Totals for the closed trades on screen in the History tab and a CSV
 * statement of the same trades. Older archived trades are included once they
 * have been loaded with "Show older trades".
 */
export default function StatementBar({ accountId, deals, archivedNotLoaded }: { accountId: string; deals: readonly Deal[]; archivedNotLoaded: number }) {
  if (!deals.length) return null;
  const s = statementSummary(deals);
  const download = () => {
    const blob = new Blob([statementCsv(accountId, deals)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = statementFileName(accountId, Date.now());
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  };
  const tone = (n: number) => n < 0 ? 'text-red-500' : n > 0 ? 'text-emerald-500' : '';
  const items: [string, string, string?][] = [
    ['Trades', `${s.trades} · ${s.wins} won, ${s.losses} lost`],
    ['Win rate', s.winRate === null ? '—' : `${s.winRate}%`],
    ['Gross profit', money(s.grossProfit), tone(s.grossProfit)],
    ['Gross loss', money(s.grossLoss), tone(s.grossLoss)],
    ['Commission', money(-s.commission)],
    ['Swap', money(s.swap)],
    ['Profit factor', s.profitFactor === null ? (s.wins ? 'No losses yet' : '—') : s.profitFactor.toFixed(2)],
    ['Net result', money(s.net), tone(s.net)],
  ];
  return <section aria-label="Statement for the trades shown" data-testid="history-statement" className="border-b px-3 py-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted-foreground">Totals for the {s.trades} closed trade{s.trades === 1 ? '' : 's'} shown{s.firstClosedAt !== null && s.lastClosedAt !== null ? ` (${day(s.firstClosedAt)} – ${day(s.lastClosedAt)})` : ''}{archivedNotLoaded > 0 ? `. ${archivedNotLoaded} older archived trade${archivedNotLoaded === 1 ? ' is' : 's are'} not included until loaded below.` : '.'}</p>
      <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 font-medium hover:bg-secondary" data-testid="statement-download"><Download size={12} aria-hidden="true" />Download statement (CSV)</button>
    </div>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4 lg:grid-cols-8">
      {items.map(([k, v, c]) => <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className={`font-mono font-medium ${c ?? ''}`}>{v}</dd></div>)}
    </dl>
  </section>;
}

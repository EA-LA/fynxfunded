import { useMemo, useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import { JOURNAL_KEPT, type JournalKind } from '@/engine/journal';
import type { EngineHandle } from './useEngine';
import { filterJournal, journalCounts, journalCsv, journalFileName, journalSymbols, JOURNAL_FILTERS, KIND_LABELS, readJournal, type JournalFilter } from './journal';

const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const TONE: Record<JournalKind, string> = {
  order: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  trade: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  change: 'bg-secondary text-foreground',
  cancel: 'bg-secondary text-muted-foreground',
  refused: 'bg-red-500/10 text-red-600 dark:text-red-400',
  rule: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  alert: 'bg-primary/10 text-primary',
  account: 'bg-secondary text-muted-foreground',
};
const SHOWN = 50;

/**
 * "Journal" tab of the terminal: what the trading server did on this account,
 * in plain words and newest first — orders, fills, closes with the reason and
 * result, stop changes, refusals with the reason, loss-limit locks, day resets
 * and alerts. The server writes it in the same save as the change itself, so
 * it is also there for things that happened with the terminal closed.
 */
export default function JournalPanel({ engine, hasAccount }: { engine: EngineHandle; hasAccount: boolean }) {
  const snap = engine.snapshot;
  const entries = useMemo(() => readJournal(snap?.state.journal), [snap?.state.journal]);
  const [filter, setFilter] = useState<JournalFilter>('all');
  const [symbol, setSymbol] = useState('');
  const [more, setMore] = useState(false);
  const symbols = useMemo(() => journalSymbols(entries), [entries]);
  const pair = symbols.includes(symbol) ? symbol : '';
  const counts = journalCounts(entries, pair);
  const shown = filterJournal(entries, filter, pair);
  const visible = more ? shown : shown.slice(0, SHOWN);
  const accountId = snap?.state.accountId ?? '';
  const download = () => {
    const blob = new Blob([journalCsv(accountId, shown)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = journalFileName(accountId, Date.now());
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!snap) return <div role="tabpanel" data-testid="engine-journal" className="p-4 text-sm text-muted-foreground">
    <p className="flex items-center gap-1.5 font-medium text-foreground"><ScrollText size={15} aria-hidden="true" />Account journal</p>
    <p className="mt-1">Everything the trading server does on your account is listed here in plain words: orders, fills, closes with the reason and result, stop changes, orders it refused and why, and loss-limit locks.{hasAccount && !engine.status?.connected ? ' It fills in once trading opens on this account.' : ''}</p>
  </div>;

  return <div role="tabpanel" data-testid="engine-journal" className="text-xs">
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
        {JOURNAL_FILTERS.map(f => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setMore(false); }} data-testid={`journal-filter-${f.id}`}
          className={`rounded-full border px-2.5 py-1 font-medium ${filter === f.id ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{f.label} <span className="font-mono">{counts[f.id]}</span></button>)}
      </div>
      {symbols.length > 1 && <label className="flex items-center gap-1 text-muted-foreground">Pair
        <select value={pair} onChange={e => { setSymbol(e.target.value); setMore(false); }} className="rounded border bg-background px-1.5 py-1 font-mono text-foreground" data-testid="journal-pair">
          <option value="">All</option>{symbols.map(s => <option key={s} value={s}>{s}</option>)}
        </select></label>}
      {shown.length > 0 && <button type="button" onClick={download} className="ml-auto inline-flex items-center gap-1.5 rounded border px-2 py-1 font-medium hover:bg-secondary" data-testid="journal-download"><Download size={12} aria-hidden="true" />Download (CSV)</button>}
    </div>
    {!entries.length && <p className="p-4 text-sm text-muted-foreground" data-testid="journal-empty">Nothing recorded yet. Orders, fills, closes, refusals with their reason and rule events will be listed here as they happen, including while this page is closed.</p>}
    {entries.length > 0 && !shown.length && <p className="p-4 text-sm text-muted-foreground" data-testid="journal-none">Nothing of this type{pair ? ` on ${pair}` : ''} in the journal.</p>}
    {visible.length > 0 && <ol className="divide-y divide-border/60" data-testid="journal-list">
      {visible.map((e, i) => <li key={`${e.at}-${i}`} className="flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-start sm:gap-3">
        <time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'} className="shrink-0 whitespace-nowrap font-mono text-muted-foreground sm:w-40">{when(e.at)}</time>
        <span className={`w-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONE[e.kind]}`}>{KIND_LABELS[e.kind]}</span>
        <span className="min-w-0 break-words">{e.text}</span>
      </li>)}
    </ol>}
    {shown.length > SHOWN && <p className="border-t px-4 py-2 text-muted-foreground">{more ? `All ${shown.length} entries shown.` : <>Showing the newest {SHOWN} of {shown.length}. <button type="button" className="underline" onClick={() => setMore(true)} data-testid="journal-more">Show all</button></>}</p>}
    <p className="border-t px-4 py-2 text-muted-foreground">Times in your local time (hover for UTC). The trading server keeps the newest {JOURNAL_KEPT} entries; closed trades stay in History and your statement.</p>
  </div>;
}

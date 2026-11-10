import { useState } from 'react';
import { BellRing, Trash2 } from 'lucide-react';
import type { AlertCondition } from '@/engine/types';
import type { EngineHandle } from './useEngine';
import { FOREX_PAIRS, findPair, type ForexPair } from './instruments';
import { ALERT_NOTE_MAX, byDistance, conditionLabel, firedSentence, pipsAway, readAlertDraft, suggestedCondition } from './alerts';

const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * "Alerts" tab of the terminal: set a price alert on any of the 45 pairs, see
 * waiting alerts with how far the bid is, delete them, and read the ones that
 * fired. The trading server keeps and checks them, so they work with this page
 * closed; an alert never opens, changes or closes a trade.
 */
export default function AlertsPanel({ engine, pair: selected, now }: { engine: EngineHandle; pair: ForexPair; now: number }) {
  const [symbol, setSymbol] = useState(selected.symbol);
  const pair = findPair(symbol) ?? selected;
  const [condition, setCondition] = useState<AlertCondition>('above');
  const [priceText, setPriceText] = useState(''), [noteText, setNoteText] = useState('');
  const [message, setMessage] = useState('');
  const snap = engine.snapshot, connected = !!engine.status?.connected && !!snap;
  const quote = snap?.quotes[pair.symbol];
  const bid = quote && now - quote.time <= 60_000 ? quote.bid : undefined;
  const draft = readAlertDraft(pair, condition, priceText, noteText, quote, now);
  const typed = Number(priceText.trim().replace(',', '.'));
  const hint = suggestedCondition(typed, bid);
  const away = 'price' in draft ? pipsAway(pair, draft.price, bid) : null;
  const alerts = snap?.state.alerts ?? [], fired = snap?.state.triggeredAlerts ?? [];
  const bidOf = (s: string) => { const q = snap?.quotes[s]; return q && now - q.time <= 60_000 ? q.bid : undefined; };
  const sorted = byDistance(alerts, findPair, bidOf);

  const create = async () => {
    if (!('price' in draft) || !snap) return;
    setMessage('');
    const ok = await engine.run(g => g.addAlert(snap.state.accountId, { symbol: pair.symbol, condition, price: draft.price, ...(draft.note ? { note: draft.note } : {}) }));
    if (ok) { setMessage(`Alert set: ${pair.symbol} ${conditionLabel(condition).toLowerCase()} ${draft.price.toFixed(pair.digits)}.`); setPriceText(''); setNoteText(''); }
  };
  const remove = (id: string) => { if (snap) void engine.run(g => g.removeAlert(snap.state.accountId, id)).then(ok => ok && setMessage('Alert deleted.')); };

  const input = 'mt-1 w-full min-w-0 rounded-md border bg-background p-2 text-sm';
  return <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" role="tabpanel" data-testid="engine-alerts">
    <form className="space-y-2 text-sm" aria-label="New price alert" onSubmit={e => { e.preventDefault(); void create(); }}>
      <h3 className="flex items-center gap-1.5 font-semibold"><BellRing size={15} aria-hidden="true" />New price alert</h3>
      <p className="text-xs text-muted-foreground">The trading server watches the bid for you, also with this page closed. An alert only tells you; it never opens or closes a trade.</p>
      <label className="block text-xs text-muted-foreground">Pair
        <select value={pair.symbol} onChange={e => { setSymbol(e.target.value); setPriceText(''); setMessage(''); }} className={`${input} font-mono text-foreground`} data-testid="alert-symbol">
          {FOREX_PAIRS.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="Alert when">
        {(['above', 'below'] as const).map(c => <button key={c} type="button" aria-pressed={condition === c} onClick={() => setCondition(c)} className={`rounded-md border px-2 py-1.5 text-xs ${condition === c ? 'border-primary bg-primary/10 font-semibold' : 'hover:bg-secondary'}`}>{conditionLabel(c)}</button>)}
      </div>
      <label className="block text-xs text-muted-foreground">Price level
        <input inputMode="decimal" value={priceText} onChange={e => setPriceText(e.target.value)} placeholder={bid !== undefined ? bid.toFixed(pair.digits) : `e.g. ${(1).toFixed(pair.digits)}`} className={`${input} font-mono text-foreground`} data-testid="alert-price" />
      </label>
      <p className="text-xs text-muted-foreground" data-testid="alert-bid">{bid !== undefined
        ? <>Bid now <span className="font-mono">{bid.toFixed(pair.digits)}</span>{away !== null && <> · {away} pips away</>}</>
        : connected ? 'No live price for this pair right now; the alert waits for the next price.' : 'The bid shows here once trading is connected.'}</p>
      {hint && hint !== condition && <p className="text-xs"><button type="button" className="text-left underline" onClick={() => setCondition(hint)}>This level is {hint} the bid: alert when the bid goes {hint}</button></p>}
      <label className="block text-xs text-muted-foreground">Note (optional)
        <input value={noteText} maxLength={ALERT_NOTE_MAX + 20} onChange={e => setNoteText(e.target.value)} placeholder="e.g. Retest of last week's high" className={`${input} text-foreground`} data-testid="alert-note" />
      </label>
      {'message' in draft && priceText.trim() !== '' && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400" data-testid="alert-problem">{draft.message}</p>}
      <button type="submit" disabled={!connected || !draft.ok || engine.busy} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="alert-create">{engine.busy ? 'Saving…' : 'Create alert'}</button>
      {!connected && <p className="text-xs text-muted-foreground" data-testid="alert-offline">Price alerts start working once the trading server is connected. Nothing is saved before that.</p>}
      {engine.error && <p role="alert" className="text-xs text-red-600">{engine.error}</p>}
      {message && !engine.error && <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="alert-message">{message}</p>}
    </form>

    <div className="min-w-0 space-y-4">
      <section aria-labelledby="alerts-waiting">
        <h3 id="alerts-waiting" className="text-sm font-semibold">Waiting ({alerts.length})</h3>
        {sorted.length ? <div className="mt-2 overflow-x-auto"><table className="w-full text-xs" data-testid="alerts-table">
          <thead className="text-muted-foreground"><tr>{['Pair', 'Alert when', 'Level', 'Bid now', 'Distance', 'Set', 'Note', ''].map(h => <th key={h} className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{sorted.map(a => { const p = findPair(a.symbol), d = p?.digits ?? 5, b = bidOf(a.symbol), dist = p ? pipsAway(p, a.price, b) : null; return <tr key={a.id} className="border-t border-border/60">
            <td className="px-2 py-1.5 font-mono font-semibold">{a.symbol}</td>
            <td className="whitespace-nowrap px-2 py-1.5">{conditionLabel(a.condition)}</td>
            <td className="px-2 py-1.5 font-mono">{a.price.toFixed(d)}</td>
            <td className="px-2 py-1.5 font-mono">{b !== undefined ? b.toFixed(d) : '—'}</td>
            <td className="whitespace-nowrap px-2 py-1.5">{dist !== null ? `${dist} pips` : '—'}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{when(a.createdAt)}</td>
            <td className="max-w-[180px] truncate px-2 py-1.5 text-muted-foreground" title={a.note}>{a.note || ''}</td>
            <td className="px-2 py-1.5"><button type="button" disabled={engine.busy} aria-label={`Delete alert ${a.symbol} ${a.condition} ${a.price.toFixed(d)}`} onClick={() => remove(a.id)} className="grid h-6 w-6 place-items-center rounded hover:bg-secondary disabled:opacity-40"><Trash2 size={13} /></button></td>
          </tr>; })}</tbody>
        </table></div> : <p className="mt-1 text-xs text-muted-foreground">{connected ? 'No alerts waiting. Set one on the left.' : 'Your alerts appear here once trading is connected.'}</p>}
      </section>
      {fired.length > 0 && <section aria-labelledby="alerts-fired" data-testid="alerts-fired">
        <h3 id="alerts-fired" className="text-sm font-semibold">Fired</h3>
        <ul className="mt-1 space-y-1 text-xs">{fired.map(a => <li key={a.id}><span className="font-mono">{firedSentence(a, findPair(a.symbol)?.digits ?? 5)}</span> <span className="text-muted-foreground">· {when(a.triggeredAt)}{a.note ? ` · ${a.note}` : ''}</span></li>)}</ul>
        <p className="mt-1 text-[11px] text-muted-foreground">Each alert fires once. The newest 20 are kept here.</p>
      </section>}
    </div>
  </div>;
}

import { useMemo, useState } from 'react';
import type { Position } from '@/engine/types';
import type { Snapshot } from '@/engine/venue';
import { findPair } from './instruments';
import { closeSidePrice, levelErrors, levelOutcome, parseCloseLots, parseLevel, parseTrailing, protectionChange, trailingPreview } from './protection';
import type { EngineHandle } from './useEngine';
import { closedSentence, type PairMarket } from './market-hours';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const signedPips = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} pips`;

/**
 * Change the stop loss / take profit of an open position, or close part of it.
 * Shows the dollar result at each level and how a stop compares with the room
 * left before the account's loss limit, and switch a trailing stop on or off.
 * The engine validates again on send.
 */
export default function PositionEditor({ position: p, snapshot, engine, onDone, hours, now = Date.now() }: { position: Position; snapshot: Snapshot; engine: EngineHandle; onDone: (message: string) => void; hours?: PairMarket; now?: number }) {
  const closed = !!hours && !hours.open;
  const pair = findPair(p.symbol);
  const digits = pair?.digits ?? 5;
  const [slText, setSl] = useState(p.stopLoss === undefined ? '' : p.stopLoss.toFixed(digits));
  const [tpText, setTp] = useState(p.takeProfit === undefined ? '' : p.takeProfit.toFixed(digits));
  const [trailText, setTrail] = useState(p.trailingStop ? String(p.trailingStop.pips) : '');
  const [closeText, setCloseText] = useState('');
  const [closeError, setCloseError] = useState('');
  const quote = snapshot.quotes[p.symbol];
  const closing = quote ? closeSidePrice(p.side, quote) : undefined;
  const sl = parseLevel(slText, digits, 'Stop loss'), tp = parseLevel(tpText, digits, 'Take profit');
  const slValue = sl.ok ? sl.value : null, tpValue = tp.ok ? tp.value : null;
  const trail = parseTrailing(trailText);
  const trailValue = trail.ok ? trail.value : null;
  const errors = [...('error' in sl ? [sl.error] : []), ...('error' in tp ? [tp.error] : []), ...('error' in trail ? [trail.error] : []), ...(sl.ok && tp.ok ? levelErrors(p.side, closing, slValue, tpValue, digits) : [])];
  const change: { stopLoss?: number | null; takeProfit?: number | null; trailingPips?: number | null } = sl.ok && tp.ok && trail.ok ? protectionChange(p, { stopLoss: slValue, takeProfit: tpValue }) : {};
  if (sl.ok && tp.ok && trail.ok && (p.trailingStop?.pips ?? null) !== trailValue) change.trailingPips = trailValue;
  const preview = pair && trailValue !== null ? trailingPreview(pair, p.side, p.entryPrice, closing, trailValue, slValue) : null;
  const changed = Object.keys(change).length > 0;

  const outcome = (level: number | null) => (pair && level !== null ? levelOutcome(pair, p.side, p.lots, p.entryPrice, level, snapshot.quotes) : null);
  const atStop = outcome(slValue), atTarget = outcome(tpValue);
  const floating = useMemo(() => (pair && closing !== undefined ? levelOutcome(pair, p.side, p.lots, p.entryPrice, closing, snapshot.quotes).dollars : null), [pair, closing, p, snapshot.quotes]);
  const moreLoss = atStop?.dollars !== null && atStop?.dollars !== undefined && floating !== null ? Math.max(0, floating - atStop.dollars) : null;
  const room = snapshot.metrics.roomToFloor;
  const canBreakEven = closing !== undefined && (p.side === 'buy' ? closing > p.entryPrice : closing < p.entryPrice);
  const id = `edit-${p.id}`;

  const save = async () => {
    if (errors.length || !changed || closed) return;
    const ok = await engine.run(g => g.modifyPosition(snapshot.state.accountId, p.id, change));
    if (ok) onDone(`${p.symbol} ${p.id}: stop loss ${slValue === null ? 'removed' : slValue.toFixed(digits)}, take profit ${tpValue === null ? 'removed' : tpValue.toFixed(digits)}, trailing stop ${trailValue === null ? 'off' : `${trailValue} pips`}.`);
  };
  const closePart = async () => {
    if (closed) return;
    const lots = parseCloseLots(closeText, p.lots);
    if ('error' in lots) { setCloseError(lots.error); return; }
    setCloseError('');
    const ok = await engine.run(g => g.closePosition(snapshot.state.accountId, p.id, lots.value));
    if (ok) onDone(`Closed ${lots.value.toFixed(2)} of ${p.lots.toFixed(2)} lots ${p.symbol}; ${(Math.round((p.lots - lots.value) * 100) / 100).toFixed(2)} lots stay open.`);
  };

  const input = 'mt-1 w-full min-w-0 rounded-md border bg-background px-2 py-1.5 font-mono text-sm';
  return <form data-testid="position-editor" aria-label={`Edit ${p.symbol} position ${p.id}`} className="sticky left-0 grid max-w-[100vw] gap-3 bg-secondary/30 p-3 text-xs md:grid-cols-[1fr_1fr_auto]" onSubmit={e => { e.preventDefault(); void save(); }}>
    <div>
      <label htmlFor={`${id}-sl`} className="text-muted-foreground">Stop loss (price)</label>
      <input id={`${id}-sl`} inputMode="decimal" value={slText} onChange={e => setSl(e.target.value)} placeholder="None" className={input} />
      <p className="mt-1 min-h-4 text-muted-foreground" data-testid="sl-outcome">{atStop ? <>If hit: <span className={atStop.dollars !== null && atStop.dollars < 0 ? 'text-red-500' : 'text-emerald-500'}>{atStop.dollars === null ? '—' : money(atStop.dollars)}</span> ({signedPips(atStop.pips)}) before commission</> : 'No stop: the loss is limited only by the account rules.'}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {canBreakEven && <button type="button" onClick={() => setSl(p.entryPrice.toFixed(digits))} className="rounded border px-2 py-0.5 hover:bg-secondary">Stop to break-even ({p.entryPrice.toFixed(digits)})</button>}
        {slText && <button type="button" onClick={() => setSl('')} className="rounded border px-2 py-0.5 hover:bg-secondary">Remove stop</button>}
      </div>
    </div>
    <div>
      <label htmlFor={`${id}-tp`} className="text-muted-foreground">Take profit (price)</label>
      <input id={`${id}-tp`} inputMode="decimal" value={tpText} onChange={e => setTp(e.target.value)} placeholder="None" className={input} />
      <p className="mt-1 min-h-4 text-muted-foreground" data-testid="tp-outcome">{atTarget ? <>If hit: <span className={atTarget.dollars !== null && atTarget.dollars < 0 ? 'text-red-500' : 'text-emerald-500'}>{atTarget.dollars === null ? '—' : money(atTarget.dollars)}</span> ({signedPips(atTarget.pips)}) before commission</> : 'No target set.'}</p>
      {tpText && <button type="button" onClick={() => setTp('')} className="mt-1 rounded border px-2 py-0.5 hover:bg-secondary">Remove target</button>}
    </div>
    <div className="md:col-span-2">
      <label htmlFor={`${id}-trail`} className="block text-muted-foreground">Trailing stop (pips)</label>
      <input id={`${id}-trail`} inputMode="decimal" value={trailText} onChange={e => setTrail(e.target.value)} placeholder="Off" aria-describedby={`${id}-trail-note`} className={`${input} md:max-w-[12rem]`} />
      <p id={`${id}-trail-note`} className="mt-1 min-h-4 text-muted-foreground" data-testid="trailing-outcome">{preview
        ? preview.started
          ? <>Started: the stop follows {trailValue} pips behind the {p.side === 'buy' ? 'bid' : 'ask'} and only moves towards profit.{preview.movesTo !== null ? <> After saving it moves to <span className="font-mono text-foreground">{preview.movesTo.toFixed(digits)}</span> on the next price.</> : ' It moves again once the price gains at least one more pip.'}</>
          : <>Starts when the {p.side === 'buy' ? 'bid' : 'ask'} reaches <span className="font-mono text-foreground">{preview.startsAt.toFixed(digits)}</span> ({trailValue} pips in profit), with the stop at break-even; then it follows the price {trailValue} pips behind and never moves back. Until then the stop loss above applies.</>
        : 'Off. With a distance, the trading server moves your stop loss behind the price as it gains, even with this page closed.'}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {[10, 20, 50].map(n => <button key={n} type="button" onClick={() => setTrail(String(n))} className="rounded border px-2 py-0.5 hover:bg-secondary" aria-pressed={trailValue === n}>{n} pips</button>)}
        {trailText && <button type="button" onClick={() => setTrail('')} className="rounded border px-2 py-0.5 hover:bg-secondary">Trailing off</button>}
      </div>
    </div>
    <div className="flex flex-col gap-2 md:col-start-3 md:row-start-1 md:row-span-2 md:w-48">
      <button type="submit" disabled={engine.busy || closed || !changed || errors.length > 0} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save levels</button>
      <div className="flex gap-1">
        <label htmlFor={`${id}-lots`} className="sr-only">Lots to close</label>
        <input id={`${id}-lots`} inputMode="decimal" value={closeText} onChange={e => setCloseText(e.target.value)} placeholder="Lots" className="w-full min-w-0 rounded-md border bg-background px-2 py-1 font-mono" />
        <button type="button" disabled={engine.busy || closed || p.lots <= 0.01} onClick={() => void closePart()} className="shrink-0 rounded-md border px-2 py-1 hover:bg-secondary disabled:opacity-50">Close part</button>
      </div>
      <button type="button" onClick={() => onDone('')} className="rounded-md border px-3 py-1 hover:bg-secondary">Cancel</button>
    </div>
    <div className="space-y-1 md:col-span-3" aria-live="polite">
      {closed && hours && <p data-testid="editor-market-closed" role="note" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-foreground">{closedSentence(p.symbol, hours, now)} You can prepare new levels now; saving and closing unlock when the market opens. Until then this position keeps its current stop loss, take profit and trailing stop.</p>}
      <p className="text-muted-foreground">Current {p.side === 'buy' ? 'bid' : 'ask'} (closing price): <span className="font-mono">{closing === undefined ? 'no price' : closing.toFixed(digits)}</span> · entry <span className="font-mono">{p.entryPrice.toFixed(digits)}</span> · {p.lots.toFixed(2)} lots</p>
      {moreLoss !== null && moreLoss > 0 && <p data-testid="stop-vs-room" className={moreLoss > room ? 'text-red-500' : 'text-muted-foreground'}>From here the stop would cost up to {money(moreLoss)} more; room before the loss limit is {money(room)}.{moreLoss > room ? ' This stop is beyond the loss limit: the account would be stopped out first.' : ''}</p>}
      {errors.map(e => <p key={e} role="alert" className="text-red-500">{e}</p>)}
      {closeError && <p role="alert" className="text-red-500">{closeError}</p>}
    </div>
  </form>;
}

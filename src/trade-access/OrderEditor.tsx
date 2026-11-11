import { useState } from 'react';
import type { PendingOrder } from '@/engine/types';
import type { Snapshot } from '@/engine/venue';
import { findPair } from './instruments';
import { levelOutcome, openSidePrice, orderChange, parseLevel, parseTrailing, pendingErrors, pipsAway, trailingPreview } from './protection';
import type { EngineHandle } from './useEngine';
import { closedSentence, type PairMarket } from './market-hours';
import ExpiryPicker from './ExpiryPicker';
import OcoPicker from './OcoPicker';
import { chosenLink, linkChange } from './oco';
import { choiceFor, expiryAt, expiryValue, toLocalInput, type ExpiryChoice } from './expiry';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/**
 * Change the price, stop loss, take profit, trailing stop or expiry of a
 * pending order. Shows how far the order sits from the market, the dollar result at
 * each level if the order fills at its price, and where a trailing stop would
 * start after the fill. The engine validates again on send.
 */
export default function OrderEditor({ order: o, snapshot, engine, onDone, hours, now = Date.now() }: { order: PendingOrder; snapshot: Snapshot; engine: EngineHandle; onDone: (message: string) => void; hours?: PairMarket; now?: number }) {
  const closed = !!hours && !hours.open;
  const pair = findPair(o.symbol);
  const digits = pair?.digits ?? 5;
  const [priceText, setPrice] = useState(o.price.toFixed(digits));
  const [slText, setSl] = useState(o.stopLoss === undefined ? '' : o.stopLoss.toFixed(digits));
  const [tpText, setTp] = useState(o.takeProfit === undefined ? '' : o.takeProfit.toFixed(digits));
  const [trailText, setTrail] = useState(o.trailingPips === undefined ? '' : String(o.trailingPips));
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>(() => choiceFor(o.expiresAt, now));
  const [expiryText, setExpiryText] = useState(o.expiresAt === undefined ? '' : toLocalInput(o.expiresAt));
  const [ocoChoice, setOcoChoice] = useState(o.ocoWith ?? '');
  const ocoValue = chosenLink(ocoChoice, snapshot.state.orders, o.id);
  const quote = snapshot.quotes[o.symbol];
  const market = quote ? openSidePrice(o.side, quote) : undefined;
  const pr = parseLevel(priceText, digits, 'Order price'), sl = parseLevel(slText, digits, 'Stop loss'), tp = parseLevel(tpText, digits, 'Take profit');
  const price = pr.ok ? pr.value : null;
  const slValue = sl.ok ? sl.value : null, tpValue = tp.ok ? tp.value : null;
  const trail = parseTrailing(trailText);
  const trailValue = trail.ok ? trail.value : null;
  // A date kept as it was stays exact to the millisecond (the picker works in minutes).
  const keptDate = expiryChoice === 'date' && o.expiresAt !== undefined && expiryText === toLocalInput(o.expiresAt);
  const expiry = keptDate ? { ok: true as const, value: o.expiresAt! } : expiryValue(expiryChoice, expiryText, now);
  const expiryValueOrNull = expiry.ok ? expiry.value : null;
  const fieldErrors = [pr, sl, tp, trail, expiry].flatMap(f => ('error' in f ? [f.error] : []));
  if (pr.ok && price === null) fieldErrors.push('Order price is required. To remove the order, cancel it.');
  const priceMoved = price !== null && price !== o.price;
  // The side-of-market rule only applies when the price changes (the engine checks the same way).
  const errors = fieldErrors.length || price === null ? fieldErrors : pendingErrors(o.side, o.type, priceMoved ? market : undefined, price, slValue, tpValue, digits);
  const change = !fieldErrors.length && price !== null ? orderChange(o, { price, stopLoss: slValue, takeProfit: tpValue, trailingPips: trailValue, expiresAt: expiryValueOrNull }) : {};
  Object.assign(change, !fieldErrors.length && price !== null ? linkChange(o.ocoWith, ocoValue) : {});
  // After the fill the position starts trailing once the price is the distance beyond the fill (about the order price).
  const trailStart = pair && price !== null && trailValue !== null ? trailingPreview(pair, o.side, price, undefined, trailValue, null).startsAt : null;
  const changed = Object.keys(change).length > 0;
  const outcome = (level: number | null) => (pair && price !== null && level !== null ? levelOutcome(pair, o.side, o.lots, price, level, snapshot.quotes) : null);
  const atStop = outcome(slValue), atTarget = outcome(tpValue);
  const room = snapshot.metrics.roomToFloor;
  const id = `edit-${o.id}`;

  const save = async () => {
    if (errors.length || !changed || price === null || closed) return;
    const ok = await engine.run(g => g.modifyOrder(snapshot.state.accountId, o.id, change));
    if (ok) onDone(`${o.symbol} ${o.side} ${o.type} ${o.id}: price ${price.toFixed(digits)}, stop loss ${slValue === null ? 'none' : slValue.toFixed(digits)}, take profit ${tpValue === null ? 'none' : tpValue.toFixed(digits)}, ${expiryValueOrNull === null ? 'good till cancelled' : `expires ${expiryAt(expiryValueOrNull)}`}, trailing stop ${trailValue === null ? 'off' : `${trailValue} pips`}${ocoValue ? `, linked with order ${ocoValue} (one cancels the other)` : o.ocoWith !== undefined ? `, no longer linked with order ${o.ocoWith}` : ''}.`);
  };

  const input = 'mt-1 w-full min-w-0 rounded-md border bg-background px-2 py-1.5 font-mono text-sm';
  const result = (r: ReturnType<typeof outcome>, none: string, testId: string) => <p className="mt-1 min-h-4 text-muted-foreground" data-testid={testId}>{r ? <>If hit after the fill: <span className={r.dollars !== null && r.dollars < 0 ? 'text-red-500' : 'text-emerald-500'}>{r.dollars === null ? '—' : money(r.dollars)}</span> ({r.pips > 0 ? '+' : ''}{r.pips.toFixed(1)} pips)</> : none}</p>;
  return <form data-testid="order-editor" aria-label={`Edit ${o.symbol} order ${o.id}`} className="sticky left-0 grid max-w-[100vw] gap-3 bg-secondary/30 p-3 text-xs md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={e => { e.preventDefault(); void save(); }}>
    <div>
      <label htmlFor={`${id}-price`} className="text-muted-foreground">{o.side === 'buy' ? 'Buy' : 'Sell'} {o.type} price</label>
      <input id={`${id}-price`} inputMode="decimal" value={priceText} onChange={e => setPrice(e.target.value)} className={input} />
      <p className="mt-1 min-h-4 text-muted-foreground" data-testid="order-distance">{market !== undefined && price !== null && pair ? <>{pipsAway(price, market, pair.pipSize).toFixed(1)} pips {price < market ? 'below' : 'above'} the current {o.side === 'buy' ? 'ask' : 'bid'} {market.toFixed(digits)}</> : 'No live price for this pair.'}</p>
    </div>
    <div>
      <label htmlFor={`${id}-sl`} className="text-muted-foreground">Stop loss (price)</label>
      <input id={`${id}-sl`} inputMode="decimal" value={slText} onChange={e => setSl(e.target.value)} placeholder="None" className={input} />
      {result(atStop, 'No stop: the loss is limited only by the account rules.', 'order-sl-outcome')}
      {slText && <button type="button" onClick={() => setSl('')} className="mt-1 rounded border px-2 py-0.5 hover:bg-secondary">Remove stop</button>}
    </div>
    <div>
      <label htmlFor={`${id}-tp`} className="text-muted-foreground">Take profit (price)</label>
      <input id={`${id}-tp`} inputMode="decimal" value={tpText} onChange={e => setTp(e.target.value)} placeholder="None" className={input} />
      {result(atTarget, 'No target set.', 'order-tp-outcome')}
      {tpText && <button type="button" onClick={() => setTp('')} className="mt-1 rounded border px-2 py-0.5 hover:bg-secondary">Remove target</button>}
    </div>
    <div className="md:col-span-3 md:col-start-1">
      <label htmlFor={`${id}-trail`} className="block text-muted-foreground">Trailing stop after the fill (pips)</label>
      <input id={`${id}-trail`} inputMode="decimal" value={trailText} onChange={e => setTrail(e.target.value)} placeholder="Off" aria-invalid={!trail.ok} aria-describedby={`${id}-trail-note`} className={`${input} md:max-w-[12rem]`} />
      <p id={`${id}-trail-note`} className="mt-1 min-h-4 text-muted-foreground" data-testid="order-trailing-outcome">{trailStart !== null
        ? <>When the order fills, the position gets a {trailValue}-pip trailing stop. It starts once the {o.side === 'buy' ? 'bid' : 'ask'} reaches about <span className="font-mono text-foreground">{trailStart.toFixed(digits)}</span> ({trailValue} pips in profit from {price!.toFixed(digits)}), with the stop at break-even, then follows the price and never moves back.{slValue === null ? '' : ' Until then the stop loss above applies.'}</>
        : o.trailingPips !== undefined && trail.ok && trailValue === null
          ? <>Saving switches off the {o.trailingPips}-pip trailing stop set when you placed this order.</>
          : 'Off. With a distance, the trading server moves the stop loss behind the price after the fill, even with this page closed.'}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {[15, 30].map(n => <button key={n} type="button" onClick={() => setTrail(String(n))} className="rounded border px-2 py-0.5 hover:bg-secondary" aria-pressed={trailValue === n}>{n} pips</button>)}
        {trailText && <button type="button" onClick={() => setTrail('')} className="rounded border px-2 py-0.5 hover:bg-secondary">Trailing off</button>}
      </div>
    </div>
    <ExpiryPicker id={id} choice={expiryChoice} onChoice={setExpiryChoice} dateText={expiryText} onDateText={setExpiryText} now={now} className="md:col-span-3 md:col-start-1 md:max-w-md" />
    <OcoPicker id={id} orders={snapshot.state.orders} selfId={o.id} value={ocoValue} onChange={setOcoChoice} draft={price !== null ? { symbol: o.symbol, side: o.side, type: o.type, price } : null} className="md:col-span-3 md:col-start-1 md:max-w-md" />
    <div className="flex flex-col gap-2 md:col-start-4 md:row-start-1 md:row-span-3 md:w-40">
      <button type="submit" disabled={engine.busy || closed || !changed || errors.length > 0} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save order</button>
      <button type="button" onClick={() => onDone('')} className="rounded-md border px-3 py-1 hover:bg-secondary">Cancel</button>
    </div>
    <div className="space-y-1 md:col-span-4" aria-live="polite">
      {closed && hours && <p data-testid="editor-market-closed" role="note" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-foreground">{closedSentence(o.symbol, hours, now)} You can prepare the change now; saving unlocks when the market opens. Cancelling the order works at any time.</p>}
      <p className="text-muted-foreground">{o.lots.toFixed(2)} lots · fills at the order price or the next available price. Volume and direction can't change: cancel and place a new order for that.</p>
      {atStop?.dollars != null && atStop.dollars < 0 && -atStop.dollars > room && <p data-testid="order-stop-vs-room" className="text-red-500">This stop would lose {money(-atStop.dollars)}, more than the {money(room)} left before the loss limit: the account would be stopped out first.</p>}
      {errors.map(e => <p key={e} role="alert" className="text-red-500">{e}</p>)}
    </div>
  </form>;
}

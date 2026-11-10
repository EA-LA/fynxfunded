import { useState, type ReactNode } from 'react';
import type { QuoteBook } from '@/engine/types';
import type { ForexPair } from './instruments';
import { lotsForRisk, parseRisk, pipValuePerLot, riskWarnings, type RiskMode } from './sizing';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/**
 * "Size by risk" in the order ticket: the trader types how much the stop loss
 * may cost (a share of the balance or dollars) and gets the volume on the 0.01
 * lot step, rounded down. It only fills the volume field when asked; nothing is
 * sent from here.
 */
export default function TicketRiskSize({ pair, slPips, balance, quotes, roomToFloor, dailyLossAmount, currentLots, onUse }: {
  pair: ForexPair; slPips: number | null; balance: number | null | undefined; quotes?: QuoteBook | null;
  roomToFloor?: number | null; dailyLossAmount?: number | null; currentLots: number | null; onUse: (lots: number) => void;
}) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<RiskMode>('percent'), [text, setText] = useState('');
  const risk = parseRisk(text, mode, balance);
  const pv = pipValuePerLot(pair, quotes);
  const size = risk.ok && risk.usd !== null && slPips && pv ? lotsForRisk(risk.usd, slPips, pv.perLot) : null;
  const warnings = risk.ok && risk.usd !== null ? riskWarnings(risk.usd, { roomToFloor, dailyLossAmount }) : [];
  const field = 'w-full rounded-md border bg-background px-2.5 py-1.5 font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring';

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-1.5 text-[11px] font-medium underline underline-offset-2" data-testid="risk-size-open">Size by risk</button>;

  let result: ReactNode;
  if ('error' in risk) result = <p role="alert" className="text-red-500">{risk.error}</p>;
  else if (risk.usd === null) result = <p className="text-muted-foreground">Type how much the stop loss may cost, or pick a share of the balance.</p>;
  else if (!slPips) result = <p className="text-muted-foreground">Set a stop loss in pips below to size the trade for a {money(risk.usd)} risk.</p>;
  else if (!pv) result = <p className="text-muted-foreground">The dollar value of a {pair.symbol} pip moves with the {pair.quote}/USD rate. It is worked out from the trading server&apos;s price once trading is connected; until then use the lot size calculator below.</p>;
  else if (!size || size.lots === null) result = <p className="text-amber-600">A {slPips}-pip stop costs {money(size?.minLotRisk ?? 0)} even at the smallest volume (0.01 lots), more than {money(risk.usd)}. Use a tighter stop or a larger risk.</p>;
  else result = <div className="space-y-1.5">
    <p data-testid="risk-size-result"><span className="font-semibold">{size.lots.toFixed(2)} lots</span> · a {slPips}-pip stop would cost {money(size.riskAtLots!)} of the {money(risk.usd)} you chose{balance ? ` (${Math.round((size.riskAtLots! / balance) * 10000) / 100}% of the balance)` : ''}.</p>
    {size.capped && <p className="text-amber-600">Cut to the 50-lot maximum per order.</p>}
    <p className="text-[11px] text-muted-foreground">{money(Math.round(pv.perLot * 100) / 100)} per pip on 1.00 lot{pv.source === 'server' ? `, converted with ${pv.via} from the trading server; it moves with that price` : ''}. Spread, commission and slippage come on top.</p>
    <button type="button" onClick={() => onUse(size.lots!)} disabled={currentLots === size.lots} className="w-full rounded-md border border-primary bg-primary/10 py-1.5 text-xs font-semibold hover:bg-primary/20 disabled:opacity-60" data-testid="risk-size-use">{currentLots === size.lots ? `Volume set to ${size.lots.toFixed(2)} lots` : `Use ${size.lots.toFixed(2)} lots`}</button>
  </div>;

  return <div className="mt-2 space-y-2 rounded-lg border p-2.5 text-xs" data-testid="risk-size">
    <div className="flex items-center justify-between gap-2">
      <p className="font-semibold">Size by risk</p>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground underline underline-offset-2">Hide</button>
    </div>
    <div className="flex items-stretch gap-1" role="group" aria-label="Risk measured in">
      {(['percent', 'usd'] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} aria-label={m === 'percent' ? '% of balance' : 'Dollars'} title={m === 'percent' ? 'Risk as a share of the balance' : 'Risk in US dollars'} onClick={() => { setMode(m); setText(''); }} className={`w-9 shrink-0 rounded border font-mono text-xs ${mode === m ? 'border-primary bg-primary/10' : 'hover:bg-secondary'}`}>{m === 'percent' ? '%' : '$'}</button>)}
      <label className="sr-only" htmlFor="risk-size-input">{mode === 'percent' ? 'Risk (% of balance)' : 'Risk (dollars)'}</label>
      <input id="risk-size-input" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} placeholder={mode === 'percent' ? 'e.g. 0.5' : 'e.g. 50'} className={field} aria-invalid={!risk.ok} />
    </div>
    {mode === 'percent' && <div className="flex gap-1">{['0.25', '0.5', '1'].map(v => <button key={v} type="button" aria-label={`Risk ${v}% of the balance`} onClick={() => setText(v)} className={`flex-1 rounded border py-1 font-mono text-[11px] ${text === v ? 'border-primary bg-primary/10' : 'hover:bg-secondary'}`}>{v}%</button>)}</div>}
    {result}
    {warnings.map(w => <p key={w.text} role={w.level === 'stop' ? 'alert' : undefined} className={w.level === 'stop' ? 'text-red-500' : 'text-amber-600'} data-testid="risk-size-warning">{w.text}</p>)}
  </div>;
}

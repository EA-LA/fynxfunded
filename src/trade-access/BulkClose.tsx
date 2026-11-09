import { useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import type { Snapshot } from '@/engine/venue';
import type { EngineHandle } from './useEngine';
import { pairMarket } from './market-hours';
import { closeEach, closeSummary, planClose, SCOPE_LABEL, type CloseOutcome, type CloseScope } from './bulk-close';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const SCOPES: CloseScope[] = ['all', 'winning', 'losing'];

/**
 * "Close all / winning / losing" bar on the Positions tab. Shows how many
 * positions each button closes and their result now, asks once, then closes
 * them one by one with the same request as the row's Close button.
 */
export default function BulkClose({ snapshot, engine, now }: { snapshot: Snapshot; engine: EngineHandle; now: number }) {
  const [scope, setScope] = useState<CloseScope | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const isOpen = (symbol: string) => pairMarket(engine.status, symbol, now).open;
  const plans = Object.fromEntries(SCOPES.map(s => [s, planClose(snapshot, s, isOpen)])) as Record<CloseScope, ReturnType<typeof planClose>>;
  const accountId = snapshot.state.accountId;
  if (!snapshot.state.positions.length && !result) return null;
  const plan = scope ? plans[scope] : null;
  const symbols = (ids: string[]) => [...new Set(snapshot.state.positions.filter(p => ids.includes(p.id)).map(p => p.symbol))].join(', ');

  const confirm = async () => {
    if (!scope || !plan?.ids.length) return;
    let outcome: CloseOutcome | null = null;
    const known = snapshot.state.history.map(d => d.id);
    await engine.run(async g => {
      outcome = await closeEach(g, accountId, plan.ids, known);
      return outcome.snapshot ?? await g.snapshot(accountId);
    });
    setScope(null);
    const o = outcome as CloseOutcome | null;
    setResult(o ? { text: closeSummary(o, money), ok: !o.failed.length } : { text: engine.error || 'The request failed.', ok: false });
  };

  return <div className="border-b px-3 py-2" data-testid="bulk-close">
    {snapshot.state.positions.length > 0 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Close several positions">
      {SCOPES.map(s => { const p = plans[s], n = p.ids.length + p.marketClosed.length; return <button key={s} type="button" disabled={engine.busy || n === 0} aria-pressed={scope === s} onClick={() => { setResult(null); setScope(scope === s ? null : s); }} className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${scope === s ? 'border-primary bg-primary/10' : 'hover:bg-secondary'}`}>{SCOPE_LABEL[s]} ({n})</button>; })}
      {plans.all.unpriced > 0 && <span className="text-[11px] text-muted-foreground">{plans.all.unpriced} without a current price {plans.all.unpriced === 1 ? 'is' : 'are'} only in “Close all”.</span>}
    </div>}
    {scope && plan && <div role="dialog" aria-label={`${SCOPE_LABEL[scope]} positions`} className="mt-2 rounded-md border bg-secondary/30 p-3 text-xs" data-testid="bulk-close-review">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{plan.ids.length ? `${SCOPE_LABEL[scope]}: ${plan.ids.length} position${plan.ids.length === 1 ? '' : 's'} (${symbols(plan.ids)})` : 'Nothing can be closed right now'}</p>
        <button type="button" aria-label="Cancel" onClick={() => setScope(null)}><X size={14} /></button>
      </div>
      {plan.ids.length > 0 && <p className="mt-1 text-muted-foreground">Result at today’s prices: <span className={`font-mono font-semibold ${plan.profit < 0 ? 'text-red-500' : plan.profit > 0 ? 'text-emerald-500' : ''}`}>{money(plan.profit)}</span> (swap included, before closing commission). Each position closes at the market price when the trading server receives it, so the final result can differ.</p>}
      {plan.marketClosed.length > 0 && <p className="mt-1 flex items-start gap-1.5"><LockKeyhole size={12} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />{plan.marketClosed.length} stay{plan.marketClosed.length === 1 ? 's' : ''} open because the market is closed: {[...new Set(plan.marketClosed.map(m => m.symbol))].join(', ')}.</p>}
      {plan.ids.length > 0 && <div className="mt-2 flex gap-2">
        <button type="button" disabled={engine.busy} onClick={() => void confirm()} className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-60" data-testid="bulk-close-confirm">{engine.busy ? 'Closing…' : `Close ${plan.ids.length} now`}</button>
        <button type="button" onClick={() => setScope(null)} className="rounded-md border px-3 py-1.5 hover:bg-secondary">Keep them open</button>
      </div>}
    </div>}
    {result && <p role="status" data-testid="bulk-close-result" className={`mt-1 text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{result.text}</p>}
  </div>;
}

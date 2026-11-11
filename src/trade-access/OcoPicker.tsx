import type { PendingOrder } from '@/engine/types';
import { bracketHint, linkCandidates, orderLabel } from './oco';

/**
 * "One cancels the other": link this pending order with another pending
 * order. When either fills, the trading server cancels the other at once.
 * `draft` describes the order being placed or edited, for the set-up hint.
 */
export default function OcoPicker({ id, orders, selfId, value, onChange, draft, className = '' }: {
  id: string; orders: readonly PendingOrder[]; selfId?: string; value: string; onChange: (v: string) => void;
  draft?: Pick<PendingOrder, 'symbol' | 'side' | 'type' | 'price'> | null; className?: string;
}) {
  const options = linkCandidates(orders, selfId);
  const partner = options.find(o => o.id === value);
  const hint = partner && draft ? bracketHint(draft, partner) : null;
  return <div className={className}>
    <label htmlFor={`${id}-oco`} className="text-xs text-muted-foreground">One cancels the other</label>
    <select id={`${id}-oco`} data-testid={`${id}-oco`} value={partner ? value : ''} onChange={e => onChange(e.target.value)} disabled={!options.length} aria-describedby={`${id}-oco-help`} className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
      <option value="">Not linked</option>
      {options.map(o => <option key={o.id} value={o.id}>Link with {orderLabel(o)}</option>)}
    </select>
    <p id={`${id}-oco-help`} data-testid={`${id}-oco-help`} className="mt-1 text-[11px] text-muted-foreground">
      {partner
        ? <>If either order fills, the trading server cancels the other one at once, even with this page closed. Cancelling one yourself, or its expiry, keeps the other pending.{hint ? <> {hint}</> : null}</>
        : options.length
          ? 'Optional. Link with another pending order so only one of the two can fill.'
          : selfId ? 'No other pending order to link with.' : 'To link two orders, place the first pending order, then choose it here for the second.'}
    </p>
  </div>;
}

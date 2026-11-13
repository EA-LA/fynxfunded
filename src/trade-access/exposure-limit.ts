import { exposureBreach, exposureLimits, exposureUse, type ExposureBreach, type ExposureLimits, type ExposureState, type ExposureUse } from '@/engine/exposure';

/**
 * Terminal side of the optional "open exposure" limits (src/engine/exposure.ts):
 * the account's limits from the trading server's snapshot, and a check of the
 * order being written against them, using the engine's own counting.
 */

/** The account's limits from the snapshot, or null (no limit, or nothing valid sent). */
export function exposureRule(snapshot: { exposure?: { maxOpenLots?: unknown; maxOpenTrades?: unknown } } | null | undefined): ExposureLimits | null {
  return exposureLimits(snapshot?.exposure);
}

export interface TicketExposure {
  limits: ExposureLimits;
  now: ExposureUse;
  after: ExposureUse | null;
  /** Set when the order as written would be refused by the server. */
  breach: ExposureBreach | null;
  /** Usage line for the order panel. */
  text: string;
  /** Usage is at 80 % or more of a limit, or the order would break it. */
  warn: boolean;
}

const lots = (n: number) => n.toFixed(2);

/**
 * The order panel's view of the limits: usage now, usage after this order
 * (a market order adds an open trade; a pending order adds a waiting order,
 * linked with `ocoWith` when chosen) and whether the server would refuse it.
 */
export function ticketExposure(
  snapshot: { exposure?: { maxOpenLots?: unknown; maxOpenTrades?: unknown }; state: ExposureState } | null | undefined,
  order: { lots: number | null; type: 'market' | 'limit' | 'stop'; ocoWith?: string },
): TicketExposure | null {
  const limits = exposureRule(snapshot);
  if (!limits || !snapshot) return null;
  const { positions, orders } = snapshot.state;
  const now = exposureUse({ positions, orders });
  let afterState: ExposureState | null = null;
  if (order.lots && order.lots > 0) {
    if (order.type === 'market') afterState = { positions: [...positions, { lots: order.lots }], orders };
    else {
      const id = '__ticket__';
      const link = order.ocoWith && orders.some(o => o.id === order.ocoWith) ? order.ocoWith : undefined;
      afterState = { positions, orders: [...orders.map(o => (link && o.id === link ? { ...o, ocoWith: id } : o)), { id, lots: order.lots, ...(link ? { ocoWith: link } : {}) }] };
    }
  }
  const after = afterState ? exposureUse(afterState) : null;
  const breach = after ? exposureBreach(now, after, limits) : null;
  const parts = [
    limits.maxOpenLots !== undefined ? `${lots(now.lots)} of ${lots(limits.maxOpenLots)} lots` : '',
    limits.maxOpenTrades !== undefined ? `${now.trades} of ${limits.maxOpenTrades} trades` : '',
  ].filter(Boolean);
  const near = (limits.maxOpenLots !== undefined && now.lots >= limits.maxOpenLots * 0.8) || (limits.maxOpenTrades !== undefined && now.trades >= limits.maxOpenTrades * 0.8);
  const text = breach
    ? breach.message.replace(/ Nothing was sent\.$/, '')
    : `Open at once on this account: ${parts.join(' · ')} (open trades and waiting orders count${after && (after.lots !== now.lots || after.trades !== now.trades) ? `; after this order ${[limits.maxOpenLots !== undefined ? `${lots(after.lots)} lots` : '', limits.maxOpenTrades !== undefined ? `${after.trades} trades` : ''].filter(Boolean).join(' · ')}` : ''}).`;
  return { limits, now, after, breach, text, warn: !!breach || near };
}

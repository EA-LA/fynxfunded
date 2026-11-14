import type { PendingOrder } from '@/engine/types';
import { findPair } from './instruments';

/**
 * "One cancels the other" (OCO) helpers for the terminal. Two pending orders
 * can be linked: when either fills, the trading server cancels the other one
 * in the same step, also with the terminal closed.
 */

/** Pending orders an order can be linked with: not itself, and not already linked with a third order. */
export function linkCandidates(orders: readonly PendingOrder[], selfId?: string): PendingOrder[] {
  return orders.filter(o => o.id !== selfId && (o.ocoWith === undefined || o.ocoWith === selfId));
}

const priceText = (o: Pick<PendingOrder, 'symbol' | 'price'>) => o.price.toFixed(findPair(o.symbol)?.digits ?? 5);

/** "Sell stop 0.50 EURUSD at 1.07500 · ord12" */
export function orderLabel(o: Pick<PendingOrder, 'id' | 'symbol' | 'side' | 'type' | 'lots' | 'price'>): string {
  return `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.type} ${o.lots.toFixed(2)} ${o.symbol} at ${priceText(o)} · ${o.id}`;
}

/** The chosen link if it is still allowed; '' when nothing (or something no longer pending) is chosen. */
export function chosenLink(choice: string, orders: readonly PendingOrder[], selfId?: string): string {
  return choice && linkCandidates(orders, selfId).some(o => o.id === choice) ? choice : '';
}

/**
 * Change body for the order editor: `ocoWith` only when the link changes
 * (an id links, null unlinks both orders).
 */
export function linkChange(current: string | undefined, next: string): { ocoWith?: string | null } {
  if ((current ?? '') === next) return {};
  return { ocoWith: next || null };
}

/**
 * A pair of pending orders that brackets the market (a buy stop above and a
 * sell stop below, or the two limits), the usual OCO set-up for a breakout
 * or a range. Returns a plain hint when the two orders work that way.
 */
export function bracketHint(a: Pick<PendingOrder, 'symbol' | 'side' | 'type' | 'price'>, b: Pick<PendingOrder, 'symbol' | 'side' | 'type' | 'price'>): string | null {
  if (a.symbol !== b.symbol || a.side === b.side || a.type !== b.type) return null;
  const buy = a.side === 'buy' ? a : b, sell = a.side === 'buy' ? b : a;
  if (a.type === 'stop' && buy.price > sell.price) return `Breakout set-up: whichever way ${a.symbol} breaks first opens the trade, and the other order is cancelled.`;
  if (a.type === 'limit' && buy.price < sell.price) return `Range set-up: whichever edge of the range ${a.symbol} touches first opens the trade, and the other order is cancelled.`;
  return null;
}

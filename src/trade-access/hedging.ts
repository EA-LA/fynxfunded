import { noHedging, oppositeOpen, type HedgeSide } from '@/engine/hedging';
import type { PendingHold } from './pending-hold';

/**
 * Terminal side of the optional "no hedging" rule (src/engine/hedging.ts):
 * whether the account forbids buy and sell trades on the same pair at once,
 * what the order panel should say for the chosen pair, and which waiting
 * orders the trading server is holding because of it. The trading server
 * checks again when an order arrives.
 */

type Positions = readonly { symbol: string; side: HedgeSide; lots: number }[];
interface HedgeSnapshot { hedging?: { allowed?: unknown }; state: { positions: Positions } }

/** True when the trading server reports that this account allows no hedging. */
export function hedgingOff(snapshot: { hedging?: { allowed?: unknown } } | null | undefined): boolean {
  return noHedging({ hedgingAllowed: snapshot?.hedging?.allowed });
}

export interface TicketHedge {
  /** Sides a new order on this pair may not take right now. */
  blocked: HedgeSide[];
  /** The order being reviewed would be refused: Confirm stays locked. */
  blocks: boolean;
  text: string;
}

const trades = (n: number, lots: number, side: HedgeSide) => `${n} ${side} trade${n === 1 ? '' : 's'} (${lots.toFixed(2)} lots)`;

/**
 * The order panel's note for `symbol`, or null when the rule is off or no
 * trade is open on the pair. `review` is the side being reviewed (null before
 * SELL/BUY is pressed).
 */
export function ticketHedge(snapshot: HedgeSnapshot | null | undefined, symbol: string, review: HedgeSide | null): TicketHedge | null {
  if (!snapshot || !hedgingOff(snapshot)) return null;
  const positions = snapshot.state.positions;
  const againstBuy = oppositeOpen(positions, symbol, 'buy'), againstSell = oppositeOpen(positions, symbol, 'sell');
  if (!againstBuy && !againstSell) return null;
  const blocked: HedgeSide[] = [...(againstBuy ? ['buy' as const] : []), ...(againstSell ? ['sell' as const] : [])];
  const blocks = review !== null && blocked.includes(review);
  if (againstBuy && againstSell) {
    return { blocked, blocks, text: `This account does not allow buy and sell trades on the same pair at once. ${symbol} has ${trades(againstSell.trades, againstSell.lots, 'buy')} and ${trades(againstBuy.trades, againstBuy.lots, 'sell')} open (opened before the rule applied), so no new ${symbol} order can be placed until one side is closed.` };
  }
  const open = (againstBuy ?? againstSell)!; // the open side
  const allowed = open.side;
  return { blocked, blocks, text: blocks
    ? `This account does not allow buy and sell trades on the same pair at once: ${symbol} has ${trades(open.trades, open.lots, open.side)} open, so a ${review} order cannot be placed. Close the ${open.side} trade${open.trades === 1 ? '' : 's'} first (Positions tab), or add to ${open.trades === 1 ? 'it' : 'them'} with a ${allowed} order.`
    : `No hedging on this account: ${symbol} has ${trades(open.trades, open.lots, open.side)} open, so new ${symbol} orders can only be ${allowed}s until ${open.trades === 1 ? 'it is' : 'they are'} closed.` };
}

/**
 * Whether the trading server holds this waiting order (it stays in the book
 * but does not fill) because the account allows no hedging and a trade in the
 * other direction is open on its pair. Mirrors `hedgeHoldsFill` in
 * src/engine/core.ts.
 */
export function hedgeHold(snapshot: HedgeSnapshot | null | undefined, order: { symbol: string; side: HedgeSide }): PendingHold | null {
  if (!snapshot || !hedgingOff(snapshot)) return null;
  const o = oppositeOpen(snapshot.state.positions, order.symbol, order.side);
  if (!o) return null;
  return { kind: 'hedge', label: 'Held · hedge', until: null, text: `Held: this account does not allow buy and sell trades on ${order.symbol} at once, and ${trades(o.trades, o.lots, o.side)} ${o.trades === 1 ? 'is' : 'are'} open. This ${order.side} order stays in place but does not fill until ${o.trades === 1 ? 'that trade is' : 'those trades are'} closed; the first price after that decides the fill. You can cancel it at any time.` };
}

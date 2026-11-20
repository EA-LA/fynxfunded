import type { Position } from '@/engine/types';

/**
 * Why the server would refuse reversing this position, said before sending
 * (the server checks again): accounts that need a stop loss on every new order
 * (the reversed trade opens without one), and "no hedging" accounts with
 * another trade on this pair in the position's own direction (the new trade
 * would hedge against it). null when nothing known stands in the way.
 */
export function reverseBlocked({ position: p, positions, stopRequired, hedgingAllowed }: { position: Pick<Position, 'id' | 'symbol' | 'side'>; positions: Pick<Position, 'id' | 'symbol' | 'side'>[]; stopRequired: boolean; hedgingAllowed: boolean }): string | null {
  if (stopRequired) return 'This account needs a stop loss on every new trade, and a reversed trade opens without one. Close this trade, then place a new order with a stop loss.';
  if (!hedgingAllowed) {
    const others = positions.filter(x => x.id !== p.id && x.symbol === p.symbol && x.side === p.side);
    if (others.length) return `This account does not allow a buy and a sell on the same pair at once, and ${others.length === 1 ? `trade #${others[0].id} stays` : `${others.length} other trades stay`} open ${p.side.toUpperCase()} on ${p.symbol}. Close ${others.length === 1 ? 'it' : 'them'} first.`;
  }
  return null;
}

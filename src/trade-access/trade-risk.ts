import { riskCapUsd, tradeRiskRule, type TradeRiskRule } from '@/engine/trade-risk';

/**
 * Terminal side of the optional "stop loss required" / "maximum risk per
 * trade" rule (src/engine/trade-risk.ts): the account's rule from the trading
 * server's snapshot, and a check of the order being written against it. The
 * trading server checks again with its exact prices when the order arrives.
 */

/** The account's rule from the snapshot, or null (no such rule, or nothing valid sent). */
export function tradeRiskFromSnapshot(snapshot: { tradeRisk?: { stopLossRequired?: unknown; maxRiskPercent?: unknown } } | null | undefined): TradeRiskRule | null {
  return tradeRiskRule(snapshot?.tradeRisk);
}

export interface TicketRiskRule {
  rule: TradeRiskRule;
  /** Dollar cap for today's balance, or null without a cap (or balance). */
  cap: number | null;
  /** The order as written would be refused: Confirm stays locked. */
  blocks: boolean;
  /** Near the cap (80 % or more) without passing it. */
  warn: boolean;
  text: string;
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * The order panel's view of the rule. `risk` is the ticket's loss at the stop
 * loss in dollars (pip value × stop pips) or null while it cannot be worked out.
 */
export function ticketRiskRule(
  snapshot: { tradeRisk?: { stopLossRequired?: unknown; maxRiskPercent?: unknown } } | null | undefined,
  order: { slPips: number | null; risk: number | null; balance: number | null | undefined },
): TicketRiskRule | null {
  const rule = tradeRiskFromSnapshot(snapshot);
  if (!rule) return null;
  const balance = order.balance && order.balance > 0 ? order.balance : null;
  const cap = balance !== null ? riskCapUsd(rule, balance) : null;
  const capText = rule.maxRiskPercent !== undefined ? `at most ${pct(rule.maxRiskPercent)} of the balance${cap !== null ? ` (${usd(cap)})` : ''} at the stop loss` : '';
  if (order.slPips === null) {
    return { rule, cap, blocks: true, warn: false, text: `This account needs a stop loss on every order${capText ? `, risking ${capText}` : ''}. Enter a stop loss in pips to continue.` };
  }
  if (rule.maxRiskPercent === undefined) return { rule, cap, blocks: false, warn: false, text: 'This account needs a stop loss on every order: set. It can be moved later, but not removed.' };
  if (order.risk === null || cap === null || balance === null) return { rule, cap, blocks: false, warn: false, text: `This account allows ${capText} per trade. The risk of this order is worked out once prices and the volume are in; the trading server checks it when the order arrives.` };
  const share = (order.risk / balance) * 100;
  if (order.risk > cap) return { rule, cap, blocks: true, warn: false, text: `This order would lose ${usd(order.risk)} at its stop loss (${pct(share)} of the balance); this account allows ${capText} per trade. Move the stop loss closer or lower the volume.` };
  return { rule, cap, blocks: false, warn: order.risk >= cap * 0.8, text: `Risk at the stop loss ${usd(order.risk)} (${pct(share)}) of the ${usd(cap)} allowed per trade on this account. The trading server checks it again at the fill price.` };
}

/**
 * The position / pending-order editors: why the stop loss as written would be
 * refused, or null. Removing an existing stop is refused under the rule; the
 * risk cap is checked only when the new stop risks more than the current one.
 */
export function editorRiskProblem(rule: TradeRiskRule | null, current: { hasStop: boolean; risk: number | null }, next: { hasStop: boolean; risk: number | null }, balance: number | null | undefined, what: 'trade' | 'order'): string | null {
  if (!rule) return null;
  if (current.hasStop && !next.hasStop) return `This account needs a stop loss on every ${what}: it can be moved, not removed.`;
  if (!next.hasStop || next.risk === null || rule.maxRiskPercent === undefined || !balance || balance <= 0) return null;
  if (current.hasStop && current.risk !== null && next.risk <= current.risk) return null;
  const cap = riskCapUsd(rule, balance);
  if (cap === null || next.risk <= cap) return null;
  return `With this stop loss the ${what} would lose ${usd(next.risk)} (${pct((next.risk / balance) * 100)} of the balance); this account allows at most ${pct(rule.maxRiskPercent)} (${usd(cap)}) per trade. Move the stop loss closer.`;
}

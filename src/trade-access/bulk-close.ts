import { profitUsd } from "@/engine/core";
import type { InstrumentSpec, Position, QuoteBook } from "@/engine/types";
import type { TradingGateway } from "@/engine/gateway";
import type { Snapshot } from "@/engine/venue";
import { CONTRACT_SIZE, findPair } from "./instruments";

/** Which open positions a "Close …" button on the Positions tab closes. */
export type CloseScope = "all" | "winning" | "losing";

export const SCOPE_LABEL: Record<CloseScope, string> = { all: "Close all", winning: "Close winning", losing: "Close losing" };

/**
 * Floating result of a position in dollars at the current closing price (bid
 * for buys, ask for sells), swap included: the same figure as the Profit
 * column. NaN without a price for the pair.
 */
export function positionProfit(p: Pick<Position, "symbol" | "side" | "lots" | "entryPrice" | "swap">, quotes: QuoteBook): number {
  const pair = findPair(p.symbol), q = quotes[p.symbol];
  if (!pair || !q) return NaN;
  try {
    return profitUsd({ contractSize: CONTRACT_SIZE, quote: pair.quote } as InstrumentSpec, p.side, p.lots, p.entryPrice, p.side === "buy" ? q.bid : q.ask, quotes) + (p.swap ?? 0);
  } catch { return NaN; }
}

export interface ClosePlan {
  /** Positions that will be sent for closing, in table order. */
  ids: string[];
  /** Their combined floating result now (dollars); prices can move before each one closes. */
  profit: number;
  /** Positions in the scope left open because their market is closed. */
  marketClosed: { id: string; symbol: string }[];
  /** Positions without a current price: not counted as winning or losing. */
  unpriced: number;
}

/**
 * Picks the positions a bulk close acts on. Winning means a floating result
 * above zero, losing below zero; break-even and unpriced positions are only in
 * "all". Positions whose market is closed are listed apart and not sent (the
 * engine would refuse them).
 */
export function planClose(snapshot: Pick<Snapshot, "state" | "quotes">, scope: CloseScope, isOpen: (symbol: string) => boolean): ClosePlan {
  const plan: ClosePlan = { ids: [], profit: 0, marketClosed: [], unpriced: 0 };
  for (const p of snapshot.state.positions) {
    const pr = positionProfit(p, snapshot.quotes);
    const known = Number.isFinite(pr);
    if (!known) plan.unpriced += 1;
    const inScope = scope === "all" || (known && (scope === "winning" ? pr > 0 : pr < 0));
    if (!inScope) continue;
    if (!isOpen(p.symbol)) { plan.marketClosed.push({ id: p.id, symbol: p.symbol }); continue; }
    plan.ids.push(p.id);
    if (known) plan.profit += pr;
  }
  plan.profit = Math.round(plan.profit * 100) / 100;
  return plan;
}

export interface CloseOutcome {
  snapshot: Snapshot | null;
  closed: string[];
  failed: { id: string; message: string }[];
  /** Net result booked by the positions this run closed (from the new history deals). */
  booked: number;
}

/**
 * Closes positions one by one through the gateway (the same request as the
 * row's Close button), so one refusal never stops the others. A position that
 * is already gone (closed by its stop or the loss limit meanwhile) is not an
 * error. `knownDeals` are the history deal ids before the run, so `booked`
 * only counts the deals this run created.
 */
export async function closeEach(gateway: TradingGateway, accountId: string, ids: string[], knownDeals: Iterable<string> = []): Promise<CloseOutcome> {
  const out: CloseOutcome = { snapshot: null, closed: [], failed: [], booked: 0 };
  for (const id of ids) {
    try {
      out.snapshot = await gateway.closePosition(accountId, id);
      out.closed.push(id);
    } catch (e) {
      if ((e as { code?: string })?.code === "no_position") continue;
      out.failed.push({ id, message: e instanceof Error ? e.message : "The request failed." });
    }
  }
  if (out.snapshot) {
    const mine = new Set(out.closed), seen = new Set(knownDeals);
    out.booked = Math.round(out.snapshot.state.history.filter(d => mine.has(d.positionId) && !seen.has(d.id)).reduce((t, d) => t + d.netProfit, 0) * 100) / 100;
  }
  return out;
}

/** One plain sentence for the notice under the Positions tab. */
export function closeSummary(o: Pick<CloseOutcome, "closed" | "failed" | "booked">, money: (n: number) => string): string {
  const n = o.closed.length;
  const done = n ? `Closed ${n} position${n === 1 ? "" : "s"}, net ${money(o.booked)}.` : "No position was closed.";
  if (!o.failed.length) return done;
  return `${done} ${o.failed.length} could not be closed: ${o.failed.map(f => `#${f.id} — ${f.message}`).join("; ")}`;
}

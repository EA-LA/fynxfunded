import { profitUsd } from "@/engine/core";
import type { AccountStatus, InstrumentSpec, Position, QuoteBook, Side } from "@/engine/types";
import type { Snapshot } from "@/engine/venue";
import { CONTRACT_SIZE, findPair } from "./instruments";

/**
 * Plain figures for showing a FYNX Trade account outside the terminal (the
 * FYNX Funded account workspace). Everything comes from one engine snapshot;
 * nothing is estimated or filled in when the engine did not send it.
 */

/** Open profit of one position in USD at the current closing price, swap included; NaN without a price. */
export function positionProfitUsd(p: Pick<Position, "symbol" | "side" | "lots" | "entryPrice" | "swap">, quotes: QuoteBook): number {
  const pair = findPair(p.symbol), q = quotes[p.symbol];
  if (!pair || !q) return NaN;
  const current = closePrice(p.side, q);
  try { return profitUsd({ contractSize: CONTRACT_SIZE, quote: pair.quote } as InstrumentSpec, p.side, p.lots, p.entryPrice, current, quotes) + (p.swap ?? 0); } catch { return NaN; }
}

const closePrice = (side: Side, q: { bid: number; ask: number }) => (side === "buy" ? q.bid : q.ask);
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (n: number) => Math.max(0, Math.min(100, n));

export interface LossRoom {
  /** Equity level that ends the account (closes everything) when reached. */
  floor: number;
  /** Dollars of equity left above that level (0 once reached). */
  room: number;
  /** Whole allowance in dollars; null when the snapshot can't tell. */
  allowance: number | null;
  /** Share of the allowance already used (0–100); null without an allowance. */
  usedPercent: number | null;
}

export interface LiveAccountSummary {
  status: AccountStatus;
  statusLabel: string;
  balance: number;
  equity: number;
  floatingProfit: number;
  dailyLoss: LossRoom;
  maxLoss: LossRoom;
  /** Which limit is closer to equity right now. */
  closerLimit: "daily" | "maximum";
  positions: { id: string; symbol: string; side: Side; lots: number; entryPrice: number; stopLoss?: number; takeProfit?: number; /** Trailing stop distance in pips, when on. */ trailingPips?: number; profit: number }[];
  pendingOrders: number;
  /** Latest price time among the account's open symbols (ms); null when no open position has a price. */
  pricesAt: number | null;
}

/** Status in words. "passed" in the engine means the target was met and waits for the official review. */
export function accountStatusLabel(status: AccountStatus): string {
  switch (status) {
    case "active": return "Active";
    case "passed": return "Target met · waiting for review";
    case "breached": return "Loss limit reached · account closed";
    case "disabled": return "Disabled";
  }
}

function room(equity: number, floor: number, allowance: number | null): LossRoom {
  const left = round2(Math.max(0, equity - floor));
  const usedPercent = allowance && allowance > 0 ? round2(clampPct(((allowance - left) / allowance) * 100)) : null;
  return { floor, room: left, allowance: allowance === null ? null : round2(allowance), usedPercent };
}

/**
 * Summarises a snapshot. `startingBalance` (the account size the trader bought)
 * lets the maximum-loss allowance be shown as a share; without it only the
 * dollars left are given.
 */
export function liveAccountSummary(snap: Snapshot, startingBalance?: number | null): LiveAccountSummary {
  const { state, metrics: m, quotes } = snap;
  const dailyLoss = room(m.equity, m.dailyLossFloor, state.dayStartBalance - m.dailyLossFloor);
  const start = typeof startingBalance === "number" && Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : null;
  const maxLoss = room(m.equity, m.maxLossFloor, start === null ? null : start - m.maxLossFloor);
  const positions = state.positions.map(p => ({ id: p.id, symbol: p.symbol, side: p.side, lots: p.lots, entryPrice: p.entryPrice, stopLoss: p.stopLoss, takeProfit: p.takeProfit, ...(p.trailingStop ? { trailingPips: p.trailingStop.pips } : {}), profit: positionProfitUsd(p, quotes) }));
  const times = state.positions.map(p => quotes[p.symbol]?.time).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  return {
    status: state.status,
    statusLabel: accountStatusLabel(state.status),
    balance: m.balance,
    equity: m.equity,
    floatingProfit: m.floatingProfit,
    dailyLoss,
    maxLoss,
    closerLimit: m.dailyLossFloor >= m.maxLossFloor ? "daily" : "maximum",
    positions,
    pendingOrders: state.orders.length,
    pricesAt: times.length ? Math.max(...times) : null,
  };
}

import { profitUsd } from "@/engine/core";
import type { InstrumentSpec, QuoteBook, Side } from "@/engine/types";
import { CONTRACT_SIZE, type ForexPair } from "./instruments";

/**
 * Helpers for changing the stop loss / take profit of an open position from
 * the terminal. The engine re-checks everything; these only give the trader a
 * clear answer before anything is sent.
 */

export type PriceField = { ok: true; value: number | null } | { ok: false; error: string };

/** A price typed by the trader: empty = no level; otherwise a positive price with at most `digits` decimals. */
export function parseLevel(text: string, digits: number, label: string): PriceField {
  const t = text.trim().replace(",", ".");
  if (!t) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: `${label}: type a price like ${(1).toFixed(digits)}.` };
  const decimals = t.split(".")[1]?.length ?? 0;
  if (decimals > digits) return { ok: false, error: `${label}: use at most ${digits} decimals.` };
  const value = Number(t);
  if (!(value > 0)) return { ok: false, error: `${label} must be above zero.` };
  return { ok: true, value };
}

/** The price a position closes at now: buys at the bid, sells at the ask. */
export const closeSidePrice = (side: Side, quote: { bid: number; ask: number }) => (side === "buy" ? quote.bid : quote.ask);

/** Same side checks as the engine: for buys the stop goes below and the target above the closing price; the reverse for sells. */
export function levelErrors(side: Side, closing: number | undefined, stopLoss: number | null, takeProfit: number | null, digits: number): string[] {
  if (closing === undefined) return [];
  const at = closing.toFixed(digits);
  const errors: string[] = [];
  if (stopLoss !== null && (side === "buy" ? stopLoss >= closing : stopLoss <= closing)) errors.push(`Stop loss must be ${side === "buy" ? "below" : "above"} the current ${side === "buy" ? "bid" : "ask"} ${at}, or it would close the position straight away.`);
  if (takeProfit !== null && (side === "buy" ? takeProfit <= closing : takeProfit >= closing)) errors.push(`Take profit must be ${side === "buy" ? "above" : "below"} the current ${side === "buy" ? "bid" : "ask"} ${at}.`);
  return errors;
}

export interface LevelOutcome {
  /** Pips from the entry, positive = in the position's favour. */
  pips: number;
  /** Result in dollars at that level, before commission; null when there is no conversion price. */
  dollars: number | null;
}

/** What the position would make or lose if it closed at `level`. */
export function levelOutcome(pair: ForexPair, side: Side, lots: number, entry: number, level: number, quotes: QuoteBook): LevelOutcome {
  const pips = Math.round(((level - entry) * (side === "buy" ? 1 : -1) / pair.pipSize) * 10) / 10;
  let dollars: number | null = null;
  try { dollars = profitUsd({ contractSize: CONTRACT_SIZE, quote: pair.quote } as InstrumentSpec, side, lots, entry, level, quotes); } catch { dollars = null; }
  return { pips, dollars };
}

/** Request body for the engine: a number sets the level, null removes it; unchanged levels are left out. */
export function protectionChange(current: { stopLoss?: number; takeProfit?: number }, next: { stopLoss: number | null; takeProfit: number | null }) {
  const out: { stopLoss?: number | null; takeProfit?: number | null } = {};
  if ((current.stopLoss ?? null) !== next.stopLoss) out.stopLoss = next.stopLoss;
  if ((current.takeProfit ?? null) !== next.takeProfit) out.takeProfit = next.takeProfit;
  return out;
}

/** Lots for a partial close: a multiple of 0.01 that leaves something open. */
export function parseCloseLots(text: string, open: number): { ok: true; value: number } | { ok: false; error: string } {
  const t = text.trim().replace(",", ".");
  const n = Number(t);
  if (!t || !Number.isFinite(n) || n <= 0) return { ok: false, error: "Type the volume to close, e.g. 0.05." };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { ok: false, error: "Volume goes in steps of 0.01 lots." };
  const lots = Math.round(n * 100) / 100;
  if (lots >= open) return { ok: false, error: `For the whole ${open.toFixed(2)} lots use Close position.` };
  return { ok: true, value: lots };
}

/** The price a new position opens at now: buys at the ask, sells at the bid. */
export const openSidePrice = (side: Side, quote: { bid: number; ask: number }) => (side === "buy" ? quote.ask : quote.bid);

/**
 * Same checks as the engine for a pending order: a buy limit sits below the
 * ask and a buy stop above it (the reverse for sells, against the bid), and the
 * stop loss / take profit sit on the right side of the order price.
 */
export function pendingErrors(side: Side, type: "limit" | "stop", market: number | undefined, price: number, stopLoss: number | null, takeProfit: number | null, digits: number): string[] {
  const errors: string[] = [];
  const ref = side === "buy" ? "ask" : "bid";
  if (market !== undefined) {
    const below = price < market;
    const wantBelow = (type === "limit") === (side === "buy");
    if (below !== wantBelow) errors.push(`A ${side} ${type} must be ${wantBelow ? "below" : "above"} the current ${ref} ${market.toFixed(digits)}; otherwise use a ${type === "limit" ? "stop" : "limit"} order or a market order.`);
  }
  const at = price.toFixed(digits);
  if (stopLoss !== null && (side === "buy" ? stopLoss >= price : stopLoss <= price)) errors.push(`Stop loss must be ${side === "buy" ? "below" : "above"} the order price ${at}.`);
  if (takeProfit !== null && (side === "buy" ? takeProfit <= price : takeProfit >= price)) errors.push(`Take profit must be ${side === "buy" ? "above" : "below"} the order price ${at}.`);
  return errors;
}

/** Pips between the order price and the market, always positive. */
export const pipsAway = (price: number, market: number, pipSize: number) => Math.round((Math.abs(price - market) / pipSize) * 10) / 10;

/** Request body for a pending-order change; unchanged fields are left out. */
export function orderChange(current: { price: number; stopLoss?: number; takeProfit?: number }, next: { price: number; stopLoss: number | null; takeProfit: number | null }) {
  const out: { price?: number; stopLoss?: number | null; takeProfit?: number | null } = protectionChange(current, next);
  if (next.price !== current.price) out.price = next.price;
  return out;
}

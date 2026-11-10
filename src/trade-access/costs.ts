import { usdPerUnit } from "@/engine/core";
import type { QuoteBook } from "@/engine/types";
import type { TradingConditions } from "@/engine/venue";
import type { ForexPair } from "./instruments";

/**
 * Margin, commission and swap of an order before it is sent, from the trading
 * server's published conditions (`GET /v1/status` → `instruments`) and its
 * prices. The same formulas as the engine (core.ts `marginUsd`, commission per
 * lot per side, swap per lot per night). Without the server's conditions every
 * figure is null: leverage and commission are never guessed.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OrderCostsInput {
  pair: Pick<ForexPair, "symbol" | "base">;
  lots: number | null;
  conditions?: TradingConditions | null;
  quotes?: QuoteBook | null;
  /** The account's free margin from the trading server, when connected. */
  freeMargin?: number | null;
}

export interface OrderCosts {
  leverage: number | null;
  /** USD of margin this order would use, null without conditions or a price to convert the base currency. */
  margin: number | null;
  /** "contract" when the base currency is USD (no price needed), "server" when converted with a server price. */
  marginSource: "contract" | "server" | null;
  freeMarginAfter: number | null;
  /** True when the margin needed is more than the free margin: the server would refuse the order. */
  notEnoughMargin: boolean;
  /** USD paid on opening plus closing this volume. */
  commissionRoundTurn: number | null;
  commissionPerSide: number | null;
  /** USD per night for this volume (negative is a charge), null when no swap or no conditions. */
  swapBuy: number | null;
  swapSell: number | null;
  /** "No swap" when the server publishes none for this pair. */
  swapNone: boolean;
  tripleWeekday: number | null;
  /** Plain message when the volume is outside the server's limits. */
  volumeProblem: string | null;
}

const EMPTY: OrderCosts = {
  leverage: null, margin: null, marginSource: null, freeMarginAfter: null, notEnoughMargin: false,
  commissionRoundTurn: null, commissionPerSide: null, swapBuy: null, swapSell: null, swapNone: false, tripleWeekday: null, volumeProblem: null,
};

/** Checks a volume against the server's lot limits and step; null when it fits. */
export function volumeProblem(lots: number, c: Pick<TradingConditions, "minLots" | "maxLots" | "lotStep">): string | null {
  if (lots < c.minLots - 1e-9 || lots > c.maxLots + 1e-9) return `The trading server accepts ${c.minLots} to ${c.maxLots} lots for this pair.`;
  const steps = (lots - c.minLots) / c.lotStep;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return `The volume must be in steps of ${c.lotStep} lots.`;
  return null;
}

export function orderCosts({ pair, lots, conditions, quotes, freeMargin }: OrderCostsInput): OrderCosts {
  if (!conditions) return EMPTY;
  const c = conditions;
  const out: OrderCosts = { ...EMPTY, leverage: c.leverage, tripleWeekday: c.swap ? c.swap.tripleWeekday : null, swapNone: !c.swap };
  if (!lots || !(lots > 0)) return out;
  out.volumeProblem = volumeProblem(lots, c);
  out.commissionPerSide = round2(c.commissionPerLotPerSide * lots);
  out.commissionRoundTurn = round2(c.commissionPerLotPerSide * lots * 2);
  if (c.swap) { out.swapBuy = round2(c.swap.longPerLot * lots); out.swapSell = round2(c.swap.shortPerLot * lots); }
  let rate: number | null = null;
  if (pair.base === "USD") rate = 1;
  else if (quotes) { try { rate = usdPerUnit(quotes, pair.base); } catch { rate = null; } }
  if (rate !== null && Number.isFinite(rate) && rate > 0) {
    out.margin = round2((lots * c.contractSize * rate) / c.leverage);
    out.marginSource = pair.base === "USD" ? "contract" : "server";
    if (typeof freeMargin === "number" && Number.isFinite(freeMargin)) {
      out.freeMarginAfter = round2(freeMargin - out.margin);
      out.notEnoughMargin = out.margin > freeMargin;
    }
  }
  return out;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayName = (d: number) => DAYS[d] ?? "";

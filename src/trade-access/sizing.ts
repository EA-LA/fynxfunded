import { usdPerUnit } from "@/engine/core";
import type { QuoteBook } from "@/engine/types";
import { CONTRACT_SIZE, LOT_MAX, LOT_MIN, LOT_STEP, type ForexPair } from "./instruments";

/**
 * "Size by risk" for the order ticket: how many lots make a stop loss cost a
 * chosen amount. Pip values come from the contract alone for pairs quoted in
 * US dollars, and from the trading server's own prices (the same conversion the
 * engine uses for profit and loss) for every other pair. Nothing is guessed:
 * without a server price for the conversion the result is null.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PipValue {
  /** US dollars per pip for 1.00 lot. */
  perLot: number;
  /** "contract" for USD-quoted pairs, "server" when converted with the trading server's prices. */
  source: "contract" | "server";
  /** The conversion used, e.g. "USDJPY 150.255 (mid)". Only for server conversions. */
  via?: string;
}

/** Dollars per pip for one lot of `pair`, or null when no server price can convert it. */
export function pipValuePerLot(pair: Pick<ForexPair, "quote" | "pipSize">, quotes?: QuoteBook | null): PipValue | null {
  const raw = CONTRACT_SIZE * pair.pipSize;
  if (pair.quote === "USD") return { perLot: round2(raw), source: "contract" };
  if (!quotes) return null;
  try {
    const rate = usdPerUnit(quotes, pair.quote);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const direct = quotes[`${pair.quote}USD`], inverse = quotes[`USD${pair.quote}`];
    const used = direct ? `${pair.quote}USD` : `USD${pair.quote}`;
    const q = direct ?? inverse!;
    return { perLot: raw * rate, source: "server", via: `${used} ${Number(((q.bid + q.ask) / 2).toPrecision(6))} (mid)` };
  } catch {
    return null;
  }
}

export type RiskMode = "percent" | "usd";

export const RISK_PERCENT_MAX = 10;

/** Reads the risk box. Percent: 0.01–10 % of the balance. Dollars: more than 0 and at most the balance. */
export function parseRisk(text: string, mode: RiskMode, balance: number | null | undefined): { ok: true; usd: number | null } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: true, usd: null };
  const n = Number(t.replace(",", ".").replace(/[%$]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: mode === "percent" ? "Type the risk as a percentage, for example 0.5." : "Type the risk in dollars, for example 50." };
  if (!balance || !Number.isFinite(balance) || balance <= 0) return { ok: false, error: "The account balance isn’t known yet, so the risk can’t be worked out." };
  if (mode === "percent") {
    if (n < 0.01) return { ok: false, error: "The smallest risk is 0.01% of the balance." };
    if (n > RISK_PERCENT_MAX) return { ok: false, error: `Risk is limited to ${RISK_PERCENT_MAX}% of the balance per trade here.` };
    return { ok: true, usd: round2((balance * n) / 100) };
  }
  if (n > balance) return { ok: false, error: "The risk can’t be more than the whole balance." };
  return { ok: true, usd: round2(n) };
}

export interface RiskSize {
  /** Lots on the 0.01 step, rounded down so the stop never costs more than asked. Null when even 0.01 lots would cost more. */
  lots: number | null;
  /** What the stop would cost at `lots`, before commission and spread. */
  riskAtLots: number | null;
  /** What 0.01 lots would cost at this stop. */
  minLotRisk: number;
  /** True when the answer was cut to the ticket's maximum volume. */
  capped: boolean;
}

/** Lots for a dollar risk and a stop distance in pips. */
export function lotsForRisk(riskUsd: number, slPips: number, perLot: number): RiskSize | null {
  if (!(riskUsd > 0) || !(slPips > 0) || !(perLot > 0)) return null;
  const perLotAtStop = perLot * slPips;
  const steps = Math.floor((riskUsd / perLotAtStop / LOT_STEP) + 1e-9);
  const minLotRisk = round2(perLotAtStop * LOT_MIN);
  if (steps * LOT_STEP < LOT_MIN) return { lots: null, riskAtLots: null, minLotRisk, capped: false };
  const raw = Math.round(steps * LOT_STEP * 100) / 100;
  const lots = Math.min(raw, LOT_MAX);
  return { lots, riskAtLots: round2(perLotAtStop * lots), minLotRisk, capped: raw > LOT_MAX };
}

export interface RiskWarning { level: "info" | "warn" | "stop"; text: string }

/**
 * Plain warnings for a dollar risk against the account's limits: the room left
 * before the closer loss limit (from the trading server) and today's daily
 * loss allowance.
 */
export function riskWarnings(riskUsd: number, opts: { roomToFloor?: number | null; dailyLossAmount?: number | null }): RiskWarning[] {
  const out: RiskWarning[] = [];
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (opts.roomToFloor !== null && opts.roomToFloor !== undefined && Number.isFinite(opts.roomToFloor)) {
    if (riskUsd >= opts.roomToFloor) out.push({ level: "stop", text: `A loss of ${money(riskUsd)} would reach your loss limit: only ${money(Math.max(0, opts.roomToFloor))} of equity is left before the account closes.` });
    else if (riskUsd >= opts.roomToFloor * 0.5) out.push({ level: "warn", text: `This uses ${Math.round((riskUsd / opts.roomToFloor) * 100)}% of the ${money(opts.roomToFloor)} left before your loss limit.` });
  } else if (opts.dailyLossAmount && opts.dailyLossAmount > 0 && riskUsd >= opts.dailyLossAmount) {
    out.push({ level: "stop", text: `A loss of ${money(riskUsd)} is more than your whole daily loss allowance (${money(opts.dailyLossAmount)}).` });
  }
  return out;
}

import Decimal from "decimal.js";
import type { PendingOrder, Position } from "./types";

/**
 * FYNX trading engine: the optional "open exposure" limits.
 *
 * Some account agreements cap how much an account may have in the market at
 * once: at most N lots open together (`max_open_lots`) and/or at most N trades
 * open together (`max_open_trades`). When an account's purchased rules carry
 * either limit, the engine refuses an order that would take the account past
 * it (`exposure_limit`, nothing is sent).
 *
 * What counts: every open trade, plus every pending order still waiting, so a
 * waiting order keeps its place and can always fill (fills are never refused
 * for this rule). Two pending orders linked as "one cancels the other" count
 * once, at the larger of the two volumes, because only one of them can ever
 * open. Closing, partly closing and cancelling always work, and an order that
 * does not add to a measure is never refused for it (so lowering a limit later
 * never traps an account).
 *
 * Pure: no clock, no I/O. The server and the terminal use the same functions.
 */

export const OPEN_LOTS_MIN = 0.01;
export const OPEN_LOTS_MAX = 10_000;
export const OPEN_TRADES_MIN = 1;
export const OPEN_TRADES_MAX = 500;

export interface ExposureLimits {
  /** Most lots open at once (open trades + waiting orders). Missing = no limit. */
  maxOpenLots?: number;
  /** Most trades open at once (open trades + waiting orders). Missing = no limit. */
  maxOpenTrades?: number;
}

export interface ExposureUse {
  /** Lots of open trades plus waiting orders (an OCO pair counts once, at its larger leg). */
  lots: number;
  /** Open trades plus waiting orders (an OCO pair counts once). */
  trades: number;
}

export const validOpenLots = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= OPEN_LOTS_MIN && v <= OPEN_LOTS_MAX && new Decimal(v).times(100).isInteger();

export const validOpenTrades = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= OPEN_TRADES_MIN && v <= OPEN_TRADES_MAX;

/** Only the valid limits, or null when the account has none. */
export function exposureLimits(src: { maxOpenLots?: unknown; maxOpenTrades?: unknown } | null | undefined): ExposureLimits | null {
  if (!src) return null;
  const out: ExposureLimits = {};
  if (validOpenLots(src.maxOpenLots)) out.maxOpenLots = src.maxOpenLots;
  if (validOpenTrades(src.maxOpenTrades)) out.maxOpenTrades = src.maxOpenTrades;
  return out.maxOpenLots !== undefined || out.maxOpenTrades !== undefined ? out : null;
}

/** The parts of an account the limits look at. */
export interface ExposureState {
  positions: readonly Pick<Position, "lots">[];
  orders: readonly Pick<PendingOrder, "id" | "lots" | "ocoWith">[];
}

/** How much of the account is in the market right now (see the module note). */
export function exposureUse(state: ExposureState): ExposureUse {
  let lots = new Decimal(0), trades = 0;
  for (const p of state.positions) { lots = lots.plus(p.lots); trades += 1; }
  const byId = new Map(state.orders.map(o => [o.id, o]));
  const counted = new Set<string>();
  for (const o of state.orders) {
    if (counted.has(o.id)) continue;
    counted.add(o.id);
    const partner = o.ocoWith !== undefined ? byId.get(o.ocoWith) : undefined;
    // Only a pair that points at each other counts as one.
    if (partner && partner.ocoWith === o.id && !counted.has(partner.id)) {
      counted.add(partner.id);
      lots = lots.plus(Decimal.max(o.lots, partner.lots));
    } else {
      lots = lots.plus(o.lots);
    }
    trades += 1;
  }
  return { lots: lots.toDecimalPlaces(2).toNumber(), trades };
}

export interface ExposureBreach {
  measure: "lots" | "trades";
  limit: number;
  before: number;
  after: number;
  message: string;
}

const lotsText = (n: number) => `${n.toFixed(2)} lot${n === 1 ? "" : "s"}`;
const tradesText = (n: number) => `${n} trade${n === 1 ? "" : "s"}`;

/**
 * The first limit an account change would break, or null. A measure that does
 * not grow is never a breach, even when it is already above a (lowered) limit.
 */
export function exposureBreach(before: ExposureUse, after: ExposureUse, limits: ExposureLimits | null | undefined): ExposureBreach | null {
  if (!limits) return null;
  const { maxOpenLots: lotCap, maxOpenTrades: tradeCap } = limits;
  if (lotCap !== undefined && after.lots > before.lots && after.lots > lotCap) {
    const room = Math.max(0, new Decimal(lotCap).minus(before.lots).toNumber());
    return {
      measure: "lots", limit: lotCap, before: before.lots, after: after.lots,
      message: `This account allows at most ${lotsText(lotCap)} open at once (open trades and waiting orders together). You have ${lotsText(before.lots)}; this would make ${lotsText(after.lots)}${room > 0 ? `, so the most you can add now is ${lotsText(room)}` : ""}. Nothing was sent.`,
    };
  }
  if (tradeCap !== undefined && after.trades > before.trades && after.trades > tradeCap) {
    return {
      measure: "trades", limit: tradeCap, before: before.trades, after: after.trades,
      message: `This account allows at most ${tradesText(tradeCap)} open at once (open trades and waiting orders together), and you have ${tradesText(before.trades)}. Close a trade or cancel a waiting order first. Nothing was sent.`,
    };
  }
  return null;
}

/** Breach check for an account state before and after a change (the engine's own use). */
export function stateExposureBreach(before: ExposureState, after: ExposureState, limits: ExposureLimits | null | undefined): ExposureBreach | null {
  if (!limits) return null;
  return exposureBreach(exposureUse(before), exposureUse(after), limits);
}

/** One line for the terminal's Account tab rules list. */
export function exposureRuleText(limits: ExposureLimits): string {
  const parts = [
    limits.maxOpenLots !== undefined ? `up to ${lotsText(limits.maxOpenLots)}` : "",
    limits.maxOpenTrades !== undefined ? `up to ${tradesText(limits.maxOpenTrades)}` : "",
  ].filter(Boolean);
  return `${parts.join(" and ")} open at once (waiting orders count; a linked pair counts once)`;
}

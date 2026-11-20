import Decimal from "decimal.js";
import type { InstrumentSpec, Quote } from "./types";

/**
 * Spread markup ("pricing") per instrument, an owner/broker decision.
 *
 * Many prop firms and brokers do not pass the liquidity provider's price on
 * unchanged: they add a fixed markup to the spread, or guarantee a minimum
 * spread. This module lets the owner set that once on the engine host
 * (FYNX_ENGINE_SPREAD, see config.ts) so every part of the engine uses the
 * same price: fills, pending-order triggers, stop loss / take profit, loss
 * limits, the prices in the terminal and the published trading conditions.
 *
 *  - `markupPips` (0–20, steps of 0.1): added to the provider's spread.
 *  - `minSpreadPips` (0–50, steps of 0.1): the spread is never narrower.
 *
 * The middle of the provider's price is kept; half the extra spread goes to
 * each side (bid lower, ask higher), rounded to the instrument's price step
 * away from the middle, so the spread is never narrower than set. A pair
 * without a rule (and every pair today) uses the provider's price unchanged.
 */
export interface SpreadRule {
  markupPips?: number;
  minSpreadPips?: number;
}

export const SPREAD_MARKUP_MAX_PIPS = 20;
export const SPREAD_MIN_MAX_PIPS = 50;

const tenth = (n: number) => Number.isFinite(n) && Math.abs(Math.round(n * 10) - n * 10) < 1e-9;

/** A plain problem with the rule, or null when it is valid. */
export function spreadRuleProblem(rule: unknown): string | null {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return "must be an object like {\"markupPips\":0.3} or {\"minSpreadPips\":0.5}";
  const r = rule as Record<string, unknown>;
  const keys = Object.keys(r);
  if (!keys.length) return "needs markupPips and/or minSpreadPips";
  const extra = keys.find(k => k !== "markupPips" && k !== "minSpreadPips");
  if (extra) return `has an unknown field "${extra}" (only markupPips and minSpreadPips)`;
  if (r.markupPips !== undefined && !(typeof r.markupPips === "number" && tenth(r.markupPips) && r.markupPips >= 0 && r.markupPips <= SPREAD_MARKUP_MAX_PIPS)) return `markupPips must be 0 to ${SPREAD_MARKUP_MAX_PIPS} pips in steps of 0.1`;
  if (r.minSpreadPips !== undefined && !(typeof r.minSpreadPips === "number" && tenth(r.minSpreadPips) && r.minSpreadPips >= 0 && r.minSpreadPips <= SPREAD_MIN_MAX_PIPS)) return `minSpreadPips must be 0 to ${SPREAD_MIN_MAX_PIPS} pips in steps of 0.1`;
  return null;
}

/** Drops zero values; null when the rule changes nothing. */
export function normalSpreadRule(rule: SpreadRule): SpreadRule | null {
  const out: SpreadRule = {
    ...(rule.markupPips ? { markupPips: rule.markupPips } : {}),
    ...(rule.minSpreadPips ? { minSpreadPips: rule.minSpreadPips } : {}),
  };
  return out.markupPips || out.minSpreadPips ? out : null;
}

/** The rule for one symbol from a settings map: its own entry, otherwise "*" (all pairs). */
export function spreadRuleFor(map: Record<string, SpreadRule> | undefined, symbol: string): SpreadRule | null {
  if (!map) return null;
  const r = symbol in map ? map[symbol] : map["*"];
  return r ? normalSpreadRule(r) : null;
}

/** Spread in pips (one decimal) the trader gets for a provider spread under a rule. */
export function traderSpreadPips(providerPips: number, rule: SpreadRule | null | undefined): number {
  const raw = new Decimal(providerPips);
  if (!rule) return raw.toDecimalPlaces(1).toNumber();
  const wanted = Decimal.max(raw.plus(rule.markupPips ?? 0), rule.minSpreadPips ?? 0);
  return wanted.toDecimalPlaces(1).toNumber();
}

/**
 * The price traders get: the provider's quote with the instrument's spread
 * rule applied. Returns the same object when there is no rule or nothing to
 * change (e.g. the provider's spread is already wider than the minimum).
 */
export function applySpread(q: Quote, spec: Pick<InstrumentSpec, "pipSize" | "tickSize"> & { spread?: SpreadRule }): Quote {
  const rule = spec.spread ? normalSpreadRule(spec.spread) : null;
  if (!rule) return q;
  const bid = new Decimal(q.bid), ask = new Decimal(q.ask), pip = new Decimal(spec.pipSize);
  const raw = ask.minus(bid);
  const wanted = Decimal.max(raw.plus(pip.times(rule.markupPips ?? 0)), pip.times(rule.minSpreadPips ?? 0));
  if (wanted.lte(raw)) return q;
  const half = wanted.minus(raw).div(2);
  const tick = new Decimal(spec.tickSize > 0 ? spec.tickSize : spec.pipSize / 10);
  const newBid = bid.minus(half).div(tick).floor().times(tick);
  const newAsk = ask.plus(half).div(tick).ceil().times(tick);
  return { ...q, bid: newBid.toNumber(), ask: newAsk.toNumber() };
}

/** One plain sentence for the trader (contract specification) or the owner (readiness check). */
export function spreadRuleText(rule: SpreadRule | null | undefined): string {
  const r = rule ? normalSpreadRule(rule) : null;
  if (!r) return "The liquidity provider’s price, no markup";
  const parts = [r.markupPips ? `${r.markupPips.toFixed(1)} pip${r.markupPips === 1 ? "" : "s"} added to the provider’s spread` : "The provider’s spread", r.minSpreadPips ? `never below ${r.minSpreadPips.toFixed(1)} pips` : ""].filter(Boolean);
  return parts.join(", ");
}

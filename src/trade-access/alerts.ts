import Decimal from "decimal.js";
import type { AlertCondition, PriceAlert, Quote, TriggeredAlert } from "@/engine/types";
import type { ForexPair } from "./instruments";

/**
 * Price alerts in the terminal. The trading server keeps and checks them (on
 * the bid, like the engine's `alertHit`); this file only reads the form and
 * describes alerts in plain words. Nothing here trades.
 */

export const ALERT_NOTE_MAX = 80;

export type AlertDraft =
  | { ok: true; price: number; note?: string }
  | { ok: false; message: string };

/** Fresh enough to compare with: the same 60 s idea the terminal uses for "price now". */
const fresh = (q: Pick<Quote, "time"> | undefined, now: number) => !!q && now - q.time <= 60_000;

/**
 * Checks the alert form before anything is sent: a positive price on the
 * pair's tick size (a tenth of a pip), not already reached by the current bid,
 * a note of at most 80 characters. Empty price → a quiet "enter a price".
 */
export function readAlertDraft(pair: Pick<ForexPair, "symbol" | "pipSize" | "digits">, condition: AlertCondition, priceText: string, noteText: string, quote: Pick<Quote, "bid" | "time"> | undefined, now: number): AlertDraft {
  const text = priceText.trim().replace(",", ".");
  if (!text) return { ok: false, message: "Enter the price level." };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, message: "Use a price like 1.08500." };
  const price = Number(text);
  if (!(price > 0)) return { ok: false, message: "The price must be above zero." };
  const tick = new Decimal(pair.pipSize).div(10);
  if (!new Decimal(text).div(tick).isInteger()) return { ok: false, message: `${pair.symbol} prices go in steps of ${tick.toString()} (${pair.digits} decimals).` };
  const note = noteText.trim();
  if (note.length > ALERT_NOTE_MAX) return { ok: false, message: `Keep the note to ${ALERT_NOTE_MAX} characters.` };
  if (quote && fresh(quote, now) && (condition === "above" ? quote.bid >= price : quote.bid <= price)) {
    return { ok: false, message: `The bid is already ${condition} this level (now ${quote.bid.toFixed(pair.digits)}).` };
  }
  return { ok: true, price, ...(note ? { note } : {}) };
}

/** The side of the current bid a level is on: what an alert at that price would wait for. */
export function suggestedCondition(price: number, bid: number | undefined): AlertCondition | null {
  if (bid === undefined || !(price > 0) || price === bid) return null;
  return price > bid ? "above" : "below";
}

/** Pips between the bid and the alert level (always positive), or null without a price. */
export function pipsAway(pair: Pick<ForexPair, "pipSize">, level: number, bid: number | undefined): number | null {
  if (bid === undefined) return null;
  return Math.abs(new Decimal(level).minus(bid).div(pair.pipSize).toDecimalPlaces(1).toNumber());
}

export const conditionLabel = (c: AlertCondition) => (c === "above" ? "Bid at or above" : "Bid at or below");

/** One plain sentence for a fired alert, e.g. "EURUSD bid went above 1.08500 (1.08512)". */
export function firedSentence(a: Pick<TriggeredAlert, "symbol" | "condition" | "price" | "triggerPrice">, digits: number): string {
  return `${a.symbol} bid went ${a.condition} ${a.price.toFixed(digits)} (${a.triggerPrice.toFixed(digits)})`;
}

/** Alerts that fired and were not seen yet; `seen` is updated in place. */
export function newlyFired(fired: TriggeredAlert[] | undefined, seen: Set<string>): TriggeredAlert[] {
  const out = (fired ?? []).filter(a => !seen.has(a.id));
  out.forEach(a => seen.add(a.id));
  return out;
}

/** Waiting alerts sorted by how close the bid is (closest first); alerts without a price last. */
export function byDistance(alerts: PriceAlert[], pairs: (symbol: string) => Pick<ForexPair, "pipSize"> | undefined, bid: (symbol: string) => number | undefined): PriceAlert[] {
  const d = (a: PriceAlert) => { const p = pairs(a.symbol); const v = p ? pipsAway(p, a.price, bid(a.symbol)) : null; return v ?? Number.POSITIVE_INFINITY; };
  return [...alerts].sort((a, b) => d(a) - d(b) || a.createdAt - b.createdAt);
}

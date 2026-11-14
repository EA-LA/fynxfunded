import { FOREX_HOURS, isMarketOpen } from "@/engine/hours";
import type { CrossQuote, InstrumentKind } from "@/lib/positionSize";
import { CROSS_QUOTES } from "@/lib/positionSize";

/**
 * Forex symbols shown in the FYNX Trade terminal. Standard contract conventions
 * only (1.00 lot = 100,000 units of the first currency, pip = 0.0001, or 0.01
 * for yen and forint quotes). No prices are stored here: live prices come from
 * the display-only TradingView widgets, and orders are priced by the server.
 */

export type ForexGroup = "Majors" | "Minors" | "Exotics";

export interface ForexPair {
  symbol: string;
  base: string;
  quote: string;
  group: ForexGroup;
  /** Price step that counts as one pip. */
  pipSize: number;
  /** Decimals a broker usually quotes (one more than the pip). */
  digits: number;
  /** TradingView symbol used by the display widgets. */
  tvSymbol: string;
}

export const CONTRACT_SIZE = 100_000;

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar", EUR: "Euro", GBP: "British Pound", JPY: "Japanese Yen", CHF: "Swiss Franc", AUD: "Australian Dollar",
  CAD: "Canadian Dollar", NZD: "New Zealand Dollar", SEK: "Swedish Krona", NOK: "Norwegian Krone", DKK: "Danish Krone",
  SGD: "Singapore Dollar", HKD: "Hong Kong Dollar", ZAR: "South African Rand", MXN: "Mexican Peso", TRY: "Turkish Lira",
  PLN: "Polish Zloty", CNH: "Chinese Yuan (offshore)", HUF: "Hungarian Forint", CZK: "Czech Koruna",
};

const MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"];
const MINORS = [
  "EURGBP", "EURJPY", "EURCHF", "EURAUD", "EURCAD", "EURNZD",
  "GBPJPY", "GBPCHF", "GBPAUD", "GBPCAD", "GBPNZD",
  "AUDJPY", "AUDCHF", "AUDCAD", "AUDNZD",
  "CADJPY", "CADCHF", "CHFJPY",
  "NZDJPY", "NZDCHF", "NZDCAD",
];
const EXOTICS = [
  "USDSEK", "USDNOK", "USDDKK", "USDSGD", "USDHKD", "USDZAR", "USDMXN", "USDTRY", "USDPLN", "USDCNH", "USDHUF", "USDCZK",
  "EURTRY", "EURPLN", "EURNOK", "EURSEK", "EURHUF",
];

function pair(symbol: string, group: ForexGroup): ForexPair {
  const base = symbol.slice(0, 3), quote = symbol.slice(3);
  const pipSize = quote === "JPY" || quote === "HUF" ? 0.01 : 0.0001;
  return { symbol, base, quote, group, pipSize, digits: pipSize === 0.01 ? 3 : 5, tvSymbol: `OANDA:${symbol}` };
}

export const FOREX_PAIRS: ForexPair[] = [
  ...MAJORS.map((s) => pair(s, "Majors")),
  ...MINORS.map((s) => pair(s, "Minors")),
  ...EXOTICS.map((s) => pair(s, "Exotics")),
];

export const DEFAULT_SYMBOL = "EURUSD";
export const findPair = (symbol: string | null | undefined) => FOREX_PAIRS.find((p) => p.symbol === String(symbol ?? "").toUpperCase());
export const pairLabel = (p: ForexPair) => `${p.base}/${p.quote}`;
export const pairName = (p: ForexPair) => `${CURRENCY_NAMES[p.base] ?? p.base} / ${CURRENCY_NAMES[p.quote] ?? p.quote}`;

/** Search by symbol, "EUR/USD", or either currency's name. */
export function searchPairs(pairs: ForexPair[], query: string): ForexPair[] {
  const q = query.trim().toLowerCase().replace(/[\s/]+/g, "");
  if (!q) return pairs;
  return pairs.filter((p) => p.symbol.toLowerCase().includes(q) || pairName(p).toLowerCase().replace(/\s+/g, "").includes(q));
}

/** Kind and quote currency used by the Rules-page position size calculator. */
export function calculatorKind(p: ForexPair): { kind: InstrumentKind; quote?: CrossQuote } {
  if (p.quote === "USD") return { kind: "xxxusd" };
  if (p.symbol === "USDJPY") return { kind: "usdjpy" };
  if (p.base === "USD") return { kind: "usdxxx" };
  if (CROSS_QUOTES.some((c) => c.id === p.quote)) return { kind: "cross", quote: p.quote as CrossQuote };
  return { kind: "custom" };
}

/**
 * Dollar value of one pip for `lots`. Only exact without a price when the
 * dollar is the second currency; otherwise null (it moves with the rate).
 */
export function pipValueUsd(p: ForexPair, lots: number): number | null {
  if (p.quote !== "USD" || !Number.isFinite(lots) || lots <= 0) return null;
  return Math.round(lots * CONTRACT_SIZE * p.pipSize * 100) / 100;
}

export const LOT_MIN = 0.01;
export const LOT_STEP = 0.01;
export const LOT_MAX = 50;

/** Rounds a typed volume down to the 0.01 step within the allowed range; null when not a number. */
export function normalizeLots(value: string | number): number | null {
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const stepped = Math.floor(n / LOT_STEP + 1e-9) * LOT_STEP;
  return Math.min(LOT_MAX, Math.max(LOT_MIN, Math.round(stepped * 100) / 100));
}

/**
 * Approximate retail forex week: open from Sunday 22:00 UTC to Friday 22:00 UTC
 * (an hour earlier while the US is on daylight time). Broker hours can differ.
 */
/** Forex week (Sunday 17:00 to Friday 17:00 New York time), same schedule the trading engine enforces. */
export function forexMarketOpen(now: Date): boolean {
  return isMarketOpen(FOREX_HOURS, now.getTime());
}

const FAVORITES_KEY = "fynx-trade-favorites";
export function loadFavorites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && !!findPair(s)) : [];
  } catch { return []; }
}
export function saveFavorites(symbols: string[]) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(symbols)); } catch { /* storage unavailable */ }
}

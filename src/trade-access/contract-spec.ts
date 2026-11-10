import type { GatewayStatus } from "@/engine/gateway";
import { FOREX_HOURS, formatUtc, scheduleBetween, type Closure, type Session } from "@/engine/hours";
import type { Quote, QuoteBook } from "@/engine/types";
import type { ForexPair } from "./instruments";
import { pipValuePerLot } from "./sizing";

/**
 * Figures for the terminal's per-pair "Contract specification": the spread
 * from the trading server's own prices and the pair's trading hours for the
 * coming week. Hours come from the server's `/v1/status` `schedule` (with its
 * holiday closures) when it sends one; otherwise the standard forex week the
 * engine also uses, labelled as such. Nothing is guessed.
 */

const WEEK_MS = 7 * 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Spread {
  /** Ask minus bid in pips, one decimal. */
  pips: number;
  /** Dollars the spread costs on 1.00 lot, null when no server price can convert the pip value. */
  usdPerLot: number | null;
}

/** Spread of a live server quote; null without a valid quote. */
export function spreadOf(pair: Pick<ForexPair, "quote" | "pipSize">, quote: Pick<Quote, "bid" | "ask"> | undefined | null, quotes?: QuoteBook | null): Spread | null {
  if (!quote || !(quote.bid > 0) || !(quote.ask >= quote.bid)) return null;
  const pips = Math.round(((quote.ask - quote.bid) / pair.pipSize) * 10) / 10;
  const pv = pipValuePerLot(pair, quotes);
  return { pips, usdPerLot: pv ? round2(pips * pv.perLot) : null };
}

export interface WeekHours {
  /** "server": the trading server's schedule (with its closures); "schedule": the standard forex week. */
  source: "server" | "schedule";
  /** Open stretches that have not ended yet, in time order. */
  sessions: Session[];
  /** One-off closures (holidays, maintenance) that have not ended yet. */
  closures: Closure[];
}

/**
 * The pair's trading hours from now to a week ahead. `openNow` is the pair's
 * current open/closed state: the server cuts its first stretch at the moment it
 * answered, which can be a little after the terminal's clock, so an open
 * market's first stretch is shown as starting now.
 */
export function weekHours(status: GatewayStatus | null | undefined, symbol: string, now: number, openNow?: boolean): WeekHours {
  const s = status?.schedule?.[symbol];
  if (s) {
    const sessions = s.sessions.filter(x => x.to > now).map(x => ({ ...x }));
    if (openNow && sessions[0] && sessions[0].from > now && sessions[0].from - now <= 120_000) sessions[0].from = now;
    // An answer that only covers the past (an old status) falls back to the standard week.
    if (sessions.length || s.closures.some(c => c.to > now)) return { source: "server", sessions, closures: s.closures.filter(c => c.to > now) };
  }
  const w = scheduleBetween(FOREX_HOURS, now, now + WEEK_MS);
  return { source: "schedule", sessions: w.sessions, closures: w.closures };
}

/** Total open hours in the list (rounded to a tenth). */
export const openHours = (sessions: Session[], from: number) => Math.round(sessions.reduce((t, s) => t + (s.to - Math.max(s.from, from)), 0) / 360_000) / 10;

/** "Sun 23:00" in the viewer's time zone. */
export const localTime = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** One readable row per session: local opening/closing plus the same in UTC. */
export function sessionRows(sessions: Session[], now: number): { opens: string; closes: string; utc: string; openNow: boolean }[] {
  return sessions.map(s => ({
    opens: s.from <= now ? "Open now" : localTime(s.from),
    closes: localTime(s.to),
    utc: `${s.from <= now ? "now" : formatUtc(s.from)} – ${formatUtc(s.to)}`,
    openNow: s.from <= now && now < s.to,
  }));
}

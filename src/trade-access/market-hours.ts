import { useEffect, useState } from 'react';
import type { GatewayStatus } from '@/engine/gateway';
import { FOREX_HOURS, marketState, type MarketState } from '@/engine/hours';

export interface PairMarket extends MarketState {
  /** "server": from the trading server's hours (with holiday closures); "schedule": the standard forex week. */
  source: 'server' | 'schedule';
}

/**
 * Open/closed for one pair. Uses the trading server's answer from /v1/status
 * while it is still current (before its next change); otherwise the standard
 * forex week (Sunday 17:00 to Friday 17:00 New York), which the engine also
 * uses by default.
 */
export function pairMarket(status: GatewayStatus | null | undefined, symbol: string, now: number): PairMarket {
  const s = status?.markets?.[symbol];
  if (s && (s.nextChange === null || now < s.nextChange)) return { ...s, source: 'server' };
  return { ...marketState(FOREX_HOURS, now), source: 'schedule' };
}

/** "Sun 23:00" in the viewer's own time zone. */
export const localAt = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** "1d 4h 05m", "3h 20m", "12m". */
export function untilLabel(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d}d ${h}h ${String(min).padStart(2, '0')}m` : h ? `${h}h ${String(min).padStart(2, '0')}m` : `${min}m`;
}

/** Plain sentence for a closed pair: "The EURUSD market is closed (Christmas Day). It opens Mon 00:00 your time, in 1d 2h 00m." */
export function closedSentence(symbol: string, m: MarketState, now: number): string {
  const why = m.reason && m.reason !== 'Outside trading hours' ? ` (${m.reason})` : '';
  return `The ${symbol} market is closed${why}.${m.nextChange ? ` It opens ${localAt(m.nextChange)} your time, in ${untilLabel(m.nextChange - now)}.` : ''}`;
}

/** Current time, refreshed every `everyMs` (for countdowns and open/closed changes). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), everyMs); return () => window.clearInterval(t); }, [everyMs]);
  return now;
}

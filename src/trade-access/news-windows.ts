import type { GatewayStatus } from '@/engine/gateway';
import { activeNewsWindow, affects, type NewsWindow } from '@/engine/news';
import { untilLabel } from './market-hours';

/** How soon a coming window is announced in the order ticket and Market Watch. */
export const NEWS_SOON_MS = 60 * 60_000;

export interface PairNews {
  /** The server sent a news calendar (false: nothing is known, nothing is shown as fact). */
  connected: boolean;
  /** Windows refuse new orders (true) or are information only (false). */
  enforce: boolean;
  /** The window in force for this pair now, or null. */
  active: NewsWindow | null;
  /** Windows for this pair not yet started, soonest first (next 7 days as the server lists them). */
  upcoming: NewsWindow[];
}

/** The restricted news windows that touch this pair, from the trading server's status. */
export function pairNews(status: Pick<GatewayStatus, 'news'> | null | undefined, pair: { base: string; quote: string }, now: number): PairNews {
  const news = status?.news;
  if (!news) return { connected: false, enforce: false, active: null, upcoming: [] };
  const mine = news.windows.filter(w => w.to > now && affects(w, pair));
  return { connected: true, enforce: news.enforce, active: activeNewsWindow(mine, pair, now), upcoming: mine.filter(w => w.from > now).sort((a, b) => a.from - b.from) };
}

/** Whether a new order on this pair would be refused right now because of a window. */
export const newsBlocks = (n: PairNews) => n.enforce && !!n.active;

export function localClock(ms: number, now: number, locale?: string): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return new Date(ms).toLocaleString(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The order panel's hold sentence inside an enforced window. */
export function newsHoldSentence(w: NewsWindow, symbol: string, now: number, locale?: string): string {
  return `New ${symbol} orders are paused around ${w.title} (${w.currencies.join(', ')}) at ${localClock(w.at, now, locale)} your time. They reopen at ${localClock(w.to, now, locale)} (in ${untilLabel(w.to - now)}). Closing trades, cancelling orders and changing stop loss or take profit still work.`;
}

/** One line for a window in force now or coming soon, saying whether orders are refused. */
export function newsNoteSentence(n: PairNews, symbol: string, now: number, locale?: string): string | null {
  if (n.active) {
    return n.enforce
      ? newsHoldSentence(n.active, symbol, now, locale)
      : `High-impact release now: ${n.active.title} (${n.active.currencies.join(', ')}) at ${localClock(n.active.at, now, locale)} your time. Prices can jump and spreads widen; orders are still accepted.`;
  }
  const next = n.upcoming[0];
  if (!next || next.from - now > NEWS_SOON_MS) return null;
  return n.enforce
    ? `${next.title} (${next.currencies.join(', ')}) at ${localClock(next.at, now, locale)} your time: new ${symbol} orders are refused from ${localClock(next.from, now, locale)} to ${localClock(next.to, now, locale)} (starts in ${untilLabel(next.from - now)}).`
    : `${next.title} (${next.currencies.join(', ')}) at ${localClock(next.at, now, locale)} your time (in ${untilLabel(next.at - now)}). Prices can jump and spreads widen around it.`;
}

/** "14:28 – 14:32" style window text for lists. */
export function windowRange(w: Pick<NewsWindow, 'from' | 'to'>, now: number, locale?: string): string {
  return `${localClock(w.from, now, locale)} – ${new Date(w.to).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

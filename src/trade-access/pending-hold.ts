import type { GatewayStatus } from '@/engine/gateway';
import { activeNewsWindow } from '@/engine/news';
import { findPair } from './instruments';
import { localClock } from './news-windows';

export interface PendingHold {
  /** "paused": the owner paused new trading and holds waiting orders; "news": an enforced news window holds them on this pair; "hedge": the account allows no hedging and a trade in the other direction is open (src/trade-access/hedging.ts). */
  kind: 'paused' | 'news' | 'hedge';
  /** Short tag for the Pending orders row. */
  label: string;
  /** One plain sentence: why the order is waiting and until when. */
  text: string;
  /** When the hold is expected to end (ms), or null when not known. */
  until: number | null;
}

/**
 * Whether the trading server is holding a waiting pending order on this pair
 * right now (it stays in the book but does not fill), from GET /v1/status:
 * the owner's pause with `holdPending`, or an enforced restricted news window
 * with `holdPending` that touches the pair. Mirrors `pendingFillHold` in
 * src/engine/core.ts. Without either, null: the order can fill as usual.
 */
export function pendingHold(status: Pick<GatewayStatus, 'paused' | 'news'> | null | undefined, symbol: string, now: number, locale?: string): PendingHold | null {
  const p = status?.paused;
  if (p?.holdPending) {
    const back = p.until && p.until > now ? ` (expected back by ${localClock(p.until, now, locale)} your time)` : '';
    return { kind: 'paused', label: 'Held', until: p.until && p.until > now ? p.until : null, text: `Held: FYNX has paused new trading${back}. This order stays in place but does not fill until trading resumes; the first price after that decides the fill. You can cancel it at any time.` };
  }
  const news = status?.news, pair = findPair(symbol);
  if (!news?.enforce || !news.holdPending || !pair) return null;
  const w = activeNewsWindow(news.windows, pair, now);
  if (!w) return null;
  return { kind: 'news', label: 'Held · news', until: w.to, text: `Held around ${w.title} (${w.currencies.join(', ')}): this order does not fill until ${localClock(w.to, now, locale)} your time; the first price after that decides the fill. You can cancel it at any time.` };
}

/** The sentence about orders already waiting, for the pause banner and the news hold sentence. */
export function waitingOrdersSentence(held: boolean | undefined, where: 'pause' | 'news'): string {
  if (held) return where === 'pause' ? 'Pending orders already waiting are held too and fill only after trading resumes.' : 'Pending orders already waiting on this pair are held until the window ends.';
  return 'Pending orders already waiting can still fill at their price; cancel any you no longer want.';
}

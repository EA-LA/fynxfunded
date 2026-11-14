import type { PausedStatus } from '@/engine/gateway';

/** "Expected back by Tue 14:00 (your time)" for a pause with an end, or ''. */
export function pausedUntilText(p: Pick<PausedStatus, 'until'>, now: number, locale?: string): string {
  if (!p.until || p.until <= now) return '';
  const sameDay = new Date(p.until).toDateString() === new Date(now).toDateString();
  const at = new Date(p.until).toLocaleString(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `Expected back by ${at} (your time).`;
}

/** The order panel's hold sentence while the server has paused new trading. */
export function pausedSentence(p: PausedStatus, now: number, locale?: string): string {
  const back = pausedUntilText(p, now, locale);
  return `New trading is paused by FYNX: ${p.reason}${back ? ` ${back}` : ''} Closing trades and cancelling orders still work.`;
}

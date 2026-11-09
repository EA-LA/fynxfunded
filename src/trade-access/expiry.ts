import { EXPIRY_MAX_MS, EXPIRY_MIN_MS, tradingDayEnd } from '@/engine/core';
import { untilLabel } from './market-hours';

/** FYNX accounts reset (and the "Today" expiry ends) at 22:00 UTC. */
export const DAILY_RESET_HOUR_UTC = 22;

/**
 * How long a pending order stays: until the trader cancels it, until the end
 * of the current trading day (the 22:00 UTC reset), or until a chosen local
 * date and time.
 */
export type ExpiryChoice = 'gtc' | 'today' | 'date';

export type ExpiryField = { ok: true; value: number | null } | { ok: false; error: string };

/** "2026-11-04T15:30" for a datetime-local input, in the viewer's own time zone. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Reads a datetime-local value ("YYYY-MM-DDTHH:mm", local time); null when it is not one. */
export function fromLocalInput(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const at = new Date(y, mo - 1, d, h, mi).getTime();
  // Reject dates the browser rolled over (e.g. 31 February) or skipped (clock change).
  const back = new Date(at);
  return back.getFullYear() === y && back.getMonth() === mo - 1 && back.getDate() === d && back.getHours() === h && back.getMinutes() === mi ? at : null;
}

/**
 * The expiry time to send for a choice, with the same limits as the engine
 * (at least a minute ahead, at most 366 days). null = good till cancelled.
 */
export function expiryValue(choice: ExpiryChoice, dateText: string, now: number, resetHourUtc = DAILY_RESET_HOUR_UTC): ExpiryField {
  if (choice === 'gtc') return { ok: true, value: null };
  const at = choice === 'today' ? tradingDayEnd(now, resetHourUtc) : fromLocalInput(dateText);
  if (at === null) return { ok: false, error: 'Expiry: pick a date and a time.' };
  if (at < now + EXPIRY_MIN_MS) return { ok: false, error: choice === 'today' ? 'The trading day ends in less than a minute: pick a date and time or Good till cancelled.' : 'Expiry: pick a time at least one minute from now.' };
  if (at > now + EXPIRY_MAX_MS) return { ok: false, error: 'Expiry: pick a time within 366 days.' };
  return { ok: true, value: at };
}

/** "Wed, Nov 4, 23:00" in the viewer's own time zone. */
export const expiryAt = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "Wed, Nov 4, 23:00 (in 13h 00m)", or "Good till cancelled". */
export function expiryLabel(expiresAt: number | undefined | null, now: number): string {
  if (expiresAt === undefined || expiresAt === null) return 'Good till cancelled';
  return expiresAt > now ? `${expiryAt(expiresAt)} (in ${untilLabel(expiresAt - now)})` : `${expiryAt(expiresAt)} (due now)`;
}

/** The choice that describes an existing expiry, for editors. */
export function choiceFor(expiresAt: number | undefined, now: number, resetHourUtc = DAILY_RESET_HOUR_UTC): ExpiryChoice {
  if (expiresAt === undefined) return 'gtc';
  return expiresAt === tradingDayEnd(now, resetHourUtc) ? 'today' : 'date';
}

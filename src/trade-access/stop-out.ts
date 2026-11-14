import { validStopOut } from '@/engine/stop-out';

/** The account's margin stop-out level (percent) from the trading server's snapshot, or null (no stop out or unknown). */
export function stopOutRule(snapshot: { stopOut?: { level?: unknown } } | null | undefined): number | null {
  const level = snapshot?.stopOut?.level;
  return validStopOut(level) ? level : null;
}

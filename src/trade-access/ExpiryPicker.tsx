import { expiryAt, expiryValue, toLocalInput, type ExpiryChoice } from './expiry';
import { untilLabel } from './market-hours';

/**
 * Expiry of a pending order: Good till cancelled, end of today's trading day
 * (22:00 UTC) or a date and time in the viewer's own time zone. Shows when
 * the order would be removed and any problem with the value.
 */
export default function ExpiryPicker({ id, choice, onChoice, dateText, onDateText, now, className = '' }: {
  id: string; choice: ExpiryChoice; onChoice: (c: ExpiryChoice) => void; dateText: string; onDateText: (v: string) => void; now: number; className?: string;
}) {
  const field = expiryValue(choice, dateText, now);
  const pick = (c: ExpiryChoice) => {
    // Start a new date from "tomorrow, same time" so the field is never empty.
    if (c === 'date' && !dateText) onDateText(toLocalInput(now + 86_400_000));
    onChoice(c);
  };
  return <div className={className}>
    <label htmlFor={`${id}-expiry`} className="text-xs text-muted-foreground">Expiry</label>
    <select id={`${id}-expiry`} value={choice} onChange={e => pick(e.target.value as ExpiryChoice)} aria-describedby={`${id}-expiry-help`} className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
      <option value="gtc">Good till cancelled</option>
      <option value="today">End of today's trading day</option>
      <option value="date">Date and time</option>
    </select>
    {choice === 'date' && <>
      <label htmlFor={`${id}-expiry-date`} className="sr-only">Expiry date and time (your time)</label>
      <input id={`${id}-expiry-date`} type="datetime-local" value={dateText} min={toLocalInput(now + 60_000)} onChange={e => onDateText(e.target.value)} aria-invalid={!field.ok} aria-describedby={`${id}-expiry-help`} className="mt-1 w-full min-w-0 rounded-md border bg-background px-2.5 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />
    </>}
    <p id={`${id}-expiry-help`} data-testid={`${id}-expiry-help`} className={`mt-1 text-[11px] ${field.ok ? 'text-muted-foreground' : 'text-red-500'}`}>
      {'error' in field ? field.error
        : field.value === null ? 'Stays until it fills or you cancel it.'
        : `If it has not filled by ${expiryAt(field.value)} your time (in ${untilLabel(field.value - now)}), the trading server cancels it, even with this page closed.`}
    </p>
  </div>;
}

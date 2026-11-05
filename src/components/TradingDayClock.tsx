import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Clock3, Search } from "lucide-react";
import { DAILY_RESET_UTC_HOUR } from "@/lib/ruleCalculator";
import {
  JOURNAL_SESSION_BANDS,
  RESET_REMINDER_OPTIONS,
  dailyResetIcs,
  formatCountdown,
  journalSessionForUtcHour,
  parseLocalDateTime,
  toLocalInputValue,
  tradingDayStatus,
  utcHourOfDay,
  utcOffsetLabel,
  type ResetReminder,
} from "@/lib/tradingDayClock";

function downloadResetIcs(reminder: ResetReminder) {
  const blob = new Blob([dailyResetIcs(new Date(), reminder)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fynx-daily-reset.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const BAND_TONE: Record<string, string> = { Asia: "bg-foreground/10", London: "bg-foreground/20", "New York": "bg-foreground/30" };

const fmt = (opts: Intl.DateTimeFormatOptions, timeZone?: string) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone });
const timeOf = (d: Date, timeZone?: string, seconds = false) =>
  fmt({ hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23" }, timeZone).format(d);
const dayTime = (d: Date, timeZone?: string) =>
  fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, timeZone).format(d);

/** Visitor's time zone name, e.g. "Europe/London". */
const zoneName = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "your time zone"; } catch { return "your time zone"; }
};

/**
 * Live clock for the 22:00 UTC daily reset, with the journal's session
 * labels shown in the visitor's own time and a "check a time" lookup.
 * Rendered only in the browser so prerendered pages never show a stale time.
 */
export default function TradingDayClock({ now: fixedNow }: { now?: Date }) {
  const [now, setNow] = useState<Date | null>(fixedNow ?? null);
  const [checkValue, setCheckValue] = useState(() => (fixedNow ? toLocalInputValue(fixedNow) : ""));
  const [reminder, setReminder] = useState<ResetReminder>(15);

  useEffect(() => {
    if (fixedNow) return;
    const tick = () => setNow(new Date());
    tick();
    setCheckValue(v => v || toLocalInputValue(new Date()));
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [fixedNow]);

  const checked = useMemo(() => {
    const at = parseLocalDateTime(checkValue);
    return at ? { at, status: tradingDayStatus(at) } : null;
  }, [checkValue]);

  if (!now) return <div id="trading-day" className="premium-card mb-8 min-h-[420px] scroll-mt-28" aria-hidden="true" />;

  const status = tradingDayStatus(now);
  const zone = zoneName();
  const offset = utcOffsetLabel(now);
  const nowPos = (utcHourOfDay(now) / 24) * 100;
  const resetPos = (DAILY_RESET_UTC_HOUR / 24) * 100;
  const bandDate = (hour: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));

  return (
    <section id="trading-day" aria-labelledby="trading-day-title" className="premium-card mb-8 scroll-mt-28" data-testid="trading-day-clock">
      <div className="flex items-start gap-3">
        <Clock3 size={20} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground" />
        <div>
          <h2 id="trading-day-title" className="text-lg font-semibold">Trading-day clock</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The daily loss floor resets at {DAILY_RESET_UTC_HOUR}:00 UTC every day, with no daylight-saving change. See when that is where you are, and how long is left today.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground">Now in UTC</p>
          <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="clock-utc">{timeOf(now, "UTC", true)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{fmt({ weekday: "long", day: "numeric", month: "long" }, "UTC").format(now)}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground">Your time ({offset})</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{timeOf(now, undefined, true)}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={zone}>{zone}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground">Next daily reset in</p>
          <p className="mt-1 text-2xl font-bold tabular-nums" aria-live="off" data-testid="clock-countdown">{formatCountdown(status.msUntilReset)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{dayTime(status.periodEnd)} your time</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border p-3" data-testid="reset-calendar">
        <button type="button" onClick={() => downloadResetIcs(reminder)}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CalendarPlus size={16} aria-hidden="true" /> Add the daily reset to my calendar
        </button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Reminder
          <select value={reminder} onChange={e => setReminder(Number(e.target.value) as ResetReminder)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
            {RESET_REMINDER_OPTIONS.map(m => <option key={m} value={m}>{m === 0 ? "No reminder" : m === 60 ? "1 hour before" : `${m} minutes before`}</option>)}
          </select>
        </label>
        <p className="w-full text-xs text-muted-foreground">One event that repeats every day at {DAILY_RESET_UTC_HOUR}:00 UTC ({timeOf(status.periodEnd)} your time). Works with Google, Apple and Outlook calendars and stays correct when clocks change.</p>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>Today in UTC</span>
          <span>{Math.round(status.elapsed * 100)}% of this trading day has passed</span>
        </div>
        <div className="relative mt-2 h-10 overflow-hidden rounded-md border border-border" role="img"
          aria-label={`24-hour UTC day. Journal sessions: Asia 00:00 to 08:00, London 08:00 to 13:00, New York 13:00 to 24:00. Daily reset at ${DAILY_RESET_UTC_HOUR}:00. Current time ${timeOf(now, "UTC")} UTC.`}>
          {JOURNAL_SESSION_BANDS.map(b => (
            <div key={b.session} className={`absolute inset-y-0 ${BAND_TONE[b.session]} flex items-center justify-center text-[11px] font-medium`}
              style={{ left: `${(b.fromHour / 24) * 100}%`, width: `${((b.toHour - b.fromHour) / 24) * 100}%` }}>
              <span className="truncate px-1">{b.session}</span>
            </div>
          ))}
          <div className="absolute inset-y-0 w-0.5 bg-destructive" style={{ left: `${resetPos}%` }} aria-hidden="true" />
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${nowPos}%` }} aria-hidden="true" data-testid="clock-now-marker" />
        </div>
        <div className="relative mt-1 h-4 text-[10px] text-muted-foreground" aria-hidden="true">
          {[0, 6, 12, 18].map(h => <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}:00</span>)}
          <span className="absolute -translate-x-1/2 font-semibold text-destructive" style={{ left: `${resetPos}%` }}>reset</span>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span><span className="mr-1 inline-block h-2.5 w-0.5 bg-foreground align-middle" />Now</span>
          <span><span className="mr-1 inline-block h-2.5 w-0.5 bg-destructive align-middle" />Daily reset ({DAILY_RESET_UTC_HOUR}:00 UTC)</span>
        </p>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-sm font-semibold">Journal session labels in your time</caption>
          <thead><tr className="text-xs text-muted-foreground"><th className="p-2 font-medium">Label</th><th className="p-2 font-medium">UTC</th><th className="p-2 font-medium">Your time ({offset})</th></tr></thead>
          <tbody>
            {JOURNAL_SESSION_BANDS.map(b => (
              <tr key={b.session} className={status.session === b.session ? "bg-secondary/60" : undefined}>
                <td className="p-2 font-medium">{b.session}{status.session === b.session && <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background">now</span>}</td>
                <td className="p-2 tabular-nums">{String(b.fromHour).padStart(2, "0")}:00 – {b.toHour === 24 ? "24:00" : `${String(b.toHour).padStart(2, "0")}:00`}</td>
                <td className="p-2 tabular-nums">{timeOf(bandDate(b.fromHour))} – {timeOf(bandDate(b.toHour))}</td>
              </tr>
            ))}
            <tr><td className="p-2 font-medium">Daily reset</td><td className="p-2 tabular-nums">{DAILY_RESET_UTC_HOUR}:00</td><td className="p-2 tabular-nums">{timeOf(bandDate(DAILY_RESET_UTC_HOUR))}</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          These labels are how the <Link to="/dashboard/analytics" className="underline underline-offset-2">dashboard</Link> groups your trades by the hour they were opened. They are not market or broker trading hours, which are still pending broker verification.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <label htmlFor="trading-day-check" className="flex items-center gap-2 text-sm font-semibold">
          <Search size={15} aria-hidden="true" /> Check a time
        </label>
        <p className="mt-1 text-xs text-muted-foreground">Pick a date and time in your own time zone to see which daily-floor period it falls in.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input id="trading-day-check" type="datetime-local" value={checkValue} onChange={e => setCheckValue(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30" />
          <button type="button" onClick={() => setCheckValue(toLocalInputValue(new Date()))}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Now</button>
        </div>
        {checked ? (
          <div className="mt-4" aria-live="polite" data-testid="clock-check-result">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">In UTC</dt><dd className="mt-0.5 font-medium tabular-nums">{dayTime(checked.at, "UTC")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Journal label</dt><dd className="mt-0.5 font-medium">{journalSessionForUtcHour(checked.at.getUTCHours())}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Counts against the floor set at</dt><dd className="mt-0.5 font-medium tabular-nums">{dayTime(checked.status.periodStart, "UTC")} UTC</dd></div>
          </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              That daily-floor period runs from {dayTime(checked.status.periodStart)} to {dayTime(checked.status.periodEnd)} your time; the next reset comes {formatCountdown(checked.status.msUntilReset)} after the time you picked.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground" role="status">Enter a full date and time to check it.</p>
        )}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { formatDay, formatRange, payoutWindowStatus, payoutWindowsIcs, type PayoutWindow } from "@/lib/payoutCalendar";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function downloadIcs(windows: PayoutWindow[]) {
  const blob = new Blob([payoutWindowsIcs(windows, new Date())], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fynx-payout-windows.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Live "next request window" card based on today's date in UTC. */
export default function NextPayoutWindow({ now, className = "mb-8" }: { now?: Date; className?: string }) {
  // Work out the date in the browser so prerendered pages never show a stale window.
  const [today, setToday] = useState<Date | null>(now ?? null);
  useEffect(() => {
    if (!now) setToday(new Date());
  }, [now]);

  if (!today) return <div className={`premium-card min-h-[204px] ${className}`} aria-hidden="true" />;

  const status = payoutWindowStatus(today);
  const { window: w, following } = status;

  return (
    <div className={`premium-card ${className}`} data-testid="next-payout-window">
      <div className="flex items-start gap-4">
        <CalendarClock size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {status.open ? "Request window open now" : "Next request window"}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatRange(w.requestStart, w.requestEnd)}</p>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {status.open
              ? `${plural(status.daysLeft, "day")} left including today (last day ${formatDay(w.requestEnd)}, UTC).`
              : `Opens in ${plural(status.daysUntilOpen, "day")}.`}{" "}
            Approved requests from this window are scheduled for {formatRange(w.payoutStart, w.payoutEnd)}.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            After that: requests {formatRange(following.requestStart, following.requestEnd)}, paid {formatRange(following.payoutStart, following.payoutEnd)}. Dates are in UTC. Eligibility and the final payment date are confirmed when your request is reviewed.
          </p>
          <button
            type="button"
            onClick={() => downloadIcs([w, following])}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarPlus size={16} aria-hidden="true" /> Add both windows to my calendar
          </button>
        </div>
      </div>
    </div>
  );
}

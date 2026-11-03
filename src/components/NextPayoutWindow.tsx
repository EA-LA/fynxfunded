import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { formatDay, formatRange, payoutWindowStatus } from "@/lib/payoutCalendar";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Live "next request window" card based on today's date in UTC. */
export default function NextPayoutWindow({ now }: { now?: Date }) {
  // Work out the date in the browser so prerendered pages never show a stale window.
  const [today, setToday] = useState<Date | null>(now ?? null);
  useEffect(() => {
    if (!now) setToday(new Date());
  }, [now]);

  if (!today) return <div className="premium-card mb-8 min-h-[148px]" aria-hidden="true" />;

  const status = payoutWindowStatus(today);
  const { window: w, following } = status;

  return (
    <div className="premium-card mb-8" data-testid="next-payout-window">
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
        </div>
      </div>
    </div>
  );
}

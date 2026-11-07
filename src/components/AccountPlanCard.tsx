import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Calculator, Check, Clock, Dices, Gauge, Ruler, Target } from "lucide-react";
import GlossaryTip from "@/components/GlossaryTip";
import { accountPlanFor, type PurchasedChallenge } from "@/lib/accountPlan";
import { formatCountdown, tradingDayStatus } from "@/lib/tradingDayClock";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const linkClass = "inline-flex items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Live countdown to the 22:00 UTC daily reset, worked out in the browser. */
export function TradingDayStrip({ now }: { now?: Date }) {
  const [time, setTime] = useState<Date | null>(now ?? null);
  useEffect(() => {
    if (now) return;
    setTime(new Date());
    const id = window.setInterval(() => setTime(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [now]);
  if (!time) return <div className="min-h-[60px] rounded-lg bg-secondary/40" aria-hidden="true" />;
  const status = tradingDayStatus(time);
  const resetLocal = status.periodEnd.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary/40 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="trading-day-strip">
      <div className="flex items-start gap-3">
        <Clock size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm">
          <span className="font-semibold">This <GlossaryTip term="trading-day">trading day</GlossaryTip> ends in {formatCountdown(status.msUntilReset)}</span>
          <span className="text-muted-foreground"> · reset at 22:00 UTC ({resetLocal} your time). The daily loss limit then restarts from your balance at the reset.</span>
        </p>
      </div>
      <div className="h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-secondary sm:w-32" role="img" aria-label={`${Math.round(status.elapsed * 100)}% of this trading day has passed`}>
        <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.round(status.elapsed * 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * Dashboard home: the purchased plan's published rules in dollars, where the
 * account is on its path, today's reset and tools preloaded for this account.
 */
export default function AccountPlanCard({ challenge, now }: { challenge: PurchasedChallenge; now?: Date }) {
  const view = accountPlanFor(challenge);
  if (!view) {
    return (
      <div className="premium-card" data-testid="account-plan-card">
        <h2 className="text-sm font-semibold">Your rules in dollars</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This account’s size or program isn’t in the published new-account schedule, so the rules can’t be shown in dollars here. The rules recorded for this account are on Objectives.
        </p>
        <Link to="/dashboard/objectives" className={`${linkClass} mt-3`}>Open Objectives <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
    );
  }
  const { plan, phaseTarget, funded } = view;
  const size = plan.accountSize;
  const tiles = [
    funded
      ? { term: "profit-split", label: "Profit split", value: `${plan.profitSplitPercent}%`, note: `Your share of approved funded profit on this ${plan.program.replace("-", " ")} plan.` }
      : { term: "profit-target", label: `Phase ${phaseTarget.phase} profit target`, value: `+${usd(phaseTarget.targetProfit)}`, note: `${phaseTarget.targetPercent}% · reach a balance of ${usd(phaseTarget.targetBalance)}.` },
    { term: "daily-loss-limit", label: "Daily loss limit", value: usd(view.startingDailyLossAmount), note: `${plan.dailyLossPercent}% of the balance at each 22:00 UTC reset (shown on the ${usd(size)} start).` },
    { term: "maximum-loss", label: "Maximum loss floor", value: usd(plan.maxLossFloor), note: `${plan.maxLossPercent}% static: equity must not fall below ${usd(plan.maxLossFloor)} (${usd(plan.maxLossAmount)} below the start).` },
    funded
      ? { term: "payout-window", label: "Payout requests", value: "Twice a month", note: "1st–3rd and 16th–18th of each month (UTC). See the payout calendar for the next window." }
      : { term: "minimum-trading-days", label: "Minimum trading days", value: String(plan.minDays), note: `In each phase, and no single day above ${view.consistencyPercent}% of the profit.` },
  ];
  const tools = [
    { to: view.links.calculator, icon: Calculator, label: "Today’s loss floor and the 40% check", hint: "Rules calculator" },
    { to: view.links.riskPlanner, icon: Gauge, label: "How many losing trades fit", hint: "Risk planner" },
    { to: view.links.positionSize, icon: Ruler, label: "Turn a stop into a lot size", hint: "Position size" },
    { to: view.links.simulator, icon: Dices, label: "Test your plan 2,000 times", hint: "Pass simulator" },
  ];
  return (
    <section className="premium-card space-y-5" aria-labelledby="account-plan-heading" data-testid="account-plan-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="account-plan-heading" className="text-sm font-semibold flex items-center gap-2"><Target size={16} aria-hidden="true" /> Your rules in dollars</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            From the published schedule for your {usd(size)} {plan.program.replace("-", " ")} purchase. Your official progress is on <Link to="/dashboard/objectives" className="underline underline-offset-2">Objectives</Link>.
          </p>
        </div>
        <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Where this account is">
          {view.stages.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              {i > 0 && <span className="h-px w-3 bg-border" aria-hidden="true" />}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${s.state === "current" ? "bg-primary text-primary-foreground" : s.state === "done" ? "bg-secondary text-foreground" : "border border-border text-muted-foreground"}`}
                aria-current={s.state === "current" ? "step" : undefined}
              >
                {s.state === "done" && <Check size={12} aria-hidden="true" />}
                {s.label}
                <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current)" : " (to come)"}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {view.phaseAssumed && view.phaseCount > 1 && (
        <p className="text-xs text-muted-foreground" data-testid="phase-assumed">The current phase hasn’t been recorded yet, so phase 1 is shown.</p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-secondary/50 p-4">
            <dt className="text-xs text-muted-foreground"><GlossaryTip term={t.term}>{t.label}</GlossaryTip></dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{t.value}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">{t.note}</dd>
          </div>
        ))}
      </dl>
      {!funded && view.phaseCount > 1 && (
        <p className="text-xs text-muted-foreground" data-testid="later-phases">
          {plan.phases.filter((p) => p.phase > view.phase).length > 0
            ? `Still to come: ${plan.phases.filter((p) => p.phase > view.phase).map((p) => `phase ${p.phase} +${usd(p.targetProfit)}`).join(", ")}. Each phase starts again from ${usd(size)}, with at least ${plural(plan.minDays, "trading day")}.`
            : `This is the last phase. Passing it leads to the funded stage with a ${plan.profitSplitPercent}% profit split.`}
        </p>
      )}
      <TradingDayStrip now={now} />
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tools set to this account</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {tools.map(({ to, icon: Icon, label, hint }) => (
            <li key={hint}>
              <Link to={to} className="group flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Icon size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <ArrowRight size={14} aria-hidden="true" className="ml-auto shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

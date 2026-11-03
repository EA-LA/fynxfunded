import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Calculator } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { PROGRAMS, calculatorLink, summarizeProgram, type ProgramId } from "@/lib/ruleCalculator";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const programBlurb: Record<ProgramId, string> = {
  "1-phase": "One target, tighter loss limits, fewest minimum days.",
  "2-phase": "Two targets with wider loss limits. Our featured program.",
  "3-phase": "Three smaller targets with the widest maximum loss and lowest fee.",
};

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

/** Side-by-side view of the three programs for one account size, in dollars. */
export default function ProgramComparison() {
  const [accountSize, setAccountSize] = useState(25000);
  const summaries = PROGRAMS.map((program) => ({ program, ...summarizeProgram(accountSize, program) }));
  const lowestFee = Math.min(...summaries.map((s) => s.price));
  const widestLoss = Math.max(...summaries.map((s) => s.plan.maxLossAmount));
  const fewestDays = Math.min(...summaries.map((s) => s.minimumTotalDays));

  return (
    <section id="compare-programs" aria-labelledby="compare-programs-title" className="mb-24 scroll-mt-24 animate-fade-up">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="compare-programs-title" className="text-2xl font-bold">Which program fits you?</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            Pick an account size to see the 1-, 2- and 3-phase programs side by side in dollars: what you pay, what you need to make, and how much room you have before a limit.
          </p>
        </div>
        <fieldset>
          <legend className="sr-only">Account size</legend>
          <div className="flex flex-wrap gap-2">
            {challengeConfigs.map((c) => (
              <button key={c.accountSize} type="button" aria-pressed={accountSize === c.accountSize} className={chip(accountSize === c.accountSize)} onClick={() => setAccountSize(c.accountSize)}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-6 md:grid-cols-3" aria-live="polite">
        {summaries.map((s) => (
          <article key={s.program} aria-label={`${s.program} program`} className="premium-card flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold capitalize">{s.program.replace("-", " ")}</h3>
              <div className="flex flex-wrap justify-end gap-1">
                {s.price === lowestFee && <Badge>Lowest fee</Badge>}
                {s.plan.maxLossAmount === widestLoss && <Badge>Most room</Badge>}
                {s.minimumTotalDays === fewestDays && <Badge>Fastest minimum</Badge>}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{programBlurb[s.program]}</p>
            <p className="mt-4">
              <span className="text-3xl font-bold tabular-nums">{usd(s.price)}</span>
              <span className="ml-1 text-sm text-muted-foreground">one-time · {s.feePercentOfAccount}% of account</span>
            </p>

            <dl className="mt-5 space-y-3 text-sm">
              {s.plan.phases.map((ph) => (
                <Row key={ph.phase} label={`Phase ${ph.phase} target (${ph.targetPercent}%)`} value={`+${usd(ph.targetProfit)}`} />
              ))}
              <Row label="Profit to make, all phases" value={`+${usd(s.combinedTargetProfit)}`} hint="Each phase restarts from the full account size." />
              <Row label={`Daily loss allowance (${s.plan.dailyLossPercent}%)`} value={`−${usd(s.startingDailyLossAmount)}`} hint="On the starting balance; recalculated at each 22:00 UTC reset." />
              <Row label={`Maximum loss (${s.plan.maxLossPercent}%)`} value={`−${usd(s.plan.maxLossAmount)}`} hint={`Equity must stay at or above ${usd(s.plan.maxLossFloor)}.`} />
              <Row label="Minimum trading days" value={`${s.minimumTotalDays} days`} hint={`${s.plan.minDays} per phase × ${s.plan.phases.length}.`} />
              <Row label="Profit split when funded" value={`${s.plan.profitSplitPercent}%`} />
            </dl>

            <div className="mt-auto pt-6 flex flex-col gap-2">
              <Link
                to="/challenge-builder"
                className="inline-flex items-center justify-center gap-1 bg-primary text-primary-foreground text-sm font-medium py-2.5 rounded-md hover:bg-primary/90 transition-colors"
              >
                Start a {s.program} challenge <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <Link
                to={calculatorLink(accountSize, s.program)}
                className="inline-flex items-center justify-center gap-1.5 border border-border text-sm font-medium py-2.5 rounded-md hover:bg-accent transition-colors"
              >
                <Calculator size={14} aria-hidden="true" /> Plan it in the rules calculator
              </Link>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Figures follow the published schedule for new accounts and are for comparison only. The 40% consistency rule applies to every program. The terms recorded with your purchase always apply.
      </p>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground whitespace-nowrap">{children}</span>;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 pb-2">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="mt-0.5 block text-xs">{hint}</span>}
      </dt>
      <dd className="font-medium tabular-nums text-right whitespace-nowrap">{value}</dd>
    </div>
  );
}

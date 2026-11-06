import RuleAvailabilityNotice from "@/components/RuleAvailabilityNotice";
import MarketingLayout from "@/components/MarketingLayout";
import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, Calculator, CheckCircle2, Clock, Gauge } from "lucide-react";
import { riskPlannerLink } from "@/lib/riskPlanner";
import GlossaryTip from "@/components/GlossaryTip";
import { getGlossaryTerm } from "@/lib/glossary";
import { challengeConfigs } from "@/lib/challengeConfig";
import { CONSISTENCY_LIMIT_PERCENT, DAILY_RESET_UTC_HOUR, PROGRAMS, calculatorLink, parseCalculatorPreset, summarizeProgram, type ProgramId } from "@/lib/ruleCalculator";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const phaseTitles = ["Evaluation", "Verification", "Final verification"];
const phaseDescriptions = [
  "Demonstrate your trading ability by reaching the profit target while staying within risk limits.",
  "Confirm your consistency with another round of trading under the same risk parameters.",
  "A last, smaller target under the same limits before the funded stage.",
];

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

export interface PathStep {
  num: string;
  title: string;
  desc: string;
  details: string[];
  link?: { to: string; label: string };
  /** Glossary term ids explained under the card ("Words used here"). */
  terms: string[];
}

const phaseTerms = ["profit-target", "daily-loss-limit", "maximum-loss", "static-vs-trailing", "minimum-trading-days", "consistency-rule"];
const fundedTerms = ["funded-stage", "profit-split", "payout-window", "kyc"];
const termName = (id: string) => getGlossaryTerm(id)?.term ?? id;

/** The steps of one program for one account size, built from the published schedule. */
export function buildPath(accountSize: number, program: ProgramId): PathStep[] {
  const { plan, startingDailyLossAmount } = summarizeProgram(accountSize, program);
  const steps: PathStep[] = plan.phases.map((ph, i) => ({
    num: `Phase ${ph.phase}`,
    title: plan.phases.length === 1 ? "Evaluation" : phaseTitles[i],
    desc: phaseDescriptions[i],
    details: [
      `Hit ${ph.targetPercent}% profit target (+${usd(ph.targetProfit)}, balance ${usd(ph.targetBalance)})`,
      `Stay within ${plan.dailyLossPercent}% daily loss (${usd(startingDailyLossAmount)} on the starting balance)`,
      `Static maximum loss: ${plan.maxLossPercent}% (equity floor ${usd(plan.maxLossFloor)})`,
      `Trade minimum ${plan.minDays} days`,
      `Best day at most ${CONSISTENCY_LIMIT_PERCENT}% of net phase profit`,
      "No time limit",
    ],
    link: { to: calculatorLink(accountSize, program, ph.phase), label: `Plan phase ${ph.phase} in the calculator` },
    terms: phaseTerms,
  }));
  steps.push({
    num: "Funded",
    title: "Funded Stage",
    desc: "Eligible traders may advance to the funded stage under the terms of their selected plan.",
    details: [
      `Plan-specific profit split: ${plan.profitSplitPercent}% for this plan`,
      "Eligibility-based payouts",
      "Account progress tracking",
      "Dashboard access",
      "Fee refund where included in the purchased plan",
    ],
    link: { to: "/payouts#estimator", label: "Estimate a payout" },
    terms: fundedTerms,
  });
  return steps;
}

const dayRules = [
  `Each trading day resets at ${DAILY_RESET_UTC_HOUR}:00 UTC, all year round.`,
  "At the reset, your daily loss floor is recalculated from the balance at that moment.",
  "Your maximum loss floor never moves: it is fixed from the starting balance.",
  "Touching a loss floor is allowed; falling below it records a breach.",
];

export default function HowItWorks() {
  const [searchParams, setSearchParams] = useSearchParams();
  // /how-it-works?size=50000&program=3-phase opens on that path, so it can be shared.
  const [initial] = useState(() => parseCalculatorPreset(searchParams));
  const [program, setProgramState] = useState<ProgramId>(initial.program);
  const [accountSize, setAccountSizeState] = useState(initial.accountSize);
  const remember = (size: number, prog: ProgramId) => {
    const params = new URLSearchParams(searchParams);
    params.set("size", String(size));
    params.set("program", prog);
    params.delete("phase");
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };
  const setProgram = (p: ProgramId) => {
    setProgramState(p);
    remember(accountSize, p);
  };
  const setAccountSize = (size: number) => {
    setAccountSizeState(size);
    remember(size, program);
  };
  const phases = buildPath(accountSize, program);
  const summary = summarizeProgram(accountSize, program);

  return (
    <MarketingLayout>
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <RuleAvailabilityNotice />
        <div className="max-w-2xl mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight animate-fade-up">How It Works</h1>
          <p className="mt-4 text-lg text-muted-foreground animate-fade-up delay-200">
            Pick a program and account size to see every step in dollars, from the first trade to the funded stage. Purchases remain closed.
          </p>
        </div>

        <div className="mb-10 grid gap-4 md:grid-cols-2 animate-fade-up">
          <fieldset>
            <legend className="text-sm font-medium mb-2">Program</legend>
            <div className="flex flex-wrap gap-2">
              {PROGRAMS.map((p) => (
                <button key={p} type="button" aria-pressed={program === p} className={`${chip(program === p)} capitalize`} onClick={() => setProgram(p)}>
                  {p.replace("-", " ")}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium mb-2">Account size</legend>
            <div className="flex flex-wrap gap-2">
              {challengeConfigs.map((c) => (
                <button key={c.accountSize} type="button" aria-pressed={accountSize === c.accountSize} className={chip(accountSize === c.accountSize)} onClick={() => setAccountSize(c.accountSize)}>
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <p className="mb-8 text-sm text-muted-foreground" aria-live="polite" data-testid="path-summary">
          {summary.plan.phases.length} {summary.plan.phases.length === 1 ? "phase" : "phases"} · {usd(summary.price)} one-time fee · {usd(summary.combinedTargetProfit)} profit to make in total · at least {summary.minimumTotalDays} trading days
        </p>
        <p className="-mt-5 mb-8 text-sm">
          <Link to={riskPlannerLink({ accountSize, program })} className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
            <Gauge size={14} aria-hidden="true" /> Plan your risk per trade for this account <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>

        <div className="space-y-8">
          {phases.map((phase, i) => (
            <div key={`${program}-${phase.num}`} className={`premium-card hover-lift animate-fade-up delay-${Math.min(i + 1, 4) * 200}`}>
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                <div className="shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">{phase.num}</span>
                  <h2 className="text-2xl font-bold mt-1">{phase.title}</h2>
                </div>
                <div className="flex-1">
                  <p className="text-muted-foreground mb-4">{phase.desc}</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {phase.details.map((d) => (
                      <div key={d} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 size={14} className="text-muted-foreground shrink-0" />
                        {d}
                      </div>
                    ))}
                  </div>
                  {phase.link && (
                    <Link to={phase.link.to} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
                      <Calculator size={14} aria-hidden="true" /> {phase.link.label}
                    </Link>
                  )}
                  <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Words used here:</span>
                    {phase.terms.map((id) => (
                      <GlossaryTip key={id} term={id} className="text-foreground/90">{termName(id)}</GlossaryTip>
                    ))}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <section aria-labelledby="trading-day-title" className="mt-16 premium-card animate-fade-up">
          <h2 id="trading-day-title" className="flex items-center gap-2 text-xl font-bold">
            <Clock size={18} aria-hidden="true" /> How a trading day works
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Words used here: <GlossaryTip term="trading-day" className="text-foreground/90">{termName("trading-day")}</GlossaryTip>,{" "}
            <GlossaryTip term="daily-reset" className="text-foreground/90">{termName("daily-reset")}</GlossaryTip>,{" "}
            <GlossaryTip term="breach" className="text-foreground/90">{termName("breach")}</GlossaryTip>
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {dayRules.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <CheckCircle2 size={14} className="mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link to="/faq" className="underline">More questions? Read the FAQ</Link>
            <Link to="/faq#glossary" className="underline">Browse the full glossary</Link>
          </p>
        </section>

        <div className="mt-16 text-center animate-fade-up delay-800">
          <Link
            to="/challenges"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            View Challenges <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}

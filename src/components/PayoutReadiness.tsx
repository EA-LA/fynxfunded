import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertCircle, CheckCircle2, CircleDashed, ClipboardCheck, RotateCcw } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { PROGRAMS, type ProgramId } from "@/lib/ruleCalculator";
import { checkPayoutReadiness, type CheckState, type ReadinessCheck } from "@/lib/payoutReadiness";
import GlossaryTip from "@/components/GlossaryTip";

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const parseNumber = (text: string) => {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

const checkTerm: Partial<Record<ReadinessCheck["id"], string>> = {
  days: "trading-day",
  violations: "breach",
  kyc: "kyc",
  minimum: "profit-split",
};

const stateIcon: Record<CheckState, ReactNode> = {
  met: <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />,
  missing: <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />,
  unanswered: <CircleDashed size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />,
};
const stateWord: Record<CheckState, string> = { met: "Met", missing: "Not yet", unanswered: "Not answered" };

function YesNo({ legend, value, onChange, yes = "Yes", no = "No" }: { legend: string; value: boolean | null; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium mb-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={value === true} className={chip(value === true)} onClick={() => onChange(true)}>{yes}</button>
        <button type="button" aria-pressed={value === false} className={chip(value === false)} onClick={() => onChange(false)}>{no}</button>
      </div>
    </fieldset>
  );
}

/**
 * "Am I ready to request a payout?" self-check on /payouts#readiness.
 * Runs entirely in the browser, stores nothing and sends nothing.
 */
export default function PayoutReadiness({ now }: { now?: Date }) {
  const [accountSize, setAccountSize] = useState(25000);
  const [program, setProgram] = useState<ProgramId>("2-phase");
  const [daysText, setDaysText] = useState("");
  const [profitText, setProfitText] = useState("");
  const [noViolations, setNoViolations] = useState<boolean | null>(null);
  const [positionsClosed, setPositionsClosed] = useState<boolean | null>(null);
  const [kycDone, setKycDone] = useState<boolean | null>(null);
  // Today's date is read in the browser so prerendered pages never show a stale window.
  const [today, setToday] = useState<Date | null>(now ?? null);
  useEffect(() => {
    if (!now) setToday(new Date());
  }, [now]);

  const daysId = useId();
  const profitId = useId();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash === "#readiness") sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [location.hash]);

  const result = checkPayoutReadiness(
    { accountSize, program, netProfit: parseNumber(profitText), tradingDays: parseNumber(daysText), noViolations, positionsClosed, kycDone },
    today ?? new Date(0),
  );

  const reset = () => {
    setDaysText("");
    setProfitText("");
    setNoViolations(null);
    setPositionsClosed(null);
    setKycDone(null);
  };

  const inputClass =
    "mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section ref={sectionRef} id="readiness" aria-labelledby="readiness-title" className="premium-card mb-16 scroll-mt-24 animate-fade-up">
      <h2 id="readiness-title" className="flex items-center gap-2 text-xl font-bold">
        <ClipboardCheck size={20} aria-hidden="true" /> Am I ready to request a payout?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
        Answer five quick questions to check your funded account against the eligibility list above and see which request window to aim for.
        This is a self-check only: nothing is saved or sent, and every real request is still reviewed.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <fieldset>
            <legend className="text-sm font-medium mb-2">Funded account size</legend>
            <div className="flex flex-wrap gap-2">
              {challengeConfigs.map((c) => (
                <button key={c.accountSize} type="button" aria-pressed={accountSize === c.accountSize} className={chip(accountSize === c.accountSize)} onClick={() => setAccountSize(c.accountSize)}>
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium mb-2">Program you passed</legend>
            <div className="flex flex-wrap gap-2">
              {PROGRAMS.map((p) => (
                <button key={p} type="button" aria-pressed={program === p} className={`${chip(program === p)} capitalize`} onClick={() => setProgram(p)}>
                  {p.replace("-", " ")}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={daysId} className="text-sm font-medium">Trading days since your last payout</label>
              <input id={daysId} inputMode="numeric" placeholder="e.g. 6" value={daysText} onChange={(e) => setDaysText(e.target.value)} className={inputClass} />
              <p className="mt-1 text-xs text-muted-foreground">First payout? Count the days on your funded account.</p>
            </div>
            <div>
              <label htmlFor={profitId} className="text-sm font-medium">Net profit since then (USD)</label>
              <input id={profitId} inputMode="decimal" placeholder="e.g. 800" value={profitText} onChange={(e) => setProfitText(e.target.value)} className={inputClass} />
              <p className="mt-1 text-xs text-muted-foreground">Your share uses the {result.splitPercent}% split for this plan.</p>
            </div>
          </div>
          <YesNo legend="Is the account free of active rule violations?" value={noViolations} onChange={setNoViolations} />
          <YesNo legend="Are all your positions closed?" value={positionsClosed} onChange={setPositionsClosed} yes="Yes, all closed" no="No, some are open" />
          <YesNo legend="Have you completed identity verification (KYC)?" value={kycDone} onChange={setKycDone} />
          <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <RotateCcw size={12} aria-hidden="true" /> Clear my answers
          </button>
        </div>

        <div className="rounded-md bg-secondary p-5" data-testid="readiness-result">
          <p className="text-sm text-muted-foreground">
            {result.metCount} of {result.checks.length} conditions met
          </p>
          <p className="mt-1 text-2xl font-bold" aria-live="polite">
            {result.ready ? "Ready to request" : result.missing.length ? "Not ready yet" : "Keep going"}
          </p>
          <div className="mt-2 h-2 rounded-full bg-background" aria-hidden="true">
            <div className={`h-2 rounded-full transition-all ${result.ready ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${(result.metCount / result.checks.length) * 100}%` }} />
          </div>
          {today && <p className="mt-3 text-sm">{result.summary}</p>}

          <ul className="mt-5 space-y-3 text-sm">
            {result.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2" data-state={c.state}>
                {stateIcon[c.state]}
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="sr-only">{stateWord[c.state]}: </span>
                    {c.label}
                    {checkTerm[c.id] && <GlossaryTip term={checkTerm[c.id]!} className="ml-1" />}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium">
            {kycDone === false && <Link to="/verification" className="underline underline-offset-4">Start identity verification</Link>}
            {noViolations === false && <Link to="/dashboard/objectives" className="underline underline-offset-4">Check my account objectives</Link>}
            <Link to="/dashboard/payouts" className="underline underline-offset-4">Go to dashboard payouts</Link>
            <a href="#calendar" className="underline underline-offset-4">See the payout calendar</a>
          </div>
        </div>
      </div>
    </section>
  );
}

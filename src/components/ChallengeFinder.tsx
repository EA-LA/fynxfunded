import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Calculator, Check, Compass, Gauge, Link2 } from "lucide-react";
import GlossaryTip from "@/components/GlossaryTip";
import { challengeConfigs } from "@/lib/challengeConfig";
import { PROGRAMS, calculatorLink, type ProgramId } from "@/lib/ruleCalculator";
import { riskPlannerLink } from "@/lib/riskPlanner";
import {
  FINDER_PRIORITIES,
  LOSING_STREAK_OPTIONS,
  cautionsFor,
  explainOption,
  findChallenges,
  finderLink,
  parseFinderParams,
  programLabel,
  type FinderInput,
  type FinderOption,
  type FinderPriority,
} from "@/lib/challengeFinder";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const BUDGET_CHIPS = [100, 250, 500, 1000];
const TOP = 3;

const parseMoney = (text: string): number | null | "invalid" => {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : "invalid";
};

/** Public "Find your challenge" tool on /challenges#finder. */
export default function ChallengeFinder() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  const [initial] = useState(() => parseFinderParams(searchParams));
  const [budgetText, setBudgetText] = useState(initial.budget === null ? "" : String(initial.budget));
  const [riskText, setRiskText] = useState(initial.riskPerTrade === null ? "" : String(initial.riskPerTrade));
  const [priority, setPriority] = useState<FinderPriority>(initial.priority);
  const [losingTrades, setLosingTrades] = useState(initial.losingTrades);
  const [programs, setPrograms] = useState<ProgramId[]>(initial.programs);
  const [showAll, setShowAll] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");

  const budget = parseMoney(budgetText);
  const risk = parseMoney(riskText);
  const input: FinderInput = {
    budget: budget === "invalid" ? null : budget,
    riskPerTrade: risk === "invalid" ? null : risk,
    priority,
    losingTrades,
    programs,
  };
  const result = useMemo(
    () => findChallenges(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.budget, input.riskPerTrade, priority, losingTrades, programs.join(",")],
  );
  const top = result.matches.slice(0, TOP);
  const sharePath = finderLink(input);
  const shareUrl = typeof window === "undefined" ? sharePath : `${window.location.origin}${sharePath}`;

  useEffect(() => {
    if (location.hash === "#finder") sectionRef.current?.scrollIntoView?.({ block: "start" });
    // Only on first render: later choices must not move the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setShareState("idle"), [sharePath]);
  useEffect(() => setShowAll(false), [result.matches.length]);

  const toggleProgram = (p: ProgramId) =>
    setPrograms((cur) => {
      // An empty list means "all three are on".
      const on = cur.length === 0 ? PROGRAMS : cur;
      const next = on.includes(p) ? on.filter((x) => x !== p) : [...on, p];
      if (next.length === 0) return cur; // keep at least one program switched on
      return next.length === PROGRAMS.length ? [] : PROGRAMS.filter((x) => next.includes(x));
    });

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
    } catch {
      setShareState("manual");
    }
  };

  const reset = () => {
    setBudgetText("");
    setRiskText("");
    setPriority("lowest-fee");
    setLosingTrades(3);
    setPrograms([]);
  };

  const priorityHint = FINDER_PRIORITIES.find((p) => p.id === priority)?.hint;

  return (
    <section ref={sectionRef} id="finder" aria-labelledby="finder-title" className="premium-card mb-24 scroll-mt-24 animate-fade-up">
      <div className="flex items-start gap-3">
        <Compass size={22} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 id="finder-title" className="text-2xl font-bold">Find your challenge</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Tell us your budget, how much you risk per trade and what matters most. We check all {result.considered.length || challengeConfigs.length * PROGRAMS.length} published plans and show the ones that fit, with the reasons in dollars.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <label htmlFor="finder-budget" className="text-sm font-medium">Most you want to pay (fee)</label>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick budgets">
            <button type="button" aria-pressed={budgetText === ""} className={chip(budgetText === "")} onClick={() => setBudgetText("")}>Any</button>
            {BUDGET_CHIPS.map((b) => (
              <button key={b} type="button" aria-pressed={budget === b} className={chip(budget === b)} onClick={() => setBudgetText(String(b))}>
                {usd(b)}
              </button>
            ))}
          </div>
          <input
            id="finder-budget"
            inputMode="decimal"
            placeholder="Any amount, e.g. 300"
            value={budgetText}
            onChange={(e) => setBudgetText(e.target.value)}
            aria-invalid={budget === "invalid"}
            aria-describedby={budget === "invalid" ? "finder-budget-error" : undefined}
            className={`${inputClass} mt-2`}
          />
          {budget === "invalid" && <p id="finder-budget-error" className="mt-1 text-xs text-destructive">Enter an amount in dollars, like 250.</p>}
        </div>

        <div>
          <div className="flex items-center gap-1">
            <label htmlFor="finder-risk" className="text-sm font-medium">
              Your usual risk per trade in dollars <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <GlossaryTip term="risk-per-trade" />
          </div>
          <input
            id="finder-risk"
            inputMode="decimal"
            placeholder="e.g. 100"
            value={riskText}
            onChange={(e) => setRiskText(e.target.value)}
            aria-invalid={risk === "invalid"}
            aria-describedby={risk === "invalid" ? "finder-risk-error" : "finder-risk-help"}
            className={`${inputClass} mt-2`}
          />
          {risk === "invalid" ? (
            <p id="finder-risk-error" className="mt-1 text-xs text-destructive">Enter an amount in dollars, like 100.</p>
          ) : (
            <p id="finder-risk-help" className="mt-1 text-xs text-muted-foreground">What you lose if a trade hits its stop. Leave empty to skip this check.</p>
          )}
          <div className="mt-4 flex items-center gap-1">
            <label htmlFor="finder-losses" className="text-sm font-medium">Losing trades in one day the daily loss limit should absorb</label>
            <GlossaryTip term="daily-loss-limit" />
          </div>
          <select
            id="finder-losses"
            value={losingTrades}
            onChange={(e) => setLosingTrades(Number(e.target.value))}
            disabled={input.riskPerTrade === null}
            className={`${inputClass} mt-2 disabled:opacity-60`}
          >
            {LOSING_STREAK_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} {n === 1 ? "losing trade" : "losing trades"}</option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">What matters most to you?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FINDER_PRIORITIES.map((p) => (
              <button key={p.id} type="button" aria-pressed={priority === p.id} className={chip(priority === p.id)} onClick={() => setPriority(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{priorityHint}</p>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">
            Programs to include <GlossaryTip term="phase" />
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROGRAMS.map((p) => {
              const on = programs.length === 0 || programs.includes(p);
              return (
                <button key={p} type="button" aria-pressed={on} className={`${chip(on)} capitalize`} onClick={() => toggleProgram(p)}>
                  {programLabel(p)}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Tap a program to leave it out; at least one stays on.</p>
        </fieldset>
      </div>

      <div className="mt-8" aria-live="polite">
        <p className="text-sm font-medium" role="status">
          {result.matches.length === 0
            ? "No published plan fits all of your choices."
            : `${result.matches.length} of ${result.considered.length} plans fit. ${result.matches.length > TOP ? `Top ${TOP} shown` : "Best first"}.`}
        </p>

        {top.length > 0 && (
          <ol className="mt-4 grid gap-6 md:grid-cols-3">
            {top.map((o, i) => (
              <OptionCard key={o.id} option={o} rank={i + 1} reasons={explainOption(o, input, result.matches)} cautions={cautionsFor(o)} risk={input.riskPerTrade} />
            ))}
          </ol>
        )}

        {result.matches.length === 0 && (
          <div className="mt-4 rounded-md border border-border p-4">
            {result.nearMisses.length > 0 ? (
              <>
                <p className="text-sm font-medium">Closest options</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {result.nearMisses.map((n) => (
                    <li key={n.option.id} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <span>
                        <span className="font-medium">{n.option.label} {programLabel(n.option.program)}</span> · {usd(n.option.summary.price)}: {n.change}
                      </span>
                      <Link to={calculatorLink(n.option.accountSize, n.option.program)} className="text-xs underline underline-offset-4 hover:text-foreground text-muted-foreground whitespace-nowrap">
                        See its rules in dollars
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Switch at least one program back on.</p>
            )}
          </div>
        )}

        {result.matches.length > TOP && (
          <div className="mt-6">
            <button
              type="button"
              aria-expanded={showAll}
              aria-controls="finder-all"
              onClick={() => setShowAll((v) => !v)}
              className="text-sm font-medium underline underline-offset-4 hover:text-foreground"
            >
              {showAll ? "Hide the full list" : `Show all ${result.matches.length} plans that fit`}
            </button>
            {showAll && (
              <div id="finder-all" className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Every plan that fits your choices, best first</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">#</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Plan</th>
                      <th scope="col" className="py-2 pr-4 font-medium text-right">Fee</th>
                      <th scope="col" className="py-2 pr-4 font-medium text-right">Daily loss</th>
                      <th scope="col" className="py-2 pr-4 font-medium text-right">Max loss</th>
                      <th scope="col" className="py-2 pr-4 font-medium text-right">Min days</th>
                      <th scope="col" className="py-2 pr-4 font-medium text-right">Split</th>
                      {input.riskPerTrade !== null && <th scope="col" className="py-2 pr-4 font-medium text-right">Losses / day</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.matches.map((o, i) => (
                      <tr key={o.id}>
                        <td className="py-2 pr-4 tabular-nums text-muted-foreground">{i + 1}</td>
                        <th scope="row" className="py-2 pr-4 text-left font-medium whitespace-nowrap">
                          <Link to={calculatorLink(o.accountSize, o.program)} className="hover:underline underline-offset-4">
                            {o.label} <span className="capitalize">{programLabel(o.program)}</span>
                          </Link>
                        </th>
                        <td className="py-2 pr-4 text-right tabular-nums">{usd(o.summary.price)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">−{usd(o.summary.startingDailyLossAmount)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">−{usd(o.summary.plan.maxLossAmount)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{o.summary.minimumTotalDays}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{o.summary.plan.profitSplitPercent}%</td>
                        {input.riskPerTrade !== null && <td className="py-2 pr-4 text-right tabular-nums">{o.lossesToDailyFloor}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {shareState === "copied" ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {shareState === "copied" ? "Link copied" : "Copy a link to these choices"}
        </button>
        <button type="button" onClick={reset} className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Start over
        </button>
        <span className="text-xs text-muted-foreground" role="status">
          {shareState === "copied" ? "Anyone opening it sees the same choices and results." : ""}
        </span>
      </div>
      {shareState === "manual" && (
        <div className="mt-3">
          <label htmlFor="finder-share-url" className="text-xs text-muted-foreground">Copying isn't available in this browser. Select and copy this address:</label>
          <input id="finder-share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} mt-1`} />
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Based on the published schedule for new accounts; the daily allowance is shown on the starting balance and is recalculated at each 22:00 UTC reset. This is a comparison aid, not trading advice, and it does not predict whether you will pass. The terms recorded with your purchase always apply. Nothing you type here is saved or sent anywhere.
      </p>
    </section>
  );
}

function OptionCard({ option, rank, reasons, cautions, risk }: { option: FinderOption; rank: number; reasons: string[]; cautions: string[]; risk: number | null }) {
  const s = option.summary;
  return (
    <li className="flex flex-col rounded-lg border border-border p-5" aria-label={`Option ${rank}: ${option.label} ${programLabel(option.program)}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {option.label} <span className="capitalize">{programLabel(option.program)}</span>
        </h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">{rank === 1 ? "Best match" : `Option ${rank}`}</span>
      </div>
      <p className="mt-2">
        <span className="text-3xl font-bold tabular-nums">{usd(s.price)}</span>
        <span className="ml-1 text-sm text-muted-foreground">one-time · {s.feePercentOfAccount}% of account</span>
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label={<GlossaryTip term="profit-target">Profit to make, all phases</GlossaryTip>} value={`+${usd(s.combinedTargetProfit)}`} />
        <Row label={<GlossaryTip term="daily-loss-limit">Daily loss allowance</GlossaryTip>} value={`−${usd(s.startingDailyLossAmount)}`} />
        <Row label={<GlossaryTip term="maximum-loss">Maximum loss</GlossaryTip>} value={`−${usd(s.plan.maxLossAmount)}`} />
        <Row label={<GlossaryTip term="minimum-trading-days">Minimum trading days</GlossaryTip>} value={String(s.minimumTotalDays)} />
        <Row label={<GlossaryTip term="profit-split">Profit split</GlossaryTip>} value={`${s.plan.profitSplitPercent}%`} />
      </dl>
      {reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs">
          {reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <Check size={14} className="mt-px shrink-0 text-emerald-500" aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {cautions.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          {cautions.map((c) => (
            <li key={c} className="flex gap-1.5">
              <AlertTriangle size={14} className="mt-px shrink-0 text-amber-500" aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-5">
        <Link
          to="/challenge-builder"
          className="inline-flex items-center justify-center gap-1 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start a challenge <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link
          to={calculatorLink(option.accountSize, option.program)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Calculator size={14} aria-hidden="true" /> See the rules in dollars
        </Link>
        <Link
          to={riskPlannerLink({ accountSize: option.accountSize, program: option.program, riskMode: "dollars", riskValue: risk ?? undefined })}
          className="inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Gauge size={13} aria-hidden="true" /> Plan your risk for this account
        </Link>
      </div>
    </li>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-right whitespace-nowrap">{value}</dd>
    </div>
  );
}

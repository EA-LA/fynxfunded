import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Gauge, Link2 } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { CONSISTENCY_LIMIT_PERCENT, getRulePlan, parseCalculatorPreset, PROGRAMS as programs, type ProgramId } from "@/lib/ruleCalculator";
import { parseRiskPreset, planRisk, REWARD_RATIOS, riskPlannerLink, type RiskMode } from "@/lib/riskPlanner";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function RiskPlanner() {
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => ({ ...parseCalculatorPreset(searchParams), ...parseRiskPreset(searchParams) }));
  const [accountSize, setAccountSize] = useState(initial.accountSize);
  const [program, setProgram] = useState<ProgramId>(initial.program);
  const [phase, setPhase] = useState(initial.phase);
  const [riskMode, setRiskMode] = useState<RiskMode>(initial.riskMode);
  const [riskInput, setRiskInput] = useState(initial.riskInput);
  const [rewardRatio, setRewardRatio] = useState(initial.rewardRatio);
  const [daysInput, setDaysInput] = useState(initial.daysInput);
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");

  const plan = useMemo(() => getRulePlan(accountSize, program), [accountSize, program]);
  const currentPhase = Math.min(phase, plan.phases.length);
  const riskValue = Number(riskInput);
  const riskValid = riskInput.trim() !== "" && Number.isFinite(riskValue) && riskValue > 0 && (riskMode === "dollars" ? riskValue >= 0.01 : riskValue <= 100);
  const plannedDays = Number(daysInput);
  const daysValid = daysInput.trim() !== "" && Number.isInteger(plannedDays) && plannedDays >= 1 && plannedDays <= 250;

  const result = riskValid
    ? planRisk({ plan, phase: currentPhase, riskMode, riskValue, rewardRatio, plannedDays: daysValid ? plannedDays : plan.minDays })
    : null;

  const sharePath = riskPlannerLink({
    accountSize,
    program,
    phase: currentPhase,
    riskMode,
    riskValue: riskValid ? riskValue : undefined,
    rewardRatio,
    plannedDays: daysValid ? plannedDays : undefined,
  });
  const shareUrl = typeof window === "undefined" ? sharePath : `${window.location.origin}${sharePath}`;

  // Any change makes an earlier "copied" message stale.
  useEffect(() => setShareState("idle"), [sharePath]);

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
    } catch {
      // Show the address so it can be copied by hand.
      setShareState("manual");
    }
  };

  const switchMode = (mode: RiskMode) => {
    if (mode === riskMode) return;
    // Convert the current value so switching units doesn't change the plan.
    if (riskValid) {
      const next = mode === "dollars" ? (accountSize * riskValue) / 100 : (riskValue / accountSize) * 100;
      setRiskInput(String(Math.round(next * 100) / 100));
    }
    setRiskMode(mode);
  };

  return (
    <section id="risk-planner" aria-labelledby="risk-planner-title" className="premium-card mb-8 scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
          <Gauge size={18} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2 id="risk-planner-title" className="text-lg font-semibold">Risk and pace planner</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose how much you're willing to lose on one trade and see how many losing trades fit inside the loss limits, how many winners the target takes, and what a steady daily pace looks like under the {CONSISTENCY_LIMIT_PERCENT}% consistency rule.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
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
        <fieldset>
          <legend className="text-sm font-medium mb-2">Program</legend>
          <div className="flex flex-wrap gap-2">
            {programs.map((p) => (
              <button key={p} type="button" aria-pressed={program === p} className={chip(program === p)} onClick={() => setProgram(p)}>
                {p}
              </button>
            ))}
          </div>
          {plan.phases.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Phase">
              {plan.phases.map((ph) => (
                <button key={ph.phase} type="button" aria-pressed={currentPhase === ph.phase} className={chip(currentPhase === ph.phase)} onClick={() => setPhase(ph.phase)}>
                  Phase {ph.phase} target
                </button>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div>
          <span className="text-sm font-medium" id="risk-unit-label">Risk per trade</span>
          <div className="mt-1 flex gap-2" role="group" aria-labelledby="risk-unit-label">
            <button type="button" aria-pressed={riskMode === "percent"} className={chip(riskMode === "percent")} onClick={() => switchMode("percent")}>% of account</button>
            <button type="button" aria-pressed={riskMode === "dollars"} className={chip(riskMode === "dollars")} onClick={() => switchMode("dollars")}>Dollars</button>
          </div>
          <label htmlFor="risk-value" className="sr-only">{riskMode === "percent" ? "Risk per trade (% of account)" : "Risk per trade (USD)"}</label>
          <input
            id="risk-value"
            inputMode="decimal"
            className={`${inputClass} mt-2`}
            value={riskInput}
            onChange={(e) => setRiskInput(e.target.value)}
            aria-invalid={!riskValid}
            aria-describedby="risk-help"
          />
          <p id="risk-help" className={`mt-1 text-xs ${riskValid ? "text-muted-foreground" : "text-destructive"}`}>
            {riskValid
              ? riskMode === "percent"
                ? `${usd(result!.riskAmount)} on a ${usd(accountSize)} account.`
                : `${result!.riskPercent}% of a ${usd(accountSize)} account.`
              : riskMode === "percent"
                ? "Enter a percentage above 0, for example 0.5."
                : "Enter a dollar amount above 0, for example 125."}
          </p>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Planned reward per winning trade</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {REWARD_RATIOS.map((r) => (
              <button key={r} type="button" aria-pressed={rewardRatio === r} className={chip(rewardRatio === r)} onClick={() => setRewardRatio(r)}>
                {r}× risk
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="planned-days" className="text-sm font-medium">Trading days you plan to use</label>
          <input
            id="planned-days"
            inputMode="numeric"
            className={`${inputClass} mt-1`}
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
            aria-invalid={!daysValid}
            aria-describedby="days-help"
          />
          <p id="days-help" className={`mt-1 text-xs ${daysValid ? "text-muted-foreground" : "text-destructive"}`}>
            {daysValid ? "There is no maximum time limit in this schedule; this is your own plan." : "Enter a whole number of days from 1 to 250."}
          </p>
        </div>
      </div>

      {result && (
        <div className="mt-8 grid gap-6 md:grid-cols-2" aria-live="polite">
          <div className="rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Loss budget</h3>
            {result.exceedsDailyAllowance && (
              <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>One full loss of {usd(result.riskAmount)} is bigger than the {usd(result.dailyAllowance)} daily allowance, so a single losing trade could record a breach.</span>
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Losing trades before the daily floor</dt>
                <dd className="text-xl font-bold tabular-nums">{result.lossesToDailyFloor}</dd>
                <dd className="text-xs text-muted-foreground tabular-nums">of a {usd(result.dailyAllowance)} daily allowance ({plan.dailyLossPercent}%)</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Losing trades before the maximum-loss floor</dt>
                <dd className="text-xl font-bold tabular-nums">{result.lossesToMaxFloor}</dd>
                <dd className="text-xs text-muted-foreground tabular-nums">of a {usd(result.maxAllowance)} static allowance ({plan.maxLossPercent}%)</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {plural(result.worstDaysToMaxFloor, "full daily-limit day")} would use up the whole maximum-loss allowance. Counts assume each loss is exactly your planned risk and include open positions, because equity counts floating losses. Slippage and charges can make a loss larger than planned.
            </p>
          </div>

          <div className="rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Reaching the phase {result.phase} target of {usd(result.targetProfit)}</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Winning trades needed with no losers</dt>
                <dd className="text-xl font-bold tabular-nums">{result.winsNeededWithoutLosses}</dd>
                <dd className="text-xs text-muted-foreground tabular-nums">at {usd(result.rewardPerWin)} per win</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Break-even win rate</dt>
                <dd className="text-xl font-bold tabular-nums">{result.breakEvenWinRate}%</dd>
                <dd className="text-xs text-muted-foreground">at {rewardRatio}× reward, before charges</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Steady pace over {plural(result.days, "day")}</dt>
                <dd className="text-xl font-bold tabular-nums">{usd(result.averagePerDay)}</dd>
                <dd className="text-xs text-muted-foreground">net profit per day</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Biggest single day that fits</dt>
                <dd className="text-xl font-bold tabular-nums">{usd(result.bestDayCap)}</dd>
                <dd className="text-xs text-muted-foreground">{CONSISTENCY_LIMIT_PERCENT}% of the target, if you finish right at it</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {result.plannedDaysRaised
                ? `Raised to ${plural(result.minimumDays, "day")}: the program needs ${plural(plan.minDays, "trading day")} per phase, and no single day may be more than ${CONSISTENCY_LIMIT_PERCENT}% of total profit. `
                : `The fewest days that fit both the ${plan.minDays}-day minimum and the ${CONSISTENCY_LIMIT_PERCENT}% rule is ${result.minimumDays}. `}
              A bigger day is allowed, but then total profit has to grow past the target before you become eligible.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {shareState === "copied" ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {shareState === "copied" ? "Link copied" : "Copy a link to this plan"}
        </button>
        <span className="text-xs text-muted-foreground" role="status">
          {shareState === "copied" ? "Anyone opening it sees the same account, risk, reward and days." : ""}
        </span>
      </div>
      {shareState === "manual" && (
        <div className="mt-3">
          <label htmlFor="risk-share-url" className="text-xs text-muted-foreground">Copying isn't available in this browser. Select and copy this address:</label>
          <input id="risk-share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} mt-1`} />
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Planning arithmetic only, based on the published {plan.program} schedule for a {usd(accountSize)} account. It is not trading advice, does not size positions for any instrument and does not predict results. Nothing here is saved or sent anywhere.
      </p>
    </section>
  );
}

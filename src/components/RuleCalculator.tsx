import { useMemo, useState } from "react";
import { Calculator, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import {
  CONSISTENCY_LIMIT_PERCENT,
  DAILY_RESET_UTC_HOUR,
  checkConsistency,
  effectiveFloor,
  getRulePlan,
  type ProgramId,
} from "@/lib/ruleCalculator";

const programs: ProgramId[] = ["1-phase", "2-phase", "3-phase"];
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function RuleCalculator() {
  const [accountSize, setAccountSize] = useState(25000);
  const [program, setProgram] = useState<ProgramId>("2-phase");
  const [resetBalanceInput, setResetBalanceInput] = useState("");
  const [days, setDays] = useState<string[]>(["", "", ""]);

  const plan = useMemo(() => getRulePlan(accountSize, program), [accountSize, program]);
  const resetBalance = Number(resetBalanceInput);
  const resetValid = resetBalanceInput.trim() !== "" && Number.isFinite(resetBalance) && resetBalance > 0;
  const today = effectiveFloor(plan, resetValid ? resetBalance : accountSize);

  const enteredDays = days.filter((d) => d.trim() !== "");
  const invalidDays = enteredDays.some((d) => !Number.isFinite(Number(d)));
  const consistency = checkConsistency(invalidDays ? [] : enteredDays.map(Number));
  const firstTarget = plan.phases[0];

  return (
    <section id="calculator" aria-labelledby="calculator-title" className="premium-card mb-8 scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
          <Calculator size={18} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2 id="calculator-title" className="text-lg font-semibold">Rules calculator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            See the schedule above in dollars for any account size, check today's loss floor, and test your daily results against the {CONSISTENCY_LIMIT_PERCENT}% consistency rule.
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
        </fieldset>
      </div>

      {/* Targets and limits */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold mb-3">Your targets and limits</h3>
        <dl className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {plan.phases.map((ph) => (
            <div key={ph.phase} className="rounded-md bg-secondary/50 p-3">
              <dt className="text-xs text-muted-foreground">Phase {ph.phase} target ({ph.targetPercent}%)</dt>
              <dd className="mt-1 text-base font-semibold tabular-nums">+{usd(ph.targetProfit)}</dd>
              <dd className="text-xs text-muted-foreground tabular-nums">Balance {usd(ph.targetBalance)}</dd>
            </div>
          ))}
          <div className="rounded-md bg-secondary/50 p-3">
            <dt className="text-xs text-muted-foreground">Maximum loss ({plan.maxLossPercent}%, static)</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">−{usd(plan.maxLossAmount)}</dd>
            <dd className="text-xs text-muted-foreground tabular-nums">Equity floor {usd(plan.maxLossFloor)}</dd>
          </div>
          <div className="rounded-md bg-secondary/50 p-3">
            <dt className="text-xs text-muted-foreground">Minimum trading days</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">{plan.minDays} per phase</dd>
            <dd className="text-xs text-muted-foreground">Days with a closed trade</dd>
          </div>
        </dl>
      </div>

      {/* Today's floor */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold mb-1">Today's loss floor</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Enter your balance at the last {DAILY_RESET_UTC_HOUR}:00 UTC reset. Leave blank to use the starting balance.
          </p>
          <label htmlFor="reset-balance" className="text-sm font-medium">Balance at daily reset (USD)</label>
          <input
            id="reset-balance"
            inputMode="decimal"
            className={`${inputClass} mt-1`}
            placeholder={String(accountSize)}
            value={resetBalanceInput}
            onChange={(e) => setResetBalanceInput(e.target.value)}
            aria-invalid={resetBalanceInput.trim() !== "" && !resetValid}
            aria-describedby="reset-help"
          />
          {resetBalanceInput.trim() !== "" && !resetValid && (
            <p id="reset-help" className="mt-1 text-xs text-destructive">Enter a positive number, for example 25340.50.</p>
          )}
        </div>
        <div className="rounded-md border border-border p-4" aria-live="polite">
          <p className="text-xs text-muted-foreground">Daily loss allowance ({plan.dailyLossPercent}%)</p>
          <p className="text-base font-semibold tabular-nums">−{usd(today.daily.amount)} → floor {usd(today.daily.floor)}</p>
          <p className="mt-3 text-xs text-muted-foreground">Equity must stay at or above</p>
          <p className="text-2xl font-bold tabular-nums">{usd(today.floor)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {today.binding === "daily"
              ? "The daily limit is the closer floor today."
              : "The static maximum-loss floor is closer than the daily limit today."}{" "}
            Equity includes open (floating) profit and loss. Touching the floor is allowed; going below it records a breach.
          </p>
        </div>
      </div>

      {/* Consistency */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold mb-1">Consistency check</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Enter the net result of each trading day in this phase, including trading charges. Use a minus sign for losing days.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <ul className="space-y-2">
              {days.map((value, i) => (
                <li key={i} className="flex items-center gap-2">
                  <label htmlFor={`day-${i}`} className="w-14 shrink-0 text-xs text-muted-foreground">Day {i + 1}</label>
                  <input
                    id={`day-${i}`}
                    inputMode="decimal"
                    className={inputClass}
                    placeholder="e.g. 250 or -80"
                    value={value}
                    aria-invalid={value.trim() !== "" && !Number.isFinite(Number(value))}
                    onChange={(e) => setDays((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    aria-label={`Remove day ${i + 1}`}
                    disabled={days.length <= 1}
                    onClick={() => setDays((d) => d.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={chip(false)} onClick={() => setDays((d) => [...d, ""])} disabled={days.length >= 60}>
                <Plus size={14} className="inline mr-1" aria-hidden="true" />Add day
              </button>
              <button type="button" className={chip(false)} onClick={() => setDays(["", "", ""])}>Clear</button>
            </div>
          </div>

          <div className="rounded-md border border-border p-4 text-sm" aria-live="polite">
            {invalidDays ? (
              <p className="text-destructive">One of the days isn't a number. Use digits only, for example 250 or -80.</p>
            ) : enteredDays.length === 0 ? (
              <p className="text-muted-foreground">Results appear here as you enter your days.</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-muted-foreground">Total net profit</dt><dd className="font-semibold tabular-nums">{usd(consistency.totalProfit)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Best day</dt><dd className="font-semibold tabular-nums">{usd(consistency.bestDay)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Best day share</dt><dd className="font-semibold tabular-nums">{consistency.sharePercent === null ? "—" : `${consistency.sharePercent}%`}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Trading days entered</dt><dd className="font-semibold tabular-nums">{consistency.tradingDays} of {plan.minDays} min.</dd></div>
                </dl>
                <p className={`mt-4 flex items-start gap-2 ${consistency.passes ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {consistency.passes ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
                  <span>
                    {consistency.passes
                      ? `Consistency met: your best day is within ${CONSISTENCY_LIMIT_PERCENT}% of total net profit.`
                      : consistency.sharePercent === null
                        ? "Not met yet: total net profit must be above zero."
                        : `Not met yet: total net profit needs to reach ${usd(consistency.profitNeededForBestDay)} for your best day to fit within ${CONSISTENCY_LIMIT_PERCENT}%.`}
                  </span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Phase 1 target is {usd(firstTarget.targetProfit)}
                  {consistency.totalProfit >= firstTarget.targetProfit ? " — reached in these numbers." : ` — ${usd(Math.max(0, firstTarget.targetProfit - consistency.totalProfit))} to go.`}{" "}
                  Not meeting consistency only delays eligibility; it is not a breach.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Estimates for planning only, based on the published {plan.program} schedule for a {usd(accountSize)} account. Nothing here is saved or sent anywhere. Official results come from your account dashboard and are subject to human review; the terms recorded with your purchase always apply.
      </p>
    </section>
  );
}

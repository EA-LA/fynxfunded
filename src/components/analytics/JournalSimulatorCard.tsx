import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Dices } from "lucide-react";
import type { Trade } from "@/lib/tradingData";
import { getRulePlan, PROGRAMS, type ProgramId } from "@/lib/ruleCalculator";
import { DEFAULT_SIMULATOR_PRESET, SIMULATION_RUNS, simulateChallenge, simulatorLink, type Outcome, type PhaseChoice } from "@/lib/challengeSimulator";
import { journalPlan, journalRiskAmount, journalTradeOutcomes, SUPPORTED_ACCOUNT_SIZES } from "@/lib/journalSimulator";

type Method = "average" | "replay";

const SEED = 20261105;
const DAY_LIMIT = Number(DEFAULT_SIMULATOR_PRESET.dayLimitInput);

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const sizeLabel = (n: number) => (n >= 1000 ? `$${n / 1000}K` : usd(n));
const chip = (active: boolean) =>
  `rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
  }`;

const ROWS: { key: Outcome; label: string; tone: string }[] = [
  { key: "passed", label: "Passed", tone: "bg-emerald-500" },
  { key: "maxBreach", label: "Broke the maximum loss limit", tone: "bg-red-500" },
  { key: "outOfRoom", label: "Stopped: no room left above the maximum-loss floor", tone: "bg-red-400" },
  { key: "unfinished", label: `Still going after ${DAY_LIMIT} trading days`, tone: "bg-muted-foreground" },
];

/**
 * "What if my recorded trading went through a challenge?" Uses the trader's own
 * closed trades (win rate, average win and loss, trades per day) as a simplified
 * plan for the Rules page pass simulator. Past results; an illustration only.
 */
export default function JournalSimulatorCard({ trades, accountSize, periodLabel, program: initialProgram }: { trades: Trade[]; accountSize: number; periodLabel: string; program?: string }) {
  const plan = useMemo(() => journalPlan(trades, accountSize), [trades, accountSize]);
  const recordSizeSupported = SUPPORTED_ACCOUNT_SIZES.includes(accountSize);
  const [size, setSize] = useState<number>(recordSizeSupported ? accountSize : 25000);
  const [program, setProgram] = useState<ProgramId>(() => ((PROGRAMS as string[]).includes(initialProgram ?? "") ? (initialProgram as ProgramId) : "2-phase"));
  const [phase, setPhase] = useState<PhaseChoice>(1);
  const [method, setMethod] = useState<Method>("average");

  const rules = useMemo(() => getRulePlan(size, program), [size, program]);
  const phaseChoice: PhaseChoice = rules.phases.length === 1 ? 1 : phase;
  const riskAmount = plan.ready ? journalRiskAmount(plan, size) : 0;
  const winRate = Math.min(99, Math.max(1, plan.winRate));
  const dailyAllowance = Math.round(size * rules.dailyLossPercent) / 100;
  const tooBig = plan.ready && riskAmount > dailyAllowance;

  // Replay method: the record's own wins and losses, resized to the chosen account.
  const outcomes = useMemo(
    () => (plan.ready ? journalTradeOutcomes(trades, plan.riskPercent !== null ? accountSize : 0, size) : []),
    [plan, trades, accountSize, size],
  );
  const biggestLoss = outcomes.length ? Math.max(0, -Math.min(...outcomes)) : 0;
  const biggestWin = outcomes.length ? Math.max(0, ...outcomes) : 0;
  const replayTooBig = plan.ready && biggestLoss > dailyAllowance;

  const replayResult = useMemo(
    () =>
      plan.ready && !replayTooBig && outcomes.length
        ? simulateChallenge({
            plan: rules,
            phase: phaseChoice,
            riskAmount: 0,
            rewardRatio: 0,
            winRatePercent: 0,
            tradesPerDay: plan.tradesPerDay,
            dayLimit: DAY_LIMIT,
            costPerTrade: 0,
            stopBeforeBreach: true,
            runs: SIMULATION_RUNS,
            seed: SEED,
            tradeOutcomes: outcomes,
          })
        : null,
    [plan, replayTooBig, outcomes, rules, phaseChoice],
  );

  const averageResult = useMemo(
    () =>
      plan.ready && !tooBig && riskAmount > 0
        ? simulateChallenge({
            plan: rules,
            phase: phaseChoice,
            riskAmount,
            rewardRatio: plan.rewardRatio,
            winRatePercent: winRate,
            tradesPerDay: plan.tradesPerDay,
            dayLimit: DAY_LIMIT,
            costPerTrade: 0,
            stopBeforeBreach: true,
            runs: SIMULATION_RUNS,
            seed: SEED,
          })
        : null,
    [plan, tooBig, riskAmount, rules, phaseChoice, winRate],
  );

  const result = method === "replay" ? replayResult : averageResult;
  const otherResult = method === "replay" ? averageResult : replayResult;
  const blocked = method === "replay" ? replayTooBig : tooBig;

  const link = simulatorLink({
    accountSize: size,
    program,
    phase: phaseChoice,
    riskMode: plan.riskPercent !== null ? "percent" : "dollars",
    riskValue: plan.riskPercent ?? plan.avgLoss,
    rewardRatio: plan.rewardRatio,
    winRate,
    tradesPerDay: plan.tradesPerDay,
    dayLimit: DAY_LIMIT,
  });

  const rewardNote =
    plan.rewardFit === "exact"
      ? `simulated as 1:${plan.rewardRatio}`
      : plan.rewardFit === "roundedDown"
        ? `simulated as 1:${plan.rewardRatio} (rounded down, so it never flatters you)`
        : "simulated as 1:1, which is better than your record";

  return (
    <section className="premium-card" aria-labelledby="journal-sim-title" data-testid="journal-simulator">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="journal-sim-title" className="flex items-center gap-2 font-semibold"><Dices size={16} aria-hidden="true" />Your record in the pass simulator</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Takes your closed trades ({periodLabel}) as a simple plan: your win rate, your average loss as the risk per trade, your average win as the reward and your usual number of trades a day. Then it plays that plan forward {SIMULATION_RUNS.toLocaleString("en-US")} times against the published rules.
          </p>
        </div>
        <Link to="/rules#simulator" className="text-xs font-medium underline underline-offset-4 hover:text-foreground">How the simulator works</Link>
      </div>

      {!plan.ready ? (
        <div className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p>{plan.reason}</p>
          <Link to="/rules#simulator" className="mt-3 inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
            Try the simulator with numbers you type in <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="journal-sim-inputs">
            {[
              ["Win rate", `${plan.winRate.toFixed(1)}%`, `${plan.wins} wins · ${plan.losses} losses${plan.breakeven ? ` · ${plan.breakeven} breakeven left out` : ""}`],
              ["Risk per trade", usd(riskAmount), plan.riskPercent !== null ? `Your average loss (${usd(plan.avgLoss)}) is ${plan.riskPercent}% of the account` : `Your average loss; account size unknown`],
              ["Reward", `${plan.payoff.toFixed(2)}×`, `Average win ${usd(plan.avgWin)} ÷ average loss · ${rewardNote}`],
              ["Trades per day", String(plan.tradesPerDayActual), `Over ${plan.tradingDays} trading day${plan.tradingDays === 1 ? "" : "s"} · simulated as ${plan.tradesPerDay} a day`],
            ].map(([k, v, d]) => (
              <div className="rounded-xl border bg-card/60 px-4 py-3" key={k}>
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{v}</p>
                <p className="text-[11px] text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="text-xs font-medium">
              Account size
              <select
                className="mt-1 block rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              >
                {SUPPORTED_ACCOUNT_SIZES.map((s) => (
                  <option key={s} value={s}>{sizeLabel(s)}{s === accountSize ? " (your account)" : ""}</option>
                ))}
              </select>
            </label>
            <div>
              <p className="text-xs font-medium" id="journal-sim-program">Program</p>
              <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby="journal-sim-program">
                {PROGRAMS.map((p) => (
                  <button type="button" key={p} aria-pressed={program === p} className={chip(program === p)} onClick={() => setProgram(p)}>{p}</button>
                ))}
              </div>
            </div>
            {rules.phases.length > 1 && (
              <div>
                <p className="text-xs font-medium" id="journal-sim-phase">Run</p>
                <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby="journal-sim-phase">
                  <button type="button" aria-pressed={phaseChoice === 1} className={chip(phaseChoice === 1)} onClick={() => setPhase(1)}>Phase 1</button>
                  <button type="button" aria-pressed={phaseChoice === "all"} className={chip(phaseChoice === "all")} onClick={() => setPhase("all")}>All {rules.phases.length} phases</button>
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-medium" id="journal-sim-method">Each simulated trade is</p>
              <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby="journal-sim-method">
                <button type="button" aria-pressed={method === "average"} className={chip(method === "average")} onClick={() => setMethod("average")}>Your average win or loss</button>
                <button type="button" aria-pressed={method === "replay"} className={chip(method === "replay")} onClick={() => setMethod("replay")}>One of your real trades</button>
              </div>
            </div>
          </div>

          {method === "replay" && (
            <p className="mt-3 max-w-2xl text-xs text-muted-foreground" data-testid="journal-sim-replay-note">
              Each simulated trade is one of your {outcomes.length} real winning or losing trades, picked at random, so big wins and big losses show up as often as they did for you
              {plan.riskPercent !== null && size !== accountSize ? `, resized to the ${sizeLabel(size)} account` : ""}. Your biggest loss here is {usd(biggestLoss)} and your biggest win {usd(biggestWin)}. To stay safe, the simulated trader skips a trade whenever your biggest loss could break today's limit.
            </p>
          )}

          {blocked && method === "replay" ? (
            <p className="mt-5 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm" role="alert">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              At this size your biggest recorded loss ({usd(biggestLoss)}) is bigger than the whole daily loss allowance ({usd(dailyAllowance)}), so that trade alone would break the daily limit. Try a larger account size, or switch to your average win or loss.
            </p>
          ) : blocked ? (
            <p className="mt-5 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm" role="alert">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              At this size your average loss ({usd(riskAmount)}) is bigger than the whole daily loss allowance ({usd(dailyAllowance)}), so a single average loss would break the daily limit. Try a larger account size, or plan a smaller risk per trade.
            </p>
          ) : result ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_2fr]" aria-live="polite">
              <div className="rounded-xl bg-secondary/50 p-5">
                <p className="text-xs text-muted-foreground">Runs that passed {phaseChoice === "all" ? `all ${rules.phases.length} phases` : "phase 1"}</p>
                <p className="mt-1 text-4xl font-bold tabular-nums" data-testid="journal-sim-pass">{result.percents.passed}%</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {result.medianDaysToPass !== null
                    ? `Passing runs usually took about ${result.medianDaysToPass} trading days (fastest ${result.fastestPass}, slowest ${result.slowestPass}).`
                    : `None of the ${SIMULATION_RUNS.toLocaleString("en-US")} runs passed within ${DAY_LIMIT} trading days.`}
                </p>
                {result.percents.unfinished >= 50 && (
                  <p className="mt-2 text-xs text-muted-foreground" data-testid="journal-sim-slow">
                    Most runs simply ran out of time: at this risk and pace the target takes longer than {DAY_LIMIT} trading days. Open the full simulator to change the day limit or test a different risk.
                  </p>
                )}
                {(result.percents.maxBreach + result.percents.outOfRoom) >= 50 && (
                  <p className="mt-2 text-xs text-muted-foreground" data-testid="journal-sim-risky">
                    Most runs reached the maximum-loss floor before the target. Open the full simulator to see how a smaller risk per trade changes that.
                  </p>
                )}
                {otherResult && (
                  <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" data-testid="journal-sim-compare">
                    {method === "replay" ? "Using your average win or loss instead" : "Replaying your real trades instead"}: <b className="tabular-nums text-foreground">{otherResult.percents.passed}%</b> passed.
                    {Math.abs(otherResult.percents.passed - result.percents.passed) >= 10 &&
                      " A big gap means the size of your trades varies a lot, so the average alone hides part of the picture."}
                  </p>
                )}
              </div>
              <ul className="space-y-2.5" aria-label="How the simulated runs ended">
                {ROWS.map((row) => (
                  <li key={row.key} className="text-sm">
                    <div className="flex justify-between gap-3"><span>{row.label}</span><b className="tabular-nums">{result.percents[row.key]}%</b></div>
                    <div className="mt-1 h-2 rounded-full bg-secondary" aria-hidden="true"><div className={`h-2 rounded-full ${row.tone}`} style={{ width: `${result.percents[row.key]}%` }} /></div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-2xl text-[11px] text-muted-foreground">
              Based on past closed trades only{method === "replay" ? ", picked at random from your record" : ", with every win and loss assumed to be your average size"} and the simulated trader skipping any trade that could break today's limit. The full simulator uses the average method. Small records can mislead. This is an illustration, not a prediction or advice, and it never affects your account.
            </p>
            <Link to={link} className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
              Open this in the pass simulator <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

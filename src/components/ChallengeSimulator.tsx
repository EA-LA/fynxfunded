import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Dices, Link2, RefreshCw, Upload } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { CONSISTENCY_LIMIT_PERCENT, getRulePlan, parseCalculatorPreset, PROGRAMS as programs, type ProgramId } from "@/lib/ruleCalculator";
import { REWARD_RATIOS, type RiskMode } from "@/lib/riskPlanner";
import {
  parseSimulatorPreset,
  SIMULATION_RUNS,
  simulateChallenge,
  simulatorLink,
  TRADES_PER_DAY,
  type Outcome,
  type PhaseChoice,
  type SimulatorPreset,
} from "@/lib/challengeSimulator";
import { JOURNAL_MIN_DECISIVE_TRADES } from "@/lib/journalSimulator";
import {
  EXAMPLE_TRADE_RESULTS,
  MAX_TRADE_FILE_BYTES,
  MAX_TRADE_RESULTS,
  parseTradeResults,
  resizeTradeResults,
  summarizeTradeResults,
} from "@/lib/tradeResultsImport";

type Method = "fixed" | "own";
const readMethod = (params: URLSearchParams): Method => (params.get("smethod") === "own" ? "own" : "fixed");

const FIRST_SEED = 20261105;

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

interface State extends SimulatorPreset {
  accountSize: number;
  program: ProgramId;
}

const readState = (params: URLSearchParams): State => {
  const base = parseCalculatorPreset(params);
  const phaseCount = getRulePlan(base.accountSize, base.program).phases.length;
  return { accountSize: base.accountSize, program: base.program, ...parseSimulatorPreset(params, phaseCount) };
};

const OUTCOME_ROWS: { key: Outcome; label: string; tone: string }[] = [
  { key: "passed", label: "Passed", tone: "bg-emerald-500" },
  { key: "dailyBreach", label: "Broke the daily loss limit", tone: "bg-amber-500" },
  { key: "maxBreach", label: "Broke the maximum loss limit", tone: "bg-red-500" },
  { key: "outOfRoom", label: "Stopped: no room left above the maximum-loss floor", tone: "bg-red-400" },
  { key: "unfinished", label: "Still going when the day limit ran out", tone: "bg-muted-foreground" },
];

export default function ChallengeSimulator() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [state, setState] = useState<State>(() => readState(searchParams));
  const [seed, setSeed] = useState(FIRST_SEED);
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");
  const [method, setMethod] = useState<Method>(() => readMethod(searchParams));
  const [tradesText, setTradesText] = useState("");
  const [recordedSizeInput, setRecordedSizeInput] = useState("");
  const [fileMessage, setFileMessage] = useState("");

  // "Test this plan in the simulator" opens this section with the planner's choices.
  useEffect(() => {
    if (navigationType === "PUSH" && location.hash === "#simulator") {
      const params = new URLSearchParams(location.search);
      setState(readState(params));
      setMethod(readMethod(params));
    }
    // Only a new navigation should reload the choices, not typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const set = <K extends keyof State>(key: K, value: State[K]) => setState((s) => ({ ...s, [key]: value }));

  const { accountSize, program, phase, riskMode, riskInput, rewardRatio, winRateInput, tradesPerDay, dayLimitInput, costInput, stopBeforeBreach } = state;
  const plan = useMemo(() => getRulePlan(accountSize, program), [accountSize, program]);
  const phaseChoice: PhaseChoice = plan.phases.length === 1 ? 1 : phase === "all" ? "all" : Math.min(phase, plan.phases.length);

  const riskValue = Number(riskInput);
  const riskValid = riskInput.trim() !== "" && Number.isFinite(riskValue) && riskValue > 0 && (riskMode === "dollars" ? riskValue >= 0.01 : riskValue <= 100);
  const riskAmount = riskValid ? Math.round((riskMode === "percent" ? (accountSize * riskValue) / 100 : riskValue) * 100) / 100 : 0;
  const winRate = Number(winRateInput);
  const winRateValid = winRateInput.trim() !== "" && Number.isFinite(winRate) && winRate >= 1 && winRate <= 99;
  const dayLimit = Number(dayLimitInput);
  const dayLimitValid = dayLimitInput.trim() !== "" && Number.isInteger(dayLimit) && dayLimit >= 1 && dayLimit <= 250;
  const cost = costInput.trim() === "" ? 0 : Number(costInput);
  const costValid = Number.isFinite(cost) && cost >= 0 && cost <= 100_000;

  const dailyAllowance = Math.round(accountSize * plan.dailyLossPercent) / 100;
  const own = method === "own";

  // "My own trade results": the trader's pasted list, read on this device only.
  const parsed = useMemo(() => parseTradeResults(tradesText), [tradesText]);
  const recordedSize = recordedSizeInput.trim() === "" ? null : Number(recordedSizeInput.replace(/[$,\s]/g, ""));
  const recordedSizeValid = recordedSize === null || (Number.isFinite(recordedSize) && recordedSize >= 100 && recordedSize <= 10_000_000);
  const resized = useMemo(
    () => resizeTradeResults(parsed.values, recordedSizeValid ? recordedSize : null, accountSize),
    [parsed.values, recordedSize, recordedSizeValid, accountSize],
  );
  const outcomes = useMemo(() => resized.filter((v) => v !== 0), [resized]);
  const summary = useMemo(() => summarizeTradeResults(resized), [resized]);
  const decisive = summary.wins + summary.losses;
  const ownProblem = parsed.error
    ? parsed.error
    : !tradesText.trim()
      ? ""
      : decisive < JOURNAL_MIN_DECISIVE_TRADES
        ? `Add at least ${JOURNAL_MIN_DECISIVE_TRADES} winning or losing results (found ${decisive}).`
        : !summary.wins || !summary.losses
          ? "Add at least one winning and one losing result."
          : "";
  const ownListReady = tradesText.trim() !== "" && ownProblem === "" && recordedSizeValid;
  const ownCost = costValid ? cost : 0;

  const tooBigForDay = own
    ? ownListReady && summary.biggestLoss + ownCost > dailyAllowance
    : riskValid && riskAmount + ownCost > dailyAllowance;
  const ready = own ? ownListReady && dayLimitValid && costValid : riskValid && riskAmount > 0 && winRateValid && dayLimitValid && costValid;
  const blocked = ready && stopBeforeBreach && tooBigForDay;

  const result = useMemo(
    () =>
      ready && !blocked
        ? simulateChallenge({
            plan,
            phase: phaseChoice,
            riskAmount,
            rewardRatio,
            winRatePercent: winRate,
            tradesPerDay,
            dayLimit,
            costPerTrade: cost,
            stopBeforeBreach,
            runs: SIMULATION_RUNS,
            seed,
            tradeOutcomes: own ? outcomes : undefined,
          })
        : null,
    [ready, blocked, plan, phaseChoice, riskAmount, rewardRatio, winRate, tradesPerDay, dayLimit, cost, stopBeforeBreach, seed, own, outcomes],
  );

  const round = (n: number) => Math.round(n * 100) / 100;
  const winAmount = own ? round(summary.avgWin - ownCost) : round(riskAmount * rewardRatio - ownCost);
  const lossAmount = own ? round(summary.avgLoss + ownCost) : round(riskAmount + ownCost);
  const averagePerTrade = own
    ? outcomes.length
      ? round(outcomes.reduce((s, v) => s + v, 0) / outcomes.length - ownCost)
      : 0
    : winRateValid
      ? round((winRate / 100) * winAmount - (1 - winRate / 100) * lossAmount)
      : 0;
  const targetProfit = phaseChoice === "all" ? plan.phases.reduce((s, p) => s + p.targetProfit, 0) : plan.phases[phaseChoice - 1].targetProfit;

  const sharePath = simulatorLink({
    accountSize,
    program,
    phase: phaseChoice,
    riskMode,
    riskValue: riskValid ? riskValue : undefined,
    rewardRatio,
    winRate: winRateValid ? winRate : undefined,
    tradesPerDay,
    dayLimit: dayLimitValid ? dayLimit : undefined,
    costPerTrade: costValid ? cost : undefined,
    stopBeforeBreach,
  }).replace("#simulator", own ? "&smethod=own#simulator" : "#simulator");
  const shareUrl = typeof window === "undefined" ? sharePath : `${window.location.origin}${sharePath}`;
  useEffect(() => setShareState("idle"), [sharePath]);

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
    } catch {
      setShareState("manual");
    }
  };

  const switchMode = (mode: RiskMode) => {
    if (mode === riskMode) return;
    if (riskValid) {
      const next = mode === "dollars" ? (accountSize * riskValue) / 100 : (riskValue / accountSize) * 100;
      setState((s) => ({ ...s, riskMode: mode, riskInput: String(Math.round(next * 100) / 100) }));
    } else {
      set("riskMode", mode);
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_TRADE_FILE_BYTES) {
      setFileMessage(`${file.name} is larger than 1 MB. Export only the closed trades, or paste the profit column.`);
      return;
    }
    try {
      const text =
        typeof file.text === "function"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ""));
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
            });
      setTradesText(text);
      setFileMessage(`Read ${file.name} on this device.`);
    } catch {
      setFileMessage(`Couldn't read ${file.name}. Try saving it as CSV, or paste the results instead.`);
    }
  };

  const maxBucket = result ? Math.max(1, ...result.passDays.map((b) => b.count)) : 1;
  const phaseLabel = phaseChoice === "all" ? `all ${plan.phases.length} phases` : `phase ${phaseChoice}`;

  return (
    <section id="simulator" aria-labelledby="simulator-title" className="premium-card mb-8 scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
          <Dices size={18} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2 id="simulator-title" className="text-lg font-semibold">Challenge pass simulator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Play your plan forward {SIMULATION_RUNS.toLocaleString("en-US")} times with random wins and losses and see how often it reaches the target, how often a loss limit ends it, and how many trading days it usually takes, under the daily loss, maximum loss, minimum days and {CONSISTENCY_LIMIT_PERCENT}% consistency rules.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium mb-2">Account size</legend>
          <div className="flex flex-wrap gap-2">
            {challengeConfigs.map((c) => (
              <button key={c.accountSize} type="button" aria-pressed={accountSize === c.accountSize} className={chip(accountSize === c.accountSize)} onClick={() => set("accountSize", c.accountSize)}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Program</legend>
          <div className="flex flex-wrap gap-2">
            {programs.map((p) => (
              <button key={p} type="button" aria-pressed={program === p} className={chip(program === p)} onClick={() => set("program", p)}>
                {p}
              </button>
            ))}
          </div>
          {plan.phases.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Phases to simulate">
              {plan.phases.map((ph) => (
                <button key={ph.phase} type="button" aria-pressed={phaseChoice === ph.phase} className={chip(phaseChoice === ph.phase)} onClick={() => set("phase", ph.phase)}>
                  Phase {ph.phase}
                </button>
              ))}
              <button type="button" aria-pressed={phaseChoice === "all"} className={chip(phaseChoice === "all")} onClick={() => set("phase", "all")}>
                All phases
              </button>
            </div>
          )}
        </fieldset>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium" id="sim-method-label">Each simulated trade is</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="sim-method-label">
          <button type="button" aria-pressed={!own} className={chip(!own)} onClick={() => setMethod("fixed")}>A fixed win or loss at a set win rate</button>
          <button type="button" aria-pressed={own} className={chip(own)} onClick={() => setMethod("own")}>One of my own trade results</button>
        </div>
      </div>

      {own && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" data-testid="sim-own-results">
          <div>
            <label htmlFor="sim-trade-list" className="text-sm font-medium">Your closed-trade results (USD)</label>
            <textarea
              id="sim-trade-list"
              rows={7}
              spellCheck={false}
              className={`${inputClass} mt-1 font-mono`}
              placeholder={"120\n-80\n-75.50\n210"}
              value={tradesText}
              onChange={(e) => {
                setTradesText(e.target.value);
                setFileMessage("");
              }}
              aria-invalid={ownProblem !== ""}
              aria-describedby="sim-trade-list-help sim-trade-list-status"
            />
            <p id="sim-trade-list-help" className="mt-1 text-xs text-muted-foreground">
              One profit or loss per line (or separated by spaces), for example <span className="font-mono">-80</span>, <span className="font-mono">$1,250.50</span> or <span className="font-mono">(80)</span> for a loss. A CSV export with a "Profit" or "P/L" column works too; other columns are ignored. Up to {MAX_TRADE_RESULTS.toLocaleString("en-US")} results. Read on this device only: nothing is uploaded, saved or put in the share link.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
                <Upload size={16} aria-hidden="true" />
                Open a CSV or text file
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  className="sr-only"
                  data-testid="sim-trade-file"
                  onChange={(e) => {
                    void readFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setTradesText(EXAMPLE_TRADE_RESULTS); setRecordedSizeInput("25000"); setFileMessage("Filled in 20 made-up example results from a $25,000 account."); }}>
                Try made-up example results
              </button>
              {tradesText && (
                <button type="button" className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setTradesText(""); setFileMessage(""); }}>
                  Clear
                </button>
              )}
            </div>
            {fileMessage && <p className="mt-2 text-xs text-muted-foreground" role="status">{fileMessage}</p>}
          </div>
          <div>
            <label htmlFor="sim-recorded-size" className="text-sm font-medium">Account size these results were made on (optional)</label>
            <input id="sim-recorded-size" inputMode="decimal" className={`${inputClass} mt-1`} placeholder="e.g. 10000" value={recordedSizeInput} onChange={(e) => setRecordedSizeInput(e.target.value)} aria-invalid={!recordedSizeValid} aria-describedby="sim-recorded-size-help" />
            <p id="sim-recorded-size-help" className={`mt-1 text-xs ${recordedSizeValid ? "text-muted-foreground" : "text-destructive"}`}>
              {!recordedSizeValid
                ? "Enter an account size from $100 to $10,000,000, or leave it empty."
                : recordedSize !== null && recordedSize !== accountSize
                  ? `Each result is resized ×${Math.round((accountSize / recordedSize) * 1000) / 1000} to the same share of a ${usd(accountSize)} account.`
                  : "Leave empty to use the dollar amounts as they are."}
            </p>
            <div id="sim-trade-list-status" className="mt-4 text-sm" aria-live="polite">
              {ownProblem ? (
                <p className="text-destructive">{ownProblem}</p>
              ) : tradesText.trim() ? (
                <div className="rounded-md border border-border p-3" data-testid="sim-own-summary">
                  <p className="font-medium">
                    {plural(summary.trades, "result")} read{parsed.column ? ` from the "${parsed.column}" column` : ""}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
                    <dt className="text-muted-foreground">Wins / losses</dt>
                    <dd>{summary.wins} / {summary.losses}{summary.breakeven ? ` (+${summary.breakeven} breakeven, left out)` : ""}</dd>
                    <dt className="text-muted-foreground">Win rate</dt>
                    <dd>{summary.winRate}%</dd>
                    <dt className="text-muted-foreground">Average win / loss</dt>
                    <dd>{usd(summary.avgWin)} / {usd(summary.avgLoss)}</dd>
                    <dt className="text-muted-foreground">Biggest win / loss</dt>
                    <dd>{usd(summary.biggestWin)} / {usd(summary.biggestLoss)}</dd>
                    <dt className="text-muted-foreground">Net of all results</dt>
                    <dd className={summary.net < 0 ? "text-destructive" : ""}>{summary.net < 0 ? `-${usd(-summary.net)}` : usd(summary.net)}</dd>
                  </dl>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Paste your results or open a file to run the simulation.</p>
              )}
              {parsed.skipped.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Skipped {parsed.skipped.length >= 50 ? "50+" : parsed.skipped.length} piece{parsed.skipped.length === 1 ? "" : "s"} that {parsed.skipped.length === 1 ? "wasn't a number" : "weren't numbers"}: <span className="font-mono">{parsed.skipped.slice(0, 5).join(", ")}</span>{parsed.skipped.length > 5 ? "…" : ""}
                </p>
              )}
              {parsed.truncated && <p className="mt-2 text-xs text-muted-foreground">Only the first {MAX_TRADE_RESULTS.toLocaleString("en-US")} results are used.</p>}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {!own && (<>
        <div>
          <span className="text-sm font-medium" id="sim-risk-unit-label">Risk per trade</span>
          <div className="mt-1 flex gap-2" role="group" aria-labelledby="sim-risk-unit-label">
            <button type="button" aria-pressed={riskMode === "percent"} className={chip(riskMode === "percent")} onClick={() => switchMode("percent")}>% of account</button>
            <button type="button" aria-pressed={riskMode === "dollars"} className={chip(riskMode === "dollars")} onClick={() => switchMode("dollars")}>Dollars</button>
          </div>
          <label htmlFor="sim-risk" className="sr-only">{riskMode === "percent" ? "Risk per trade (% of account)" : "Risk per trade (USD)"}</label>
          <input id="sim-risk" inputMode="decimal" className={`${inputClass} mt-2`} value={riskInput} onChange={(e) => set("riskInput", e.target.value)} aria-invalid={!riskValid} aria-describedby="sim-risk-help" />
          <p id="sim-risk-help" className={`mt-1 text-xs ${riskValid ? "text-muted-foreground" : "text-destructive"}`}>
            {riskValid
              ? riskMode === "percent"
                ? `${usd(riskAmount)} on a ${usd(accountSize)} account.`
                : `${Math.round((riskAmount / accountSize) * 10000) / 100}% of a ${usd(accountSize)} account.`
              : riskMode === "percent"
                ? "Enter a percentage above 0, for example 0.5."
                : "Enter a dollar amount above 0, for example 125."}
          </p>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Reward per winning trade</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {REWARD_RATIOS.map((r) => (
              <button key={r} type="button" aria-pressed={rewardRatio === r} className={chip(rewardRatio === r)} onClick={() => set("rewardRatio", r)}>
                {r}× risk
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="sim-win-rate" className="text-sm font-medium">Win rate (%)</label>
          <input id="sim-win-rate" inputMode="decimal" className={`${inputClass} mt-1`} value={winRateInput} onChange={(e) => set("winRateInput", e.target.value)} aria-invalid={!winRateValid} aria-describedby="sim-win-rate-help" />
          <p id="sim-win-rate-help" className={`mt-1 text-xs ${winRateValid ? "text-muted-foreground" : "text-destructive"}`}>
            {winRateValid ? `Break-even before charges is ${Math.round((100 / (1 + rewardRatio)) * 100) / 100}% at ${rewardRatio}× reward.` : "Enter a win rate from 1 to 99."}
          </p>
        </div>
        </>)}
        <fieldset>
          <legend className="text-sm font-medium">Trades per day</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {TRADES_PER_DAY.map((n) => (
              <button key={n} type="button" aria-pressed={tradesPerDay === n} className={chip(tradesPerDay === n)} onClick={() => set("tradesPerDay", n)}>
                {n}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="sim-day-limit" className="text-sm font-medium">Give up after this many trading days</label>
          <input id="sim-day-limit" inputMode="numeric" className={`${inputClass} mt-1`} value={dayLimitInput} onChange={(e) => set("dayLimitInput", e.target.value)} aria-invalid={!dayLimitValid} aria-describedby="sim-day-limit-help" />
          <p id="sim-day-limit-help" className={`mt-1 text-xs ${dayLimitValid ? "text-muted-foreground" : "text-destructive"}`}>
            {dayLimitValid ? "Your own patience limit; this schedule has no maximum time limit." : "Enter a whole number of days from 1 to 250."}
          </p>
        </div>
        <div>
          <label htmlFor="sim-cost" className="text-sm font-medium">Charges per trade (USD)</label>
          <input id="sim-cost" inputMode="decimal" className={`${inputClass} mt-1`} value={costInput} onChange={(e) => set("costInput", e.target.value)} aria-invalid={!costValid} aria-describedby="sim-cost-help" />
          <p id="sim-cost-help" className={`mt-1 text-xs ${costValid ? "text-muted-foreground" : "text-destructive"}`}>
            {costValid ? "Commission and spread for one full trade. Net profit includes charges." : "Enter 0 or a positive amount."}
          </p>
        </div>
      </div>

      <label className="mt-6 flex items-start gap-3 text-sm cursor-pointer">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={stopBeforeBreach} onChange={(e) => set("stopBeforeBreach", e.target.checked)} />
        <span>
          <span className="font-medium">Stop for the day before a loss could break a floor</span>
          <span className="block text-xs text-muted-foreground">On: the trader skips any trade whose full loss{own ? " (your biggest loss, since the next trade could be that one)" : ""} would take equity below today's floor. Off: the trader takes every planned trade, so a bad streak records a breach.</span>
        </span>
      </label>

      {blocked && (
        <p className="mt-6 flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {own ? (
            <span>Your biggest loss here ({usd(round(summary.biggestLoss + ownCost))} with charges) is bigger than the whole {usd(dailyAllowance)} daily allowance, so a careful trader could never risk it. Choose a larger account size, enter the size these results were made on so they are resized, or turn off "Stop for the day" to see how often that loss breaks the limit.</span>
          ) : (
            <span>One full loss of {usd(lossAmount)} is bigger than the {usd(dailyAllowance)} daily allowance, so a careful trader could never place this trade. Lower the risk to run the simulation.</span>
          )}
        </p>
      )}

      {result && (
        <div className="mt-8" aria-live="polite">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold">Passed {phaseLabel}</h3>
              <p className="mt-2 text-4xl font-bold tabular-nums" data-testid="sim-pass-rate">{result.percents.passed}%</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {plural(result.counts.passed, "run")} of {result.runs.toLocaleString("en-US")} reached {usd(targetProfit)} {phaseChoice === "all" ? "of combined targets" : "profit"} with every condition met.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Typical trading days to pass</dt>
                  <dd className="text-xl font-bold tabular-nums">{result.medianDaysToPass ?? "—"}</dd>
                  {result.fastestPass !== null && <dd className="text-xs text-muted-foreground tabular-nums">{result.fastestPass}–{result.slowestPass} across passing runs</dd>}
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Average result per trade</dt>
                  <dd className={`text-xl font-bold tabular-nums ${averagePerTrade < 0 ? "text-destructive" : ""}`}>{averagePerTrade < 0 ? `-${usd(-averagePerTrade)}` : usd(averagePerTrade)}</dd>
                  <dd className="text-xs text-muted-foreground tabular-nums">{own ? "average " : ""}win {usd(winAmount)}, {own ? "average " : ""}loss {usd(lossAmount)}</dd>
                </div>
              </dl>
              {averagePerTrade <= 0 && (
                <p className="mt-3 text-xs text-destructive">{own ? "These results lose money on average after charges" : "At this win rate the plan loses money on average"}, so passing depends on a lucky streak.</p>
              )}
              {result.passesDelayedByRules > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  In {plural(result.passesDelayedByRules, "passing run")} the target was reached before the minimum {plan.minDays} trading days or the {CONSISTENCY_LIMIT_PERCENT}% rule were met, so trading had to continue.
                </p>
              )}
            </div>

            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold">How the {result.runs.toLocaleString("en-US")} runs ended</h3>
              <ul className="mt-3 space-y-3 text-sm">
                {OUTCOME_ROWS.filter((row) => row.key !== "outOfRoom" || stopBeforeBreach)
                  .filter((row) => row.key !== "dailyBreach" || !stopBeforeBreach)
                  .map((row) => (
                    <li key={row.key}>
                      <div className="flex justify-between gap-3">
                        <span>{row.label}</span>
                        <span className="tabular-nums font-medium">{result.percents[row.key]}%</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-secondary overflow-hidden" aria-hidden="true">
                        <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${result.percents[row.key]}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
              {result.passDays.length > 0 && (
                <figure className="mt-5">
                  <figcaption className="text-xs text-muted-foreground">Trading days used by passing runs</figcaption>
                  <div className="mt-2 flex items-end gap-1 h-20" aria-hidden="true">
                    {result.passDays.map((b) => (
                      <div key={b.from} className="flex-1 bg-primary/70 rounded-t-sm min-h-[2px]" style={{ height: `${(b.count / maxBucket) * 100}%` }} title={`${b.from === b.to ? b.from : `${b.from}–${b.to}`} days: ${b.count} runs`} />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums" aria-hidden="true">
                    <span>{result.passDays[0].from} days</span>
                    <span>{result.passDays[result.passDays.length - 1].to} days</span>
                  </div>
                  <table className="sr-only">
                    <caption>Trading days used by passing runs</caption>
                    <thead><tr><th>Trading days</th><th>Runs</th></tr></thead>
                    <tbody>
                      {result.passDays.map((b) => (
                        <tr key={b.from}><td>{b.from === b.to ? b.from : `${b.from} to ${b.to}`}</td><td>{b.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </figure>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setSeed((s) => s + 1)} disabled={!result} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <RefreshCw size={16} aria-hidden="true" />
          Run again with new random trades
        </button>
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {shareState === "copied" ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {shareState === "copied" ? "Link copied" : "Copy a link to this simulation"}
        </button>
        <span className="text-xs text-muted-foreground" role="status">
          {shareState === "copied" ? (own ? "Anyone opening it sees the same settings; your trade results are not included." : "Anyone opening it sees the same settings.") : ""}
        </span>
      </div>
      {shareState === "manual" && (
        <div className="mt-3">
          <label htmlFor="sim-share-url" className="text-xs text-muted-foreground">Copying isn't available in this browser. Select and copy this address:</label>
          <input id="sim-share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} mt-1`} />
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        A simulation of a hypothetical trader, not a prediction of your results and not trading advice. {own
          ? "Each simulated trade is one of your results picked at random (repeats allowed) with charges taken off, so the order of your trades, your streaks and any change in how you trade are not kept, and past results don't guarantee future ones."
          : "It assumes every loss is exactly your risk plus charges, every win is exactly the reward minus charges, the win rate never changes and trades don't affect each other."} Real trading has slippage, gaps, floating losses on open positions and losing streaks that cluster, and results are reviewed by people before any phase advances. Rules used: the published {plan.program} schedule for a {usd(accountSize)} account (daily loss {plan.dailyLossPercent}% from the 22:00 UTC reset balance, static maximum loss {plan.maxLossPercent}%, at least {plan.minDays} trading days per phase, best day no more than {CONSISTENCY_LIMIT_PERCENT}% of profit). Nothing here is saved or sent anywhere.
      </p>
    </section>
  );
}

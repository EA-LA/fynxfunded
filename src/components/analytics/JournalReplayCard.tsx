import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, History } from "lucide-react";
import type { Trade } from "@/lib/tradingData";
import { CONSISTENCY_LIMIT_PERCENT, getRulePlan, PROGRAMS, type ProgramId } from "@/lib/ruleCalculator";
import type { PhaseChoice } from "@/lib/challengeSimulator";
import { SUPPORTED_ACCOUNT_SIZES } from "@/lib/journalSimulator";
import { journalReplayTrades, replayRecord } from "@/lib/recordReplay";
import ReplayResultView, { dayDate } from "@/components/ReplayResultView";
import GlossaryTip from "@/components/GlossaryTip";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const sizeLabel = (n: number) => (n >= 1000 ? `$${n / 1000}K` : usd(n));
const chip = (active: boolean) =>
  `rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
  }`;

/** YYYY-MM-DD of the 22:00 UTC trading day a moment belongs to. */
const tradingDate = (ms: number) => new Date(ms + 2 * 3_600_000).toISOString().slice(0, 10);

/**
 * "Replay my journal day by day": the trader's own closed trades, in the order
 * they closed, played against the published schedule for a chosen size,
 * program and phase. Educational; never used to evaluate the account.
 */
export default function JournalReplayCard({
  trades: journal,
  accountSize,
  periodLabel,
  program: initialProgram,
}: {
  trades: Trade[];
  accountSize: number;
  periodLabel: string;
  program?: string;
}) {
  const recordSizeSupported = SUPPORTED_ACCOUNT_SIZES.includes(accountSize);
  const [size, setSize] = useState<number>(recordSizeSupported ? accountSize : 25000);
  const [program, setProgram] = useState<ProgramId>(() =>
    (PROGRAMS as string[]).includes(initialProgram ?? "") ? (initialProgram as ProgramId) : "2-phase",
  );
  const [phaseChoice, setPhaseChoice] = useState<PhaseChoice>(1);

  const plan = useMemo(() => getRulePlan(size, program), [size, program]);
  const phase: PhaseChoice = plan.phases.length === 1 ? 1 : phaseChoice === "all" ? "all" : Math.min(phaseChoice, plan.phases.length);

  const record = useMemo(() => journalReplayTrades(journal, accountSize, size), [journal, accountSize, size]);
  const result = useMemo(
    () => (record.trades.length ? replayRecord({ plan, phase, trades: record.trades, tradesPerDay: 1, costPerTrade: 0 }) : null),
    [record, plan, phase],
  );

  const first = record.trades[0]?.time ?? null;
  const last = record.trades[record.trades.length - 1]?.time ?? null;
  const rulesLink = `/rules?${new URLSearchParams({ size: String(size), program, ...(phase !== 1 ? { rphase: String(phase) } : {}) }).toString()}#replay`;

  return (
    <section id="journal-replay" className="premium-card scroll-mt-24" aria-labelledby="journal-replay-title" data-testid="journal-replay">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="journal-replay-title" className="flex items-center gap-2 font-semibold">
            <History size={16} aria-hidden="true" />
            Your journal, replayed day by day
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Plays your closed trades ({periodLabel}) back in the order they closed, grouped into 22:00 UTC <GlossaryTip term="trading-day">trading days</GlossaryTip>, against the published rules. Nothing is shuffled or averaged: you see the exact day this record would have passed, broken a limit, or what was still missing.
          </p>
        </div>
        <Link to={rulesLink} className="text-xs font-medium underline underline-offset-4 hover:text-foreground">
          Replay a broker export instead
        </Link>
      </div>

      {!journal.length ? (
        <div className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="journal-replay-empty">
          <p>No closed trades in this period yet. The replay appears here after your first closed trade.</p>
          <Link to="/rules#replay" className="mt-3 inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
            Replay a record you paste in <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="text-xs font-medium">
              Account size
              <select
                className="mt-1 block rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                data-testid="journal-replay-size"
              >
                {SUPPORTED_ACCOUNT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {sizeLabel(s)}
                    {s === accountSize ? " (your account)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <p className="text-xs font-medium" id="journal-replay-program">Program</p>
              <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby="journal-replay-program">
                {PROGRAMS.map((p) => (
                  <button type="button" key={p} aria-pressed={program === p} className={chip(program === p)} onClick={() => setProgram(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            {plan.phases.length > 1 && (
              <div>
                <p className="text-xs font-medium" id="journal-replay-phase">Replay against</p>
                <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby="journal-replay-phase">
                  {plan.phases.map((ph) => (
                    <button type="button" key={ph.phase} aria-pressed={phase === ph.phase} className={chip(phase === ph.phase)} onClick={() => setPhaseChoice(ph.phase)}>
                      Phase {ph.phase}
                    </button>
                  ))}
                  <button type="button" aria-pressed={phase === "all"} className={chip(phase === "all")} onClick={() => setPhaseChoice("all")}>
                    All phases in a row
                  </button>
                </div>
              </div>
            )}
          </div>

          <p className="mt-3 max-w-3xl text-xs text-muted-foreground" data-testid="journal-replay-read">
            {record.trades.length.toLocaleString("en-US")} closed trade{record.trades.length === 1 ? "" : "s"}
            {first !== null && last !== null ? `, ${dayDate(tradingDate(first))} to ${dayDate(tradingDate(last))}` : ""}
            {record.scale !== 1 && accountSize > 0 ? `, each resized ×${Math.round(record.scale * 1000) / 1000} from your ${usd(accountSize)} account to the same share of ${usd(size)}` : ""}.
            {record.undated > 0 ? ` ${record.undated} trade${record.undated === 1 ? "" : "s"} without a readable close time left out.` : ""} The replay starts from the full account size at the first trade shown, so if this period begins partway through an evaluation, the starting point differs from your real account. Choose "All" above to start from the beginning of your record.
          </p>

          {result ? (
            <div className="mt-5">
              <ReplayResultView result={result} plan={plan} recordLabel="Your journal" />
            </div>
          ) : (
            <p className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              None of these trades has a readable close time, so they can't be placed in trading days.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-3xl text-[11px] text-muted-foreground">
              An educational replay of past closed trades, not your official status and not advice. It never affects your account: the real evaluation is on your Objectives page. Only closed results are visible here, while the real check also counts floating losses on open trades (<GlossaryTip term="equity">equity</GlossaryTip>), so a real account could hit a floor earlier than shown, never later. Results are after the commission and swap recorded with each trade. Rules used: the published {plan.program} schedule for a {usd(size)} account (daily loss {plan.dailyLossPercent}% from the 22:00 UTC reset balance, static maximum loss {plan.maxLossPercent}%, at least {plan.minDays} trading days per phase, best day no more than {CONSISTENCY_LIMIT_PERCENT}% of phase profit).
            </p>
            <Link to="/dashboard/objectives" className="inline-flex items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              See your real objectives <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

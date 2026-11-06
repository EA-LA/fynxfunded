import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";
import { Check, History, Link2, Upload } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { CONSISTENCY_LIMIT_PERCENT, getRulePlan, parseCalculatorPreset, PROGRAMS as programs, type ProgramId } from "@/lib/ruleCalculator";
import { TRADES_PER_DAY, type PhaseChoice } from "@/lib/challengeSimulator";
import { MAX_TRADE_FILE_BYTES, MAX_TRADE_RESULTS } from "@/lib/tradeResultsImport";
import {
  EXAMPLE_DATED_RESULTS,
  offsetLabel,
  parseDatedTradeResults,
  replayRecord,
  TIME_OFFSETS,
} from "@/lib/recordReplay";
import GlossaryTip from "@/components/GlossaryTip";
import ReplayResultView from "@/components/ReplayResultView";

const usd = (n: number) => {
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const cents = Number.isInteger(abs) ? 0 : 2;
  return `${n < 0 && abs > 0 ? "-" : ""}${abs.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents, maximumFractionDigits: cents })}`;
};

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;


interface Choice {
  accountSize: number;
  program: ProgramId;
  phase: PhaseChoice;
}

const readChoice = (params: URLSearchParams): Choice => {
  const base = parseCalculatorPreset(params);
  const count = getRulePlan(base.accountSize, base.program).phases.length;
  const raw = params.get("rphase");
  const n = Number(raw);
  const phase: PhaseChoice = raw === "all" ? "all" : Number.isInteger(n) && n >= 1 && n <= count ? n : 1;
  return { accountSize: base.accountSize, program: base.program, phase };
};

export default function RecordReplay() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [choice, setChoice] = useState<Choice>(() => readChoice(searchParams));
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  const [tradesPerDay, setTradesPerDay] = useState<number>(2);
  const [recordedSizeInput, setRecordedSizeInput] = useState("");
  const [costInput, setCostInput] = useState("0");
  const [fileMessage, setFileMessage] = useState("");
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");

  useEffect(() => {
    if (navigationType === "PUSH" && location.hash === "#replay") setChoice(readChoice(new URLSearchParams(location.search)));
    // Only a new navigation should reload the choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const { accountSize, program } = choice;
  const plan = useMemo(() => getRulePlan(accountSize, program), [accountSize, program]);
  const phase: PhaseChoice = plan.phases.length === 1 ? 1 : choice.phase === "all" ? "all" : Math.min(choice.phase, plan.phases.length);

  const parsed = useMemo(() => parseDatedTradeResults(text, offset), [text, offset]);
  const recordedSize = recordedSizeInput.trim() === "" ? null : Number(recordedSizeInput.replace(/[$,\s]/g, ""));
  const recordedSizeValid = recordedSize === null || (Number.isFinite(recordedSize) && recordedSize >= 100 && recordedSize <= 10_000_000);
  const cost = costInput.trim() === "" ? 0 : Number(costInput);
  const costValid = Number.isFinite(cost) && cost >= 0 && cost <= 100_000;
  const scale = recordedSizeValid && recordedSize ? accountSize / recordedSize : 1;

  const trades = useMemo(
    () => parsed.trades.map((t) => ({ ...t, value: Math.round(t.value * scale * 100) / 100 })),
    [parsed.trades, scale],
  );
  const problem = parsed.error ?? (text.trim() && !trades.length ? "No results found. Paste one profit or loss per line, or a CSV with a Profit column." : "");
  const ready = trades.length > 0 && !problem && recordedSizeValid && costValid;

  const result = useMemo(
    () => (ready ? replayRecord({ plan, phase, trades, tradesPerDay, costPerTrade: cost }) : null),
    [ready, plan, phase, trades, tradesPerDay, cost],
  );

  const params = new URLSearchParams({ size: String(accountSize), program });
  if (phase !== 1) params.set("rphase", String(phase));
  const sharePath = `/rules?${params.toString()}#replay`;
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

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_TRADE_FILE_BYTES) {
      setFileMessage(`${file.name} is larger than 1 MB. Export only the closed trades, or paste the close time and profit columns.`);
      return;
    }
    try {
      const content =
        typeof file.text === "function"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ""));
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
            });
      setText(content);
      setFileMessage(`Read ${file.name} on this device.`);
    } catch {
      setFileMessage(`Couldn't read ${file.name}. Try saving it as CSV, or paste the results instead.`);
    }
  };

  const phaseLabel = phase === "all" ? `all ${plan.phases.length} phases` : `phase ${phase}`;

  return (
    <section id="replay" aria-labelledby="replay-title" className="premium-card mb-8 scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
          <History size={18} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2 id="replay-title" className="text-lg font-semibold">Replay your record day by day</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Play your real closed trades back in the order they happened, grouped into the same 22:00 UTC <GlossaryTip term="trading-day">trading days</GlossaryTip> the <GlossaryTip term="daily-loss-limit">daily loss limit</GlossaryTip> uses, and see the exact day this account would have passed, broken a limit, or what was still missing. Unlike the simulator above, nothing is shuffled: your streaks and bad days stay where they were.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium mb-2">Account size</legend>
          <div className="flex flex-wrap gap-2">
            {challengeConfigs.map((c) => (
              <button key={c.accountSize} type="button" aria-pressed={accountSize === c.accountSize} className={chip(accountSize === c.accountSize)} onClick={() => setChoice((s) => ({ ...s, accountSize: c.accountSize }))}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Program</legend>
          <div className="flex flex-wrap gap-2">
            {programs.map((p) => (
              <button key={p} type="button" aria-pressed={program === p} className={chip(program === p)} onClick={() => setChoice((s) => ({ ...s, program: p }))}>
                {p}
              </button>
            ))}
          </div>
          {plan.phases.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Phases to replay">
              {plan.phases.map((ph) => (
                <button key={ph.phase} type="button" aria-pressed={phase === ph.phase} className={chip(phase === ph.phase)} onClick={() => setChoice((s) => ({ ...s, phase: ph.phase }))}>
                  Phase {ph.phase}
                </button>
              ))}
              <button type="button" aria-pressed={phase === "all"} className={chip(phase === "all")} onClick={() => setChoice((s) => ({ ...s, phase: "all" }))}>
                All phases in a row
              </button>
            </div>
          )}
        </fieldset>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor="replay-list" className="text-sm font-medium">Your closed trades: close time and result (USD)</label>
          <textarea
            id="replay-list"
            rows={7}
            spellCheck={false}
            className={`${inputClass} mt-1 font-mono`}
            placeholder={"Close time,Profit\n2026-10-05 14:10,250\n2026-10-06 09:05,-125"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileMessage("");
            }}
            aria-invalid={problem !== ""}
            aria-describedby="replay-list-help replay-status"
          />
          <p id="replay-list-help" className="mt-1 text-xs text-muted-foreground">
            Paste or open a broker CSV export: the "Profit" / "P/L" column and the close-time column ("Close time", "Time" or "Date") are found by name. Lines like <span className="font-mono">2026-10-05 14:10, -80</span> work too. Use year-first dates. Without dates, results are replayed in the order given, a set number per day. Up to {MAX_TRADE_RESULTS.toLocaleString("en-US")} trades. Read on this device only: nothing is uploaded, saved or put in the share link.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
              <Upload size={16} aria-hidden="true" />
              Open a CSV or text file
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="sr-only"
                data-testid="replay-file"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setText(EXAMPLE_DATED_RESULTS);
                setRecordedSizeInput("25000");
                setOffset(0);
                setFileMessage("Filled in 20 made-up example trades from a $25,000 account (times in UTC).");
              }}
            >
              Try a made-up example record
            </button>
            {text && (
              <button type="button" className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setText(""); setFileMessage(""); }}>
                Clear
              </button>
            )}
          </div>
          {fileMessage && <p className="mt-2 text-xs text-muted-foreground" role="status">{fileMessage}</p>}
        </div>

        <div className="space-y-4">
          {parsed.dated ? (
            <div>
              <label htmlFor="replay-offset" className="text-sm font-medium">Times in this record are in</label>
              <select id="replay-offset" className={`${inputClass} mt-1`} value={offset} onChange={(e) => setOffset(Number(e.target.value))} aria-describedby="replay-offset-help">
                {TIME_OFFSETS.map((m) => (
                  <option key={m} value={m}>{offsetLabel(m)}{m === 120 ? " (common broker server time in winter)" : m === 180 ? " (common broker server time in summer)" : ""}</option>
                ))}
              </select>
              <p id="replay-offset-help" className="mt-1 text-xs text-muted-foreground">Decides which trading day each trade lands in. Times that already say Z, UTC or +02:00 are read as written.</p>
            </div>
          ) : (
            <fieldset>
              <legend className="text-sm font-medium">No dates: trades per trading day</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {TRADES_PER_DAY.map((n) => (
                  <button key={n} type="button" aria-pressed={tradesPerDay === n} className={chip(tradesPerDay === n)} onClick={() => setTradesPerDay(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Add a close-time column for real trading days.</p>
            </fieldset>
          )}
          <div>
            <label htmlFor="replay-recorded-size" className="text-sm font-medium">Account size these trades were made on (optional)</label>
            <input id="replay-recorded-size" inputMode="decimal" className={`${inputClass} mt-1`} placeholder="e.g. 10000" value={recordedSizeInput} onChange={(e) => setRecordedSizeInput(e.target.value)} aria-invalid={!recordedSizeValid} aria-describedby="replay-recorded-size-help" />
            <p id="replay-recorded-size-help" className={`mt-1 text-xs ${recordedSizeValid ? "text-muted-foreground" : "text-destructive"}`}>
              {!recordedSizeValid
                ? "Enter an account size from $100 to $10,000,000, or leave it empty."
                : recordedSize !== null && recordedSize !== accountSize
                  ? `Each result is resized ×${Math.round(scale * 1000) / 1000} to the same share of a ${usd(accountSize)} account.`
                  : "Leave empty to use the dollar amounts as they are."}
            </p>
          </div>
          <div>
            <label htmlFor="replay-cost" className="text-sm font-medium">Extra charges per trade (USD)</label> <GlossaryTip term="commission" />
            <input id="replay-cost" inputMode="decimal" className={`${inputClass} mt-1`} value={costInput} onChange={(e) => setCostInput(e.target.value)} aria-invalid={!costValid} aria-describedby="replay-cost-help" />
            <p id="replay-cost-help" className={`mt-1 text-xs ${costValid ? "text-muted-foreground" : "text-destructive"}`}>
              {costValid ? "Leave at 0 if your profit figures already include commission and swap." : "Enter 0 or a positive amount."}
            </p>
          </div>
        </div>
      </div>

      <div id="replay-status" className="mt-4 text-sm" aria-live="polite">
        {problem ? (
          <p className="text-destructive">{problem}</p>
        ) : trades.length ? (
          <p className="text-xs text-muted-foreground" data-testid="replay-read">
            {plural(trades.length, "trade")} read{parsed.column ? ` from the "${parsed.column}" column` : ""}
            {parsed.dated ? `${parsed.timeColumn ? `, dated by "${parsed.timeColumn}"` : ""}, ${offsetLabel(offset)}` : ", in the order given (no dates)"}.
            {parsed.skipped.length > 0 && <> Skipped {parsed.skipped.length >= 50 ? "50+" : parsed.skipped.length} unreadable piece{parsed.skipped.length === 1 ? "" : "s"}: <span className="font-mono">{parsed.skipped.slice(0, 4).join(", ")}</span>{parsed.skipped.length > 4 ? "…" : ""}</>}
            {parsed.truncated && <> Only the first {MAX_TRADE_RESULTS.toLocaleString("en-US")} are used.</>}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Paste your trades, open a file or try the example to see the replay.</p>
        )}
      </div>

      {result && <ReplayResultView result={result} plan={plan} />}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {shareState === "copied" ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {shareState === "copied" ? "Link copied" : "Copy a link to this replay's settings"}
        </button>
        <span className="text-xs text-muted-foreground" role="status">
          {shareState === "copied" ? "It opens this section on the same size, program and phase; your trades are not included." : ""}
        </span>
      </div>
      {shareState === "manual" && (
        <div className="mt-3">
          <label htmlFor="replay-share-url" className="text-xs text-muted-foreground">Copying isn't available in this browser. Select and copy this address:</label>
          <input id="replay-share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} mt-1`} />
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        An educational replay, not an official result and not trading advice. It only sees closed results: the real check also counts floating losses on open trades (<GlossaryTip term="equity">equity</GlossaryTip>), so a real account could have hit a floor earlier than shown here, never later. Each phase restarts from the full account size on the next trading day, and every phase is reviewed by people before it advances. Rules used: the published {plan.program} schedule for a {usd(accountSize)} account (daily loss {plan.dailyLossPercent}% from the 22:00 UTC reset balance, static maximum loss {plan.maxLossPercent}%, at least {plan.minDays} trading days per phase, best day no more than {CONSISTENCY_LIMIT_PERCENT}% of phase profit). Nothing here is saved or sent anywhere.
      </p>
    </section>
  );
}

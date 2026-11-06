import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { PROGRAMS, type ProgramId } from "@/lib/ruleCalculator";
import { estimatePayout, MINIMUM_PAYOUT_USD, splitTable } from "@/lib/payoutEstimator";
import { feePayback } from "@/lib/fundingCost";
import { simulatorLink } from "@/lib/challengeSimulator";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const programLabel = (p: ProgramId) => p.replace("-", " ");

/** Full split schedule: every account size × program, from the published catalog. */
export function SplitTable() {
  const rows = splitTable();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Profit split by account size and program">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="text-left py-3 px-3 font-medium text-muted-foreground">Account size</th>
            {PROGRAMS.map((p) => (
              <th key={p} scope="col" className="text-right py-3 px-3 font-medium text-muted-foreground capitalize">{programLabel(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.accountSize}>
              <th scope="row" className="text-left py-3 px-3 font-medium">{r.label}</th>
              {PROGRAMS.map((p) => (
                <td key={p} className="py-3 px-3 text-right tabular-nums">{r.splits[p]}%</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Interactive illustration: how a funded-account profit would be split. */
export default function PayoutEstimator() {
  const [accountSize, setAccountSize] = useState(25000);
  const [program, setProgram] = useState<ProgramId>("2-phase");
  const [profitText, setProfitText] = useState("1000");
  const inputId = useId();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash === "#estimator") sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [location.hash]);
  const profit = Number.parseFloat(profitText.replace(/[$,\s]/g, ""));
  const e = estimatePayout(accountSize, program, profit);
  const fee = feePayback(accountSize, program, e.traderShare);

  return (
    <section ref={sectionRef} id="estimator" aria-labelledby="estimator-title" className="premium-card mb-16 scroll-mt-24 animate-fade-up">
      <h2 id="estimator-title" className="text-xl font-bold">Payout estimator</h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
        See how profit in a funded account would be split under the published schedule. This is an illustration only: eligibility, review and the terms recorded with your purchase decide the actual amount.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
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
            <legend className="text-sm font-medium mb-2">Program you passed</legend>
            <div className="flex flex-wrap gap-2">
              {PROGRAMS.map((p) => (
                <button key={p} type="button" aria-pressed={program === p} className={`${chip(program === p)} capitalize`} onClick={() => setProgram(p)}>
                  {programLabel(p)}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={inputId} className="text-sm font-medium">Net profit in the funded account (USD)</label>
            <input
              id={inputId}
              inputMode="decimal"
              value={profitText}
              onChange={(ev) => setProfitText(ev.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {e.profit > 0 ? `That is ${e.profitPercentOfAccount}% of the ${usd(accountSize)} account.` : "Enter a profit above zero."}
            </p>
          </div>
        </div>

        <div aria-live="polite" className="rounded-md bg-secondary p-5">
          <p className="text-sm text-muted-foreground">Estimated share for you ({e.splitPercent}%)</p>
          <p className="mt-1 text-4xl font-bold tabular-nums" data-testid="trader-share">{usd(e.traderShare)}</p>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Net profit</dt>
              <dd className="tabular-nums">{usd(e.profit)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Firm share ({100 - e.splitPercent}%)</dt>
              <dd className="tabular-nums">{usd(e.firmShare)}</dd>
            </div>
          </dl>
          <p className="mt-5 flex items-start gap-2 text-sm">
            {e.meetsMinimum ? (
              <>
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>Above the {usd(MINIMUM_PAYOUT_USD)} minimum payout amount.</span>
              </>
            ) : (
              <>
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                <span>
                  Below the {usd(MINIMUM_PAYOUT_USD)} minimum. You would need about {usd(e.profitForMinimum)} net profit at a {e.splitPercent}% split.
                </span>
              </>
            )}
          </p>
          <div className="mt-4 border-t border-border pt-4 text-sm" data-testid="fee-payback">
            <p className="font-medium">Compared with the challenge fee</p>
            <p className="mt-1 text-muted-foreground">
              {e.traderShare <= 0
                ? `This challenge costs ${usd(fee.fee)}. Your share would cover it from about ${usd(fee.profitToCoverFee)} net profit (${fee.profitToCoverFeePercent}% of the account).`
                : fee.covered
                  ? `Your share would cover the ${usd(fee.fee)} fee for this challenge ${fee.timesFee >= 2 ? `${fee.timesFee.toLocaleString("en-US")} times` : "once"}${fee.timesFee >= 2 ? "" : ` (from about ${usd(fee.profitToCoverFee)} net profit)`}.`
                  : `Your share would be ${usd(fee.shortBy)} short of the ${usd(fee.fee)} fee for this challenge. It covers the fee from about ${usd(fee.profitToCoverFee)} net profit (${fee.profitToCoverFeePercent}% of the account).`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              One attempt at today's published price. To include retakes, see{" "}
              <Link to={simulatorLink({ accountSize, program, phase: "all" })} className="underline">what getting funded could cost</Link> in the pass simulator.
            </p>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            The other checklist items below still apply.{" "}
            <Link to="/rules#calculator" className="underline">Check targets and loss limits</Link>
          </p>
        </div>
      </div>
    </section>
  );
}

import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { fundingCost } from "@/lib/fundingCost";
import { MINIMUM_PAYOUT_USD } from "@/lib/payoutEstimator";
import type { ProgramId } from "@/lib/ruleCalculator";
import GlossaryTip from "@/components/GlossaryTip";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

interface Props {
  accountSize: number;
  program: ProgramId;
  passed: number;
  ended: number;
  unfinished: number;
}

/**
 * Turns the simulator's pass rate into what getting funded could cost in fees,
 * and the funded profit needed to earn that back at the plan's split.
 */
export default function FundingCostCard({ accountSize, program, passed, ended, unfinished }: Props) {
  const c = fundingCost({ accountSize, program, passed, ended, unfinished });
  const sizeLabel = usd(accountSize);
  return (
    <section aria-labelledby="funding-cost-title" className="mt-6 rounded-md border border-border p-4" data-testid="funding-cost">
      <h3 id="funding-cost-title" className="text-sm font-semibold">What getting funded could cost at these odds</h3>
      {!c ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Every run was still going when your day limit ran out, so there are no finished attempts to work out the cost from. Raise the day limit and run it again.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            The {sizeLabel} {program} challenge costs <strong className="text-foreground">{usd(c.fee)}</strong> <GlossaryTip term="challenge-fee" /> per attempt. Among finished runs, {c.passChancePercent}% passed every phase.
          </p>
          {c.expectedAttempts === null ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>No simulated run passed, so this plan would keep paying fees without getting funded. Change the plan before paying for an attempt.</span>
            </p>
          ) : (
            <>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                <div className="rounded-md bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">Attempts on average</dt>
                  <dd className="text-xl font-bold tabular-nums" data-testid="funding-attempts">{c.expectedAttempts.toLocaleString("en-US")}</dd>
                  <dd className="text-xs text-muted-foreground">{c.attemptsFor90 === 1 ? "1 attempt" : `${c.attemptsFor90} attempts`} for a 90% chance</dd>
                </div>
                <div className="rounded-md bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">Fees paid on average</dt>
                  <dd className="text-xl font-bold tabular-nums" data-testid="funding-fees">{usd(c.expectedFees!)}</dd>
                  <dd className="text-xs text-muted-foreground">{usd(c.fee)} × {c.expectedAttempts.toLocaleString("en-US")}</dd>
                </div>
                <div className="rounded-md bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">
                    Funded profit to earn that back <GlossaryTip term="profit-split" />
                  </dt>
                  <dd className="text-xl font-bold tabular-nums" data-testid="funding-payback">{usd(c.profitToCoverExpectedFees!)}</dd>
                  <dd className="text-xs text-muted-foreground">
                    {c.profitToCoverExpectedPercent}% of {sizeLabel} at your {c.splitPercent}% split
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">Chance of being funded within</p>
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
                  {c.withinAttempts.map((w) => (
                    <li key={w.attempts} className="rounded-md border border-border px-3 py-2">
                      <span className="block text-xs text-muted-foreground">{w.attempts === 1 ? "1 attempt" : `${w.attempts} attempts`}</span>
                      <span className="tabular-nums font-medium">{w.percent}%</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">{usd(c.fee * w.attempts)} in fees at most</span>
                    </li>
                  ))}
                </ul>
              </div>
              {c.lowSample && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Only a few runs passed, so these figures move a lot each time you run it again.
                </p>
              )}
            </>
          )}
          {c.unfinishedPercent > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {c.unfinishedPercent}% of runs were still going at your day limit. They are left out here: challenges have no time limit, so they don't need a new fee.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Assumes every attempt has the same odds and costs today's published fee, with no refund, discount or promotion. Fee-refund eligibility depends on the terms shown at purchase (
            <Link to="/refund-policy" className="underline">refund policy</Link>), payouts start at the {usd(MINIMUM_PAYOUT_USD)} minimum and every request is reviewed.{" "}
            <Link to="/payouts#estimator" className="underline">Estimate a payout</Link>
          </p>
        </>
      )}
    </section>
  );
}

import { Link } from "react-router-dom";
import { PieChart } from "lucide-react";
import { publicAccountReference } from "@/lib/publicReferences";
import { traderShare, type FundedLike, type FundedSplitRow } from "@/lib/fundedSplit";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const EXAMPLE_PROFIT = 1000;

/** Dashboard Payouts: each funded account's profit split from the published schedule, with a worked example. */
export default function FundedSplitCard({ rows }: { rows: FundedSplitRow<FundedLike>[] }) {
  if (!rows.length) return null;
  return (
    <section className="premium-card" aria-labelledby="funded-split-title" data-testid="funded-split-card">
      <div className="flex items-center gap-2 mb-1">
        <PieChart size={16} className="text-muted-foreground" aria-hidden="true" />
        <h3 id="funded-split-title" className="text-sm font-semibold">Your profit split</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        From the published schedule for each funded account’s size and program. The amount paid is the one confirmed when a payout request is reviewed.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 text-left font-medium">Account</th>
              <th scope="col" className="py-2 pr-3 text-left font-medium">Plan</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Your split</th>
              <th scope="col" className="py-2 text-right font-medium">Of {usd(EXAMPLE_PROFIT)} approved profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ challenge, splitPercent, programLabel }) => (
              <tr key={challenge.challengeId} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3 font-mono text-xs">{publicAccountReference(challenge)}</td>
                <td className="py-2 pr-3">{challenge.accountSize.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} · {programLabel}</td>
                <td className="py-2 pr-3 text-right font-semibold">{splitPercent === null ? "—" : `${splitPercent}%`}</td>
                <td className="py-2 text-right">
                  {splitPercent === null
                    ? <Link to="/dashboard/objectives" className="text-xs underline-offset-4 hover:underline">Not in the schedule · see Objectives</Link>
                    : <span>you {usd(traderShare(EXAMPLE_PROFIT, splitPercent))} · FYNX {usd(EXAMPLE_PROFIT - traderShare(EXAMPLE_PROFIT, splitPercent))}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">The {usd(EXAMPLE_PROFIT)} is an example amount, not your balance.</p>
    </section>
  );
}

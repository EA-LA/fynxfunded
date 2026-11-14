import { useMemo } from "react";
import GlossaryTip from "@/components/GlossaryTip";
import type { Trade } from "@/lib/tradingData";
import { formatR, rMultipleSummary, R_MIN_TRADES } from "@/lib/rMultiples";

/**
 * R-multiple distribution for the trades given (dashboard Analytics and the
 * account Analysis tab). Uses only trades that recorded their risk at entry;
 * FYNX Trade records do this for every trade opened with a stop loss.
 */
export default function RMultipleCard({ trades }: { trades: Trade[] }) {
  const s = useMemo(() => rMultipleSummary(trades), [trades]);
  const peak = Math.max(1, ...s.buckets.map(b => b.count));
  const tiles: Array<[string, string]> = [
    ["Average", s.average === null ? "—" : formatR(s.average)],
    ["Median", s.median === null ? "—" : formatR(s.median)],
    ["Best / worst", s.best === null || s.worst === null ? "—" : `${formatR(s.best)} / ${formatR(s.worst)}`],
    ["Total", s.count ? formatR(s.sum) : "—"],
  ];
  return (
    <div className="premium-card" data-testid="r-multiple-card">
      <h3 className="flex items-center gap-1 font-semibold">Results in R<GlossaryTip term="r-multiple" /></h3>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="r-coverage">
        {s.count
          ? `${s.count} of ${s.total} closed trade${s.total === 1 ? "" : "s"} recorded the risk taken at entry. 1R is what the entry stop loss put at risk.`
          : s.total
            ? "None of these trades recorded the risk taken at entry, so no R-multiples are shown. FYNX Trade records it for every trade opened with a stop loss."
            : "No closed trades in this period."}
      </p>
      {s.count > 0 && <>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([k, v]) => <div className="rounded-lg bg-secondary/50 px-3 py-2" key={k}><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-sm font-semibold tabular-nums">{v}</p></div>)}
        </div>
        <ul className="mt-4 space-y-1.5" aria-label="Trades by result in R">
          {s.buckets.map(b => (
            <li key={b.key} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 text-xs" data-testid={`r-bucket-${b.key}`}>
              <span className="text-muted-foreground">{b.label}</span>
              <span className="h-2.5 rounded-full bg-secondary" aria-hidden="true">
                <span className={`block h-full rounded-full ${b.max <= 0 ? "bg-muted-foreground/60" : "bg-foreground/80"}`} style={{ width: `${(b.count / peak) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{b.count}{b.count ? ` · ${b.share.toFixed(0)}%` : ""}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="r-note">
          {s.note ?? `A reading appears once at least ${R_MIN_TRADES} trades have a recorded risk.`}
          {s.twoROrMore > 0 && ` ${s.twoROrMore} trade${s.twoROrMore === 1 ? "" : "s"} made 2R or more.`}
        </p>
      </>}
    </div>
  );
}

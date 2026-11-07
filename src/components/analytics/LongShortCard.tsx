import { useMemo } from "react";
import GlossaryTip from "@/components/GlossaryTip";
import type { Trade } from "@/lib/tradingData";
import { sideBreakdown, SIDE_MIN_TRADES, type SideStats } from "@/lib/sideBreakdown";

const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);

function SideTile({ label, side }: { label: "Long" | "Short"; side: SideStats }) {
  return (
    <div className="rounded-lg bg-secondary/50 p-4" data-testid={`side-${label.toLowerCase()}`}>
      <p className="text-xs text-muted-foreground">{label} ({label === "Long" ? "Buy" : "Sell"})</p>
      <b className={`mt-2 block text-xl tabular-nums ${side.pnl < 0 ? "text-destructive" : ""}`}>{money(side.pnl)}</b>
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Trades</dt><dd className="tabular-nums">{side.count}{side.count ? ` · ${side.share.toFixed(0)}%` : ""}</dd></div>
        <div className="flex justify-between gap-2"><dt className="flex items-center gap-1 text-muted-foreground">Win rate<GlossaryTip term="win-rate" /></dt><dd className="tabular-nums">{side.count ? `${side.winRate.toFixed(1)}%` : "—"}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Wins / losses</dt><dd className="tabular-nums">{side.count ? `${side.wins} / ${side.losses}` : "—"}</dd></div>
        <div className="flex justify-between gap-2"><dt className="flex items-center gap-1 text-muted-foreground">Average per trade<GlossaryTip term="expectancy" /></dt><dd className="tabular-nums">{side.count ? money(side.average) : "—"}</dd></div>
      </dl>
    </div>
  );
}

/** Long (Buy) vs short (Sell) results for the trades given; used on dashboard Analytics and the account Analysis tab. */
export default function LongShortCard({ trades, title = "Long / short comparison", description }: { trades: Trade[]; title?: string; description?: string }) {
  const b = useMemo(() => sideBreakdown(trades), [trades]);
  return (
    <div className="premium-card" data-testid="long-short-card">
      <h3 className="flex items-center gap-1 font-semibold">{title}<GlossaryTip term="long-short" /></h3>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SideTile label="Long" side={b.long} />
        <SideTile label="Short" side={b.short} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground" data-testid="side-note">
        {b.note ?? (trades.length ? `A comparison appears once each side has at least ${SIDE_MIN_TRADES} closed trades.` : "No closed trades in this period.")}
      </p>
    </div>
  );
}

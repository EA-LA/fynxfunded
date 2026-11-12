import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import GlossaryTip from "@/components/GlossaryTip";
import TargetProgress from "@/trade-access/TargetProgress";
import DailyStatement from "@/trade-access/DailyStatement";
import { engineLabel, type EngineHandle } from "@/trade-access/useEngine";
import { liveAccountSummary, type LossRoom } from "@/trade-access/live-account";
import { findPair } from "@/trade-access/instruments";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));
const tone = (n: number) => (n < 0 ? "text-red-500" : n > 0 ? "text-emerald-500" : "");
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * "Live on FYNX Trade" in the FYNX Funded account workspace: the account as the
 * trading engine sees it right now (balance, equity, open trades, room left
 * before the loss limits, target progress). Before the engine is connected it
 * says so and shows no figures.
 */
export default function LiveTradeAccountCard({ engine, accountId, startingBalance }: { engine: EngineHandle; accountId: string; startingBalance?: number | null }) {
  const { status, snapshot, error } = engine;
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => { if (snapshot) setUpdatedAt(Date.now()); }, [snapshot]);
  const terminal = `/trade/access?account=${encodeURIComponent(accountId)}`;
  const head = <div className="flex flex-wrap items-center justify-between gap-2">
    <h2 className="flex items-center gap-2 font-semibold"><Activity size={16} aria-hidden="true" />Live on FYNX Trade</h2>
    <span data-testid="live-engine-status" title={status?.message} className={`rounded-full px-2.5 py-1 text-xs font-medium ${status?.execution ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-secondary text-muted-foreground"}`}>{status ? engineLabel(status) : "Checking…"}</span>
  </div>;

  if (!status) return <section className="premium-card" data-testid="live-trade-card" aria-busy="true">{head}<p className="mt-3 text-sm text-muted-foreground">Checking the trading engine…</p></section>;

  if (!status.connected) return <section className="premium-card" data-testid="live-trade-card">{head}
    <p className="mt-3 text-sm leading-6 text-muted-foreground">The trading engine is not connected yet, so there is nothing live to show. Once it is, this card shows this account's balance, equity, open trades and the room left before the daily and maximum loss limits, refreshed every few seconds. Nothing here is estimated.</p>
    <Link to={terminal} className="mt-3 inline-block text-sm underline">Open FYNX Trade</Link>
  </section>;

  if (!snapshot) return <section className="premium-card" data-testid="live-trade-card">{head}
    {error ? <p role="alert" className="mt-3 text-sm text-red-500">This account could not be loaded from FYNX Trade: {error}</p> : <p className="mt-3 text-sm text-muted-foreground" aria-busy="true">Loading this account from FYNX Trade…</p>}
  </section>;

  const s = liveAccountSummary(snapshot, startingBalance);
  const tiles: [string, string, string, string?][] = [
    ["Balance", money(s.balance), "", "balance"],
    ["Equity", money(s.equity), "", "equity"],
    ["Open profit/loss", s.positions.length ? signed(s.floatingProfit) : "—", s.positions.length ? tone(s.floatingProfit) : ""],
    ["Open trades", `${s.positions.length}${s.pendingOrders ? ` · ${s.pendingOrders} pending` : ""}`, ""],
  ];
  return <section className="premium-card space-y-4" data-testid="live-trade-card">
    {head}
    <p className="text-xs text-muted-foreground" role="status">
      <span className={`font-semibold ${s.status === "breached" ? "text-red-500" : s.status === "passed" ? "text-emerald-500" : "text-foreground"}`}>{s.statusLabel}</span>
      {updatedAt !== null && <> · updated {clock(updatedAt)}</>}
      {s.pricesAt !== null && <> · latest price {clock(s.pricesAt)}</>}
    </p>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{tiles.map(([k, v, cls, term]) => <div key={k} className="rounded-lg border p-3">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">{k}{term && <GlossaryTip term={term} />}</dt>
      <dd className={`mt-1 text-xl font-bold ${cls}`}>{v}</dd>
    </div>)}</dl>
    <div className="grid gap-3 lg:grid-cols-2">
      <Room title="Daily loss limit" term="daily-loss-limit" r={s.dailyLoss} closer={s.closerLimit === "daily"} what="today's allowance" />
      <Room title="Maximum loss" term="maximum-loss" r={s.maxLoss} closer={s.closerLimit === "maximum"} what="the total allowance" />
    </div>
    {s.positions.length > 0 && <div className="overflow-x-auto" data-testid="live-positions">
      <table className="w-full text-sm"><caption className="mb-2 text-left text-xs text-muted-foreground">Open trades right now</caption>
        <thead className="text-xs text-muted-foreground"><tr>{["Pair", "Side", "Lots", "Entry", "Stop loss", "Take profit", "Profit/loss"].map(h => <th key={h} scope="col" className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>{s.positions.map(p => { const d = findPair(p.symbol)?.digits ?? 5; return <tr key={p.id} className="border-t">
          <td className="px-2 py-1.5 font-semibold">{p.symbol}</td>
          <td className={`px-2 py-1.5 capitalize ${p.side === "buy" ? "text-blue-500" : "text-red-500"}`}>{p.side}</td>
          <td className="px-2 py-1.5 font-mono">{p.lots.toFixed(2)}</td>
          <td className="px-2 py-1.5 font-mono">{p.entryPrice.toFixed(d)}</td>
          <td className="px-2 py-1.5 font-mono">{p.stopLoss === undefined ? "None" : p.stopLoss.toFixed(d)}{p.trailingPips !== undefined && <span className="ml-1 whitespace-nowrap font-sans text-xs text-muted-foreground">(trailing {p.trailingPips} pips)</span>}</td>
          <td className="px-2 py-1.5 font-mono">{p.takeProfit === undefined ? "None" : p.takeProfit.toFixed(d)}</td>
          <td className={`px-2 py-1.5 font-mono ${Number.isFinite(p.profit) ? tone(p.profit) : ""}`}>{Number.isFinite(p.profit) ? signed(p.profit) : "No price"}</td>
        </tr>; })}</tbody>
      </table>
      {s.positions.some(p => p.stopLoss === undefined) && <p className="mt-2 text-xs text-muted-foreground">A trade without a stop loss can lose until the loss limit closes the account.</p>}
    </div>}
    {snapshot.report && <TargetProgress report={snapshot.report} />}
    <DailyStatement accountId={accountId} closes={snapshot.state.dayCloses} now={updatedAt ?? Date.now()} compact />
    <p className="text-xs text-muted-foreground">These are the figures the trading engine uses for your rules. The official result of an evaluation is confirmed by review. <Link to={terminal} className="underline">Trade or manage positions in FYNX Trade</Link></p>
  </section>;
}

function Room({ title, term, r, closer, what }: { title: string; term: string; r: LossRoom; closer: boolean; what: string }) {
  const used = r.usedPercent;
  const warn = used !== null && used >= 75;
  return <div className={`rounded-lg border p-3 ${closer ? "border-primary/50" : ""}`} data-testid={`room-${term}`}>
    <p className="flex items-center gap-1 text-xs text-muted-foreground">{title}<GlossaryTip term={term} />{closer && <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Closer limit</span>}</p>
    <p className="mt-1 text-lg font-bold">{money(r.room)} left</p>
    {used !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${title}: share used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used)}><div className={`h-full ${warn ? "bg-red-500" : "bg-primary"}`} style={{ width: `${used}%` }} /></div>}
    <p className="mt-1.5 text-xs text-muted-foreground">Account closes if equity reaches {money(r.floor)}{used !== null ? ` · ${used.toFixed(1)}% of ${what} used` : ""}.</p>
  </div>;
}

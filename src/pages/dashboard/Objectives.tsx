import { useTradingData } from "@/hooks/use-trading-data";
import { Calculator, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

export default function Objectives() {
  const data = useTradingData();
  const [plannedRisk,setPlannedRisk]=useState(1);
  const hasAccount=data.hasAccount;
  const objectives = data.objectives || {profitTarget:{current:0,target:8},dailyLoss:{current:0,limit:5},maxLoss:{current:0,limit:10},minTradingDays:{current:0,target:5},consistency:null};

  const rules = [
    {
      label: "Profit Target",
      current: objectives.profitTarget.current,
      max: objectives.profitTarget.target,
      isLimit: false,
      unit: "%",
    },
    {
      label: "Daily Loss Limit",
      current: objectives.dailyLoss.current,
      max: objectives.dailyLoss.limit,
      isLimit: true,
      unit: "%",
    },
    {
      label: "Max Loss Limit",
      current: objectives.maxLoss.current,
      max: objectives.maxLoss.limit,
      isLimit: true,
      unit: "%",
    },
    {
      label: "Min Trading Days",
      current: objectives.minTradingDays.current,
      max: objectives.minTradingDays.target,
      isLimit: false,
      unit: "",
    },
  ];

  if (data.loading || data.error) return <div className="space-y-4"><h1 className="text-2xl font-bold">Objectives</h1><p role={data.error ? "alert" : "status"}>{data.error || "Loading account records…"}</p></div>;
  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">Objectives</h1><p className="text-sm text-muted-foreground mt-1">Purchased objectives and the latest recorded evaluation.</p></div><span className="rounded-full border px-3 py-1 text-xs font-medium">{hasAccount?data.brokerConnected?"Live broker feed":"Live feed unverified":"$10K · 2-phase preview"}</span></div>
      </div>

      {!hasAccount && <div className="premium-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">See the complete evaluation before you buy</p><p className="mt-1 text-sm text-muted-foreground">This is a clearly labeled $10K, 2-phase example. Your purchased plan replaces it automatically.</p></div><Link to="/challenges" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Choose a challenge <ArrowRight size={14}/></Link></div>}

      {data.loading && <p role="status">Loading evaluation records…</p>}
      {data.error && <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">{data.error}</p>}
      {hasAccount && !data.objectives && <div className="premium-card"><h2 className="font-semibold">Evaluation not available</h2><p className="mt-2 text-sm text-muted-foreground">A verified evaluation of this account’s purchased rules and equity history has not been recorded. Closed trades alone cannot establish daily loss, maximum loss, or remaining risk allowance.</p></div>}
      {hasAccount && data.objectives && <p className="text-sm text-muted-foreground">Recorded {new Date(data.evaluationAt).toLocaleString()}. This historical evaluation is not a live risk allowance.</p>}
      {/* Core Objectives */}
      <div className="grid gap-6">
        {(!hasAccount || data.objectives) && rules.map((rule) => {
          const pct = rule.max > 0 ? (rule.current / rule.max) * 100 : 0;
          const cappedPct = Math.max(0, Math.min(pct, 100));
          const remaining = rule.max - rule.current;

          return (
            <div key={rule.label} className="premium-card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold">{rule.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {rule.isLimit ? "Limit" : "Target"}: {rule.max}{rule.unit}
                  </p>
                </div>
                <span className="rounded bg-secondary px-2 py-1 text-xs">{hasAccount ? "Recorded value" : "Example"}</span>
              </div>

              <div className="flex items-end justify-between mb-2">
                <span className="text-3xl font-bold">{Number(rule.current.toFixed(2))}{rule.unit}</span>
                <span className="text-sm text-muted-foreground">
                  {rule.isLimit ? "Recorded usage" : remaining > 0 ? `${remaining.toFixed(1)}${rule.unit} to target` : "Target recorded"}
                </span>
              </div>

              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground transition-all duration-700"
                  style={{ width: `${cappedPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Consistency Rule */}
      {objectives.consistency && (
        <div className="premium-card">
          <h3 className="text-sm font-semibold mb-4">Consistency Rule</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-secondary/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Largest Winning Day</p>
              <p className="text-xl font-bold">{objectives.consistency.largestWinDay.toFixed(1)}%</p>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Consistency Threshold</p>
              <p className="text-xl font-bold">{objectives.consistency.threshold.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="premium-card"><div className="flex items-center gap-2"><Calculator size={18}/><h3 className="font-semibold">Risk-per-trade planner</h3></div><p className="mt-1 text-xs text-muted-foreground">Plan position risk before sending an order.</p><label className="mt-5 block text-xs font-medium">Planned risk: {plannedRisk.toFixed(1)}%</label><input className="mt-3 w-full accent-foreground" type="range" min="0.1" max="5" step="0.1" value={plannedRisk} onChange={e=>setPlannedRisk(Number(e.target.value))}/><div className="mt-4 rounded-lg bg-secondary/50 p-4"><p className="text-xs text-muted-foreground">Capital at risk {hasAccount && data.accountSize > 0 ? "on this account" : "on a $10K example"}</p><p className="mt-1 text-2xl font-bold">${((data.accountSize||10000)*plannedRisk/100).toFixed(2)}</p></div></div>
        <div className="premium-card"><h3 className="font-semibold">How evaluation works</h3><div className="mt-4 space-y-3 text-sm">{["Broker closes a trade and sends the verified result","FYNX updates P/L, drawdown and trading days","Rules engine checks every objective","Progression requires verified evidence and approval"].map((x,i)=><div key={x} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">{i+1}</span><span>{x}</span></div>)}</div></div>
      </div>
    </div>
  );
}

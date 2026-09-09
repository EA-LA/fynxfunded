import { useTradingData } from "@/hooks/use-trading-data";
import { Target, CheckCircle2, AlertTriangle, XCircle, Calculator, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

type RuleStatus = "ok" | "warning" | "violated";

function getStatus(current: number, limit: number, isLimit: boolean): RuleStatus {
  if (isLimit) {
    if (current >= limit) return "violated";
    if (current / limit > 0.7) return "warning";
    return "ok";
  }
  // target-based (profit, min days)
  if (current >= limit) return "ok";
  return "ok"; // in progress
}

function StatusIcon({ status }: { status: RuleStatus }) {
  if (status === "ok") return <CheckCircle2 size={14} className="text-foreground" />;
  if (status === "warning") return <AlertTriangle size={14} className="text-muted-foreground" />;
  return <XCircle size={14} className="text-muted-foreground" />;
}

function StatusLabel({ status }: { status: RuleStatus }) {
  const labels = { ok: "OK", warning: "Approaching Limit", violated: "Violated" };
  const classes = {
    ok: "bg-secondary text-foreground",
    warning: "bg-secondary text-muted-foreground",
    violated: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-medium ${classes[status]}`}>
      <StatusIcon status={status} />
      {labels[status]}
    </span>
  );
}

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

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">Objectives</h1><p className="text-sm text-muted-foreground mt-1">Rules, risk limits and live evaluation progress.</p></div><span className="rounded-full border px-3 py-1 text-xs font-medium">{hasAccount?data.brokerConnected?"Live broker feed":"Account awaiting broker":"$10K · 2-phase preview"}</span></div>
      </div>

      {!hasAccount && <div className="premium-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">See the complete evaluation before you buy</p><p className="mt-1 text-sm text-muted-foreground">This is a clearly labeled $10K, 2-phase example. Your purchased plan replaces it automatically.</p></div><Link to="/challenges" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Choose a challenge <ArrowRight size={14}/></Link></div>}

      {/* Core Objectives */}
      <div className="grid gap-6">
        {rules.map((rule) => {
          const pct = (rule.current / rule.max) * 100;
          const cappedPct = Math.min(pct, 100);
          const status = getStatus(rule.current, rule.max, rule.isLimit);
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
                <StatusLabel status={status} />
              </div>

              <div className="flex items-end justify-between mb-2">
                <span className="text-3xl font-bold">{rule.current}{rule.unit}</span>
                <span className="text-sm text-muted-foreground">
                  {remaining > 0 ? `${remaining.toFixed(1)}${rule.unit} remaining` : "Complete"}
                </span>
              </div>

              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    status === "violated" ? "bg-muted-foreground" : status === "warning" ? "bg-muted-foreground/70" : "bg-foreground"
                  }`}
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
        <div className="premium-card"><div className="flex items-center gap-2"><Calculator size={18}/><h3 className="font-semibold">Risk-per-trade planner</h3></div><p className="mt-1 text-xs text-muted-foreground">Plan position risk before sending an order.</p><label className="mt-5 block text-xs font-medium">Planned risk: {plannedRisk.toFixed(1)}%</label><input className="mt-3 w-full accent-foreground" type="range" min="0.1" max="5" step="0.1" value={plannedRisk} onChange={e=>setPlannedRisk(Number(e.target.value))}/><div className="mt-4 rounded-lg bg-secondary/50 p-4"><p className="text-xs text-muted-foreground">Capital at risk {hasAccount?"on this account":"on a $10K example"}</p><p className="mt-1 text-2xl font-bold">${((data.accountSize||10000)*plannedRisk/100).toFixed(2)}</p></div></div>
        <div className="premium-card"><h3 className="font-semibold">How automatic evaluation works</h3><div className="mt-4 space-y-3 text-sm">{["Broker closes a trade and sends the verified result","FYNX updates P/L, drawdown and trading days","Rules engine checks every objective","Pass or breach advances the workflow and records an audit trail"].map((x,i)=><div key={x} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">{i+1}</span><span>{x}</span></div>)}</div></div>
      </div>
    </div>
  );
}

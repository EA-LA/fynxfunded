import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

type Snapshot = { asOf: number; balance: string; equity: string; dailyRemaining: string; maximumRemaining: string; breached: boolean; policyVersion: string };
type Insights = { phase: number; currency: string; status: string; archived: boolean; snapshot: Snapshot | null; points: { id: string; at: number; balance: string; equity: string }[]; historyTruncated: boolean; eventCount: number; authorizesTrading: false; authorizesPayout: false };
const amount = (value: unknown, currency: string) => {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return "Unavailable";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value)); } catch { return "Unavailable"; }
};
export default function AccountEquityHistory({ challengeId, program, initialPhase = 1 }: { challengeId: string; program: string; initialPhase?: number }) {
  const { user } = useAuth(); const uid = user?.userId;
  const [phase, setPhase] = useState(Math.min(3, Math.max(1, initialPhase))), [attempt, setAttempt] = useState(0), [now, setNow] = useState(Date.now());
  const [state, setState] = useState<{ key: string; data: Insights | null; error: string; loading: boolean }>({ key: "", data: null, error: "", loading: true });
  const key = `${uid}:${challengeId}:${phase}`;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true; setState({ key, data: null, error: "", loading: true });
    if (!uid || !functions) { setState({ key, data: null, error: "Sign in to view account history.", loading: false }); return; }
    httpsCallable(functions, "fundedAccountInsights")({ challengeId, phase }).then(response => {
      if (!active) return; const data = response.data as Insights;
      if (data.phase !== phase || data.authorizesTrading !== false || data.authorizesPayout !== false || !Array.isArray(data.points)) throw Error("Unexpected account history response.");
      setNow(Date.now()); setState({ key, data, error: "", loading: false });
    }).catch(() => { if (active) setState({ key, data: null, error: "Account history could not be verified. Try again or contact Support.", loading: false }); });
    return () => { active = false; };
  }, [key, uid, challengeId, phase, attempt]);
  const current = state.key === key ? state : { data: null, error: "", loading: true };
  const data = current.data, snapshot = data?.snapshot;
  const usable = snapshot && ["recent_snapshot", "stale_snapshot"].includes(data.status) && Number.isFinite(snapshot.asOf) && snapshot.asOf <= now;
  const stale = usable && (now - snapshot.asOf > 60000 || data.archived);
  const phases = Math.min(3, Math.max(1, Number.parseInt(program, 10) || 1));
  return <section className="premium-card space-y-4" aria-label="Broker equity history">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Broker balance & equity history</h2><div className="flex gap-2">
      <select aria-label="History phase" value={phase} onChange={event => setPhase(Number(event.target.value))} className="rounded-md border bg-background px-3 py-2 text-sm">{Array.from({ length: phases }, (_, i) => <option key={i} value={i + 1}>Phase {i + 1}</option>)}</select>
      <button className="rounded-md border px-3 py-2 text-sm" disabled={current.loading} onClick={() => setAttempt(value => value + 1)}>Refresh history</button>
    </div></div>
    {current.loading && <p role="status" className="text-sm text-muted-foreground">Loading verified broker history…</p>}
    {current.error && <p role="alert" className="text-sm text-muted-foreground">{current.error}</p>}
    {!current.loading && !current.error && !usable && <p className="text-sm text-muted-foreground">{data?.status === "review_required" ? "These records need review before equity history can be displayed." : "Verified broker history is not available for this phase yet. Balances and risk distances are not estimated from closed trades."}</p>}
    {usable && <>
      <p role="status" className="text-sm text-muted-foreground">{stale ? "Historical broker snapshot" : "Latest broker snapshot"} · {new Date(snapshot.asOf).toLocaleString()}{data.archived ? " · Archived phase" : ""}</p>
      {snapshot.breached && <p className="rounded-md border border-destructive/40 p-3 text-sm">A breach is recorded in this phase. A later balance recovery does not clear it.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{[["Recorded balance", snapshot.balance], ["Recorded equity", snapshot.equity], ["Recorded distance to daily floor", snapshot.dailyRemaining], ["Recorded distance to maximum floor", snapshot.maximumRemaining]].map(([label, value]) => <div key={label} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{amount(value, data.currency)}</p></div>)}</div>
      <p className="text-xs text-muted-foreground">These are recorded broker values as of the time shown, not a current trading allowance or payout approval. Refreshing cannot make old broker data current.</p>
      {data.points.length > 1 && <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.points.filter(p => Number.isFinite(p.at) && p.at <= now && [p.balance, p.equity].every(v => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v)))).map(p => ({ ...p, balance: Number(p.balance), equity: Number(p.equity), date: new Date(p.at).toLocaleString() }))}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2}/><XAxis dataKey="date" hide/><YAxis width={70} fontSize={10}/><Tooltip/><Area name="Broker equity" dataKey="equity" stroke="#b2b2ff" fill="#b2b2ff" fillOpacity={0.12}/><Area name="Broker balance" dataKey="balance" stroke="#94a3b8" fill="transparent"/>
      </AreaChart></ResponsiveContainer></div>}
      <p className="text-xs text-muted-foreground">{data.eventCount} validated events · Policy {snapshot.policyVersion}{data.historyTruncated ? " · Chart shows the latest 500 points" : ""}</p>
    </>}
  </section>;
}

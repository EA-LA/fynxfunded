import { useEffect, useState } from "react";
import { getAdminOverview } from "@/services/admin";

export default function AdminDashboardHome() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { getAdminOverview().then(setData); }, []);
  const recent = (data?.activity || []).slice(0,10);
  return <div className="space-y-6">
    <div className="grid md:grid-cols-5 gap-4">
      <Card t="Total users" v={data?.users?.length || 0} />
      <Card t="Active challenges" v={(data?.accounts||[]).filter((a:any)=>a.challengeStatus==="active").length} />
      <Card t="Passed challenges" v={(data?.accounts||[]).filter((a:any)=>a.challengeStatus==="passed").length} />
      <Card t="Failed accounts" v={(data?.accounts||[]).filter((a:any)=>["failed","breached"].includes(a.challengeStatus)).length} />
      <Card t="Pending payouts" v={(data?.payouts||[]).filter((p:any)=>p.status==="requested").length} />
    </div>
    <div className="premium-card"><h2 className="font-semibold mb-3">Recent activity log (last 10)</h2>{recent.map((r:any,i:number)=><div key={i} className="text-sm border-b border-border py-2">{r.action || r.type || "event"} — {r.timestamp || r.time}</div>)}</div>
  </div>;
}
function Card({t,v}:{t:string;v:any}){return <div className="premium-card"><div className="text-xs text-muted-foreground">{t}</div><div className="text-2xl font-bold">{v}</div></div>}

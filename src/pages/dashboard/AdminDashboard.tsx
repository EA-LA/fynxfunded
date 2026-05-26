import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Shield, Wallet, AlertTriangle, Target } from "lucide-react";
import { collection, onSnapshot, updateDoc, doc, Timestamp } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "overview" | "purchases" | "users" | "payouts" | "monitoring";

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === "string") return new Date(v);
  return null;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setError("Firebase is not configured.");
      setLoading(false);
      return;
    }
    const unsubs = [
      onSnapshot(collection(db, "users"), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "orders"), (s) => setOrders(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "challenges"), (s) => setChallenges(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "accounts"), (s) => setAccounts(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "payouts"), (s) => setPayouts(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
    ];
    setLoading(false);
    return () => unsubs.forEach((u) => u());
  }, []);

  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.uid || u.id, u])), [users]);

  const stats = useMemo(() => {
    const totalRevenue = orders.filter((o) => o.status === "paid").reduce((a, b) => a + (Number(b.amount) || 0), 0);
    return {
      challengesSold: orders.length,
      activeAccounts: challenges.filter((c) => c.status === "active").length,
      passedAccounts: challenges.filter((c) => c.status === "passed" || c.status === "funded").length,
      failedAccounts: challenges.filter((c) => c.status === "failed").length,
      breachedAccounts: challenges.filter((c) => c.status === "expired").length,
      payoutRequests: payouts.length,
      verifiedUsers: users.filter((u) => u.emailVerified).length,
      unverifiedUsers: users.filter((u) => !u.emailVerified).length,
      inactiveUsers: users.filter((u) => { const d = toDate(u.lastLoginAt || u.lastActive); return d ? (Date.now() - d.getTime()) > 1000*60*60*24*30 : true; }).length,
      totalRevenue,
    };
  }, [orders, challenges, payouts, users]);

  const handlePayoutAction = async (id: string, status: "approved" | "denied") => {
    if (!db) return;
    await updateDoc(doc(db, "payouts", id), { status, processedAt: new Date().toISOString(), processedBy: user?.email || "owner" });
  };

  if (loading) return <div className="min-h-screen grid place-items-center"><div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" /></div>;

  return <div className="min-h-screen bg-background px-6 py-8">
    <div className="max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Owner Admin Dashboard</h1><p className="text-sm text-muted-foreground">Private owner console for FYNX Funded.</p></div>
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft size={14}/>Trader dashboard</Link>
      </header>
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{error}</div>}
      <div className="flex gap-2 flex-wrap">{(["overview","purchases","users","payouts","monitoring"] as Tab[]).map((t)=><button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-md text-sm ${tab===t?"bg-primary text-primary-foreground":"bg-secondary text-muted-foreground"}`}>{t}</button>)}</div>

      {tab==="overview" && <div className="grid md:grid-cols-3 gap-4">{Object.entries(stats).map(([k,v])=><div key={k} className="premium-card"><p className="text-xs text-muted-foreground">{k}</p><p className="text-2xl font-semibold mt-1">{k==="totalRevenue"?`$${Number(v).toLocaleString()}`:String(v)}</p></div>)}</div>}

      {tab==="purchases" && <div className="premium-card overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th>User</th><th>Email</th><th>Size</th><th>Type</th><th>Stage</th><th>Payment</th><th>Date</th><th>Country</th><th>Status</th><th>Platform</th></tr></thead><tbody>{orders.map((o)=>{const u=userById[o.userId]; const ch=challenges.find((c)=>c.orderId===o.id); const acc=accounts.find((a)=>a.challengeId===(ch?.challengeId||ch?.id)); return <tr key={o.id} className="border-b border-border/50"><td>{u?.displayName||u?.fullName||"-"}</td><td>{u?.email||o.email||"-"}</td><td>${o.accountSize?.toLocaleString?.()||"-"}</td><td>{o.challenge||"-"}</td><td>{ch?.phase||o.phase||"-"}</td><td>{o.status||"-"}</td><td>{toDate(o.createdAt)?.toLocaleDateString()||"-"}</td><td>{u?.country||"-"}</td><td>{ch?.status||"active"}</td><td>{acc?"connected":"pending"}</td></tr>})}</tbody></table>{orders.length===0&&<p className="text-sm text-muted-foreground py-8 text-center">No purchases yet.</p>}</div>}

      {tab==="users" && <div className="premium-card overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th>Name</th><th>Email</th><th>Verification</th><th>KYC</th><th>Last login</th><th>Bought</th><th>Active</th><th>Failed</th><th>Passed</th><th>Payouts</th></tr></thead><tbody>{users.map((u)=>{const uid=u.uid||u.id;const uc=challenges.filter((c)=>c.userId===uid);const up=payouts.filter((p)=>p.userId===uid);return <tr key={uid} className="border-b border-border/50"><td>{u.displayName||u.fullName||"-"}</td><td>{u.email}</td><td>{u.emailVerified?"Verified":"Unverified"}</td><td>{u.kycStatus||"not_started"}</td><td>{toDate(u.lastLoginAt||u.lastActive)?.toLocaleString()||"-"}</td><td>{orders.filter((o)=>o.userId===uid).length}</td><td>{uc.filter((c)=>c.status==="active").length}</td><td>{uc.filter((c)=>c.status==="failed").length}</td><td>{uc.filter((c)=>c.status==="passed"||c.status==="funded").length}</td><td>{up.length}</td></tr>})}</tbody></table></div>}

      {tab==="payouts" && <div className="premium-card overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th>User</th><th>Account</th><th>Profit</th><th>Requested</th><th>KYC</th><th>Status</th><th>Actions</th></tr></thead><tbody>{payouts.map((p)=>{const u=userById[p.userId];return <tr key={p.id} className="border-b border-border/50"><td>{u?.email||p.userId}</td><td>{p.accountId}</td><td>${Number(p.profitAmount||0).toLocaleString()}</td><td>${Number(p.amount||0).toLocaleString()}</td><td>{u?.kycStatus||"unknown"}</td><td>{p.status}</td><td className="space-x-2"><button onClick={()=>handlePayoutAction(p.id,"approved")} className="text-xs px-2 py-1 rounded bg-secondary">Approve</button><button onClick={()=>handlePayoutAction(p.id,"denied")} className="text-xs px-2 py-1 rounded bg-secondary">Reject</button></td></tr>})}</tbody></table></div>}

      {tab==="monitoring" && <div className="grid md:grid-cols-2 gap-4">{[
        ["Phase 1", challenges.filter((c)=>String(c.phase).toLowerCase().includes("1")).length, Target],
        ["Phase 2", challenges.filter((c)=>String(c.phase).toLowerCase().includes("2")).length, Shield],
        ["Funded", challenges.filter((c)=>c.status==="funded").length, Wallet],
        ["Breaches", challenges.filter((c)=>c.status==="expired").length, AlertTriangle],
      ].map(([name,val,Icon]:any)=><div key={name} className="premium-card"><div className="flex items-center justify-between"><p>{name}</p><Icon size={16}/></div><p className="text-2xl font-bold mt-2">{val}</p></div>)}</div>}
    </div>
  </div>;
}

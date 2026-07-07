import { useEffect, useMemo, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, Award, ExternalLink, RotateCcw, Shield, Target, Wallet } from "lucide-react";
import { collection, doc, onSnapshot, Timestamp, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { getAllKycProfiles, type KycRecord, type KycStatus } from "@/services/kyc";

type Tab = "overview" | "purchases" | "users" | "payouts" | "kyc" | "certificates" | "monitoring";
type KycFilter = KycStatus | "all";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") return new Date(value);
  if (typeof value === "object" && value !== null && "toDate" in value) return (value as { toDate: () => Date }).toDate();
  return null;
}

function formatDate(value: unknown) {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : "-";
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
  const [certificates, setCertificates] = useState<any[]>([]);
  const [kycFilter, setKycFilter] = useState<KycFilter>("all");
  const [kycProfiles, setKycProfiles] = useState<KycRecord[]>([]);

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setError("Firebase is not configured.");
      setLoading(false);
      return;
    }

    const unsubs = [
      onSnapshot(collection(db, "users"), (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "orders"), (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "challenges"), (snap) => setChallenges(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "accounts"), (snap) => setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "payouts"), (snap) => setPayouts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
      onSnapshot(collection(db, "certificates"), (snap) => setCertificates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message)),
    ];

    setLoading(false);
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    getAllKycProfiles().then(setKycProfiles).catch(console.error);
  }, []);

  const userById = useMemo(() => Object.fromEntries(users.map((currentUser) => [currentUser.uid || currentUser.id, currentUser])), [users]);
  const profileByUserId = useMemo(() => Object.fromEntries(kycProfiles.map((profile) => [profile.userId, profile])), [kycProfiles]);

  const kycRows = useMemo(() => {
    return users
      .map((currentUser) => {
        const userId = currentUser.uid || currentUser.id;
        const profile = profileByUserId[userId] as KycRecord | undefined;
        const status = (currentUser.kycStatus || profile?.kycStatus || "not_started") as KycStatus;
        return {
          userId,
          legalFullName: profile?.legalFullName || currentUser.displayName || currentUser.fullName || "-",
          email: profile?.email || currentUser.email || "-",
          countryOfResidence: profile?.countryOfResidence || currentUser.country || "-",
          kycSubmittedAt: profile?.kycSubmittedAt || currentUser.kycSubmittedAt,
          kycStatus: status,
        };
      })
      .filter((row) => kycFilter === "all" || row.kycStatus === kycFilter)
      .sort((a, b) => (toDate(b.kycSubmittedAt)?.getTime() || 0) - (toDate(a.kycSubmittedAt)?.getTime() || 0));
  }, [kycFilter, profileByUserId, users]);

  const stats = useMemo(() => ({
    challengesSold: orders.length,
    activeAccounts: accounts.filter((account) => account.status === "active").length || challenges.filter((challenge) => challenge.status === "active").length,
    payoutRequests: payouts.length,
    certificates: certificates.length,
  }), [accounts, challenges, certificates, orders, payouts]);

  const handlePayoutAction = async (id: string, status: "approved" | "denied") => {
    if (!db) return;
    await updateDoc(doc(db, "payouts", id), { status, processedAt: new Date().toISOString(), processedBy: user?.email || "owner" });
  };

  const handleCertificateAction = async (id: string, status: "approved" | "revoked" | "issued") => {
    if (!db) return;
    await updateDoc(doc(db, "certificates", id), { status, reviewedAt: new Date().toISOString(), reviewedBy: user?.email || "owner" });
  };

  const handleCertificateRegenerate = async (certificate: any) => {
    if (!functions) return;
    const regenerate = httpsCallable(functions, "adminRegenerateCertificate");
    await regenerate({ challengeId: certificate.challengeId, payoutId: certificate.payoutId });
  };

  if (loading) return <div className="grid min-h-screen place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" /></div>;

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Owner Admin Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">Monitor purchases, users, payouts, KYC, and account health.</p>
          </div>
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Trader dashboard</Link>
        </header>

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{error}</div>}

        <div className="flex flex-wrap gap-2">
          {(["overview", "purchases", "users", "payouts", "kyc", "certificates", "monitoring"] as Tab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-2 text-sm capitalize ${tab === item ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{item}</button>
          ))}
        </div>

        {tab === "overview" && <OverviewCards stats={stats} />}
        {tab === "users" && <UsersTable users={users} />}
        {tab === "payouts" && <PayoutsTable payouts={payouts} userById={userById} onAction={handlePayoutAction} />}
        {tab === "kyc" && <KycTable rows={kycRows} filter={kycFilter} setFilter={setKycFilter} />}
        {tab === "certificates" && <CertificatesTable certificates={certificates} userById={userById} onAction={handleCertificateAction} onRegenerate={handleCertificateRegenerate} />}
        {tab === "monitoring" && <MonitoringGrid challenges={challenges} />}
      </div>
    </div>
  );
}

function OverviewCards({ stats }: { stats: Record<string, number> }) {
  return <div className="grid gap-4 md:grid-cols-3">{Object.entries(stats).map(([key, value]) => <div key={key} className="premium-card"><p className="text-xs text-muted-foreground">{key}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</div>;
}

function UsersTable({ users }: { users: any[] }) {
  return <div className="premium-card overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-3">Name</th><th>Email</th><th>KYC</th></tr></thead><tbody>{users.map((currentUser) => { const userId = currentUser.uid || currentUser.id; return <tr key={userId} className="border-b border-border/50"><td className="py-3">{currentUser.displayName || currentUser.fullName || "-"}</td><td>{currentUser.email}</td><td>{currentUser.kycStatus || "not_started"}</td></tr>; })}</tbody></table></div>;
}

function PayoutsTable({ payouts, userById, onAction }: { payouts: any[]; userById: Record<string, any>; onAction: (id: string, status: "approved" | "denied") => void }) {
  return <div className="premium-card overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-3">User</th><th>Requested</th><th>KYC</th><th>Status</th><th>Actions</th></tr></thead><tbody>{payouts.map((payout) => { const payoutUser = userById[payout.userId]; return <tr key={payout.id} className="border-b border-border/50"><td className="py-3">{payoutUser?.email || payout.userId}</td><td>${Number(payout.amount || 0).toLocaleString()}</td><td>{payoutUser?.kycStatus || "unknown"}</td><td>{payout.status}</td><td className="space-x-2"><button onClick={() => onAction(payout.id, "approved")} className="rounded bg-secondary px-2 py-1 text-xs">Approve</button><button onClick={() => onAction(payout.id, "denied")} className="rounded bg-secondary px-2 py-1 text-xs">Reject</button></td></tr>; })}</tbody></table></div>;
}

function CertificatesTable({ certificates, userById, onAction, onRegenerate }: { certificates: any[]; userById: Record<string, any>; onAction: (id: string, status: "approved" | "revoked" | "issued") => void; onRegenerate: (certificate: any) => void }) {
  return <div className="space-y-4"><div><h2 className="text-lg font-semibold">Certificate Controls</h2><p className="text-sm text-muted-foreground">View, approve, revoke, or regenerate backend-generated certificates. Unlocking still depends on real challenge, account, payout, and milestone records.</p></div><div className="premium-card overflow-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-3">Certificate</th><th>Trader</th><th>Account</th><th>Status</th><th>Issued</th><th>Actions</th></tr></thead><tbody>{certificates.map((certificate) => { const trader = userById[certificate.userId]; return <tr key={certificate.id} className="border-b border-border/50"><td className="py-3"><div className="flex items-center gap-2"><Award size={15} /><div><p className="font-medium">{String(certificate.type || "certificate").replace(/_/g, " ")}</p><p className="font-mono text-xs text-muted-foreground">{certificate.publicVerificationId || certificate.id}</p></div></div></td><td>{certificate.traderName || trader?.email || certificate.userId}</td><td>{certificate.accountId || "-"}</td><td><span className="rounded-full bg-secondary px-2 py-1 text-xs capitalize">{certificate.status || "issued"}</span></td><td>{formatDate(certificate.issuedAt)}</td><td className="space-x-2 whitespace-nowrap"><button onClick={() => onAction(certificate.id, "approved")} className="rounded bg-secondary px-2 py-1 text-xs">Approve</button><button onClick={() => onAction(certificate.id, "revoked")} className="rounded bg-secondary px-2 py-1 text-xs">Revoke</button><button onClick={() => onRegenerate(certificate)} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs"><RotateCcw size={12} /> Regenerate</button><a href={`${import.meta.env.BASE_URL}certificates/verify/${certificate.publicVerificationId || certificate.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs"><ExternalLink size={12} /> View</a></td></tr>; })}</tbody></table></div></div>;
}

function KycTable({ rows, filter, setFilter }: { rows: any[]; filter: KycFilter; setFilter: (filter: KycFilter) => void }) {
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">KYC Reviews</h2><p className="text-sm text-muted-foreground">All users with merged KYC profile data and provider status.</p></div><div className="flex gap-2">{(["all", "pending", "verified", "rejected"] as const).map((status) => <button key={status} onClick={() => setFilter(status)} className={`rounded-md px-3 py-2 text-xs capitalize ${filter === status ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{status}</button>)}</div></div><div className="premium-card overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-3">Name</th><th>Email</th><th>Country</th><th>Submitted</th><th>Status</th></tr></thead><tbody>{rows.map((kyc) => <tr key={kyc.userId} className="border-b border-border/50"><td className="py-3 font-medium">{kyc.legalFullName || "-"}</td><td>{kyc.email || "-"}</td><td>{kyc.countryOfResidence || "-"}</td><td>{formatDate(kyc.kycSubmittedAt)}</td><td><span className="rounded-full bg-secondary px-2 py-1 text-xs capitalize">{kyc.kycStatus}</span></td></tr>)}</tbody></table></div></div>;
}

function MonitoringGrid({ challenges }: { challenges: any[] }) {
  const cards: Array<[string, number, ElementType]> = [
    ["Phase 1", challenges.filter((challenge) => String(challenge.phase).toLowerCase().includes("1")).length, Target],
    ["Funded", challenges.filter((challenge) => challenge.status === "funded").length, Wallet],
    ["Breaches", challenges.filter((challenge) => challenge.status === "expired").length, AlertTriangle],
    ["Protected", challenges.length, Shield],
  ];

  return <div className="grid gap-4 md:grid-cols-2">{cards.map(([name, value, Icon]) => <div key={name} className="premium-card"><div className="flex items-center justify-between"><p>{name}</p><Icon size={16} /></div><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>;
}

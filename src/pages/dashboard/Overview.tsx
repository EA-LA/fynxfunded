import { Link } from "react-router-dom";
import { Wallet, ArrowRight, Calendar, Shield, Eye, EyeOff, CheckCircle2, XCircle, AlertTriangle, MessageSquare, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { dataService } from "@/services/database";
import { useState, useEffect } from "react";
import type { Challenge, TradingAccount } from "@/services/types";
import { displayDate, publicAccountReference } from "@/lib/publicReferences";
import AccountPlanCard from "@/components/AccountPlanCard";

export default function DashboardOverview() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [ch, acc] = await Promise.all([
        dataService.getChallenges(user.userId),
        dataService.getAccounts(user.userId),
      ]);
      setChallenges(ch);
      setAccounts(acc);
      setLoading(false);
    };
    load();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const live = liveAccounts(challenges);
  const selected = live.find((c) => c.challengeId === selectedId) ?? live[0] ?? null;
  const linkedAccount = selected
    ? accounts.find((a) => a.challengeId === selected.challengeId) ?? null
    : null;
  const counts = statusCounts(challenges);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome back. Here's your trading overview.</p>
        </div>
        <Link
          to="/challenge-builder"
          className="bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          New Challenge
        </Link>
      </div>

      {challenges.length > 0 && <StatusSummary counts={counts} />}

      {live.length > 1 && (
        <div className="premium-card" data-testid="account-switcher">
          <h3 className="text-sm font-semibold">Your live accounts</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Funded accounts first, then accounts in evaluation. Pick one to see its rules and tools.</p>
          <div role="tablist" aria-label="Live accounts" className="flex flex-wrap gap-2">
            {live.map((c) => {
              const on = c.challengeId === selected?.challengeId;
              return (
                <button
                  key={c.challengeId}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSelectedId(c.challengeId)}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-foreground bg-secondary" : "border-border hover:bg-secondary/60"}`}
                >
                  <span className="block font-medium text-sm">{c.name}</span>
                  <span className="block text-muted-foreground">{c.status === "funded" ? "Funded" : `In evaluation · ${c.phase.replace("-", " ")}`} · {publicAccountReference(c)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {counts.passed > 0 && (
        <div className="premium-card flex items-start gap-3" data-testid="passed-notice">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">{counts.passed === 1 ? "1 account passed its phase" : `${counts.passed} accounts passed their phase`}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Results are checked before the next phase or funded account is opened. The next step appears here and by email; nothing is needed from you unless we ask.</p>
          </div>
        </div>
      )}

      {selected ? (
        <ActiveDashboard key={selected.challengeId} challenge={selected} account={linkedAccount} />
      ) : (
        <div className="premium-card text-center py-20">
          <Wallet size={48} className="mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No active challenges</h3>
          {challenges.length > 0 && (
            <p className="text-xs text-muted-foreground mb-2">None of your accounts is trading right now. Past accounts are listed below.</p>
          )}
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            You don't have any active challenges yet. Start a challenge to begin your evaluation and get funded.
          </p>
          <Link
            to="/challenge-builder"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Start Your First Challenge <ArrowRight size={16} />
          </Link>
          <div className="mx-auto mt-8 max-w-2xl border-t border-border pt-6 text-left" data-testid="plan-before-buying">
            <h4 className="text-sm font-semibold">Plan before you buy</h4>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                { to: "/challenges#finder", label: "Find your challenge", hint: "Plans that fit your budget and risk" },
                { to: "/rules#risk-planner", label: "Risk planner", hint: "Losing trades each plan can absorb" },
                { to: "/rules#simulator", label: "Pass simulator", hint: "Test a plan 2,000 times" },
              ].map((t) => (
                <li key={t.to}>
                  <Link to={t.to} className="block h-full rounded-md border border-border p-3 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">{t.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* All challenges list */}
      {challenges.length > 0 && (
        <div className="premium-card">
          <h3 className="text-sm font-semibold mb-4">All Challenges</h3>
          <div className="space-y-3">
            {challenges.map((ch) => (
              <Link to={`/dashboard/accounts/${ch.challengeId}`} key={ch.challengeId} className="flex items-center justify-between gap-4 p-4 rounded-md bg-secondary/40 hover:bg-secondary transition-colors group">
                <div>
                  <p className="text-sm font-medium">{ch.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ${ch.accountSize.toLocaleString()} · {ch.phase.replace("-", " ")} · Started {displayDate(ch.startDate)}
                  </p>
                </div>
                <div className="flex items-center gap-3"><span className={`text-xs font-medium px-3 py-1 rounded-full ${
                  ch.status === "active" ? "bg-secondary text-foreground" :
                  ch.status === "passed" ? "bg-secondary text-foreground" :
                  ch.status === "funded" ? "bg-secondary text-foreground" :
                  "bg-secondary/60 text-muted-foreground"
                }`}>
                  {ch.status.charAt(0).toUpperCase() + ch.status.slice(1)}
                </span><ArrowRight size={15} className="text-muted-foreground transition-transform group-hover:translate-x-1"/></div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Accounts that can trade: funded first, then active evaluations, newest start first within each. */
export function liveAccounts(challenges: Challenge[]): Challenge[] {
  const rank = (c: Challenge) => (c.status === "funded" ? 0 : 1);
  return challenges
    .filter((c) => c.status === "funded" || c.status === "active")
    .sort((a, b) => rank(a) - rank(b) || String(b.startDate).localeCompare(String(a.startDate)));
}

export function statusCounts(challenges: Challenge[]) {
  const n = (s: Challenge["status"]) => challenges.filter((c) => c.status === s).length;
  return { funded: n("funded"), active: n("active"), passed: n("passed"), ended: n("failed") + n("expired") };
}

function StatusSummary({ counts }: { counts: ReturnType<typeof statusCounts> }) {
  const items = [
    { label: "Funded", value: counts.funded, icon: TrendingUp },
    { label: "In evaluation", value: counts.active, icon: Calendar },
    { label: "Passed, in review", value: counts.passed, icon: CheckCircle2 },
    { label: "Ended", value: counts.ended, icon: XCircle },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="status-summary">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="premium-card !p-4">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon size={13} aria-hidden="true" />{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AccountTools({ challenge }: { challenge: Challenge }) {
  const funded = challenge.status === "funded";
  const tools = [
    { to: `/dashboard/accounts/${challenge.challengeId}`, label: "Account workspace", hint: "Balance, trades and rule checks" },
    funded
      ? { to: "/dashboard/payouts", label: "Payouts", hint: "Readiness check and payout requests" }
      : { to: "/dashboard/objectives", label: "Objectives", hint: "Target, loss limits and trading days" },
    { to: "/trade/access", label: "FYNX Trade terminal", hint: "Charts, order ticket and positions" },
    { to: "/dashboard/analytics", label: "Analytics", hint: "Win rate, best and worst days" },
  ];
  return (
    <nav aria-label="Account shortcuts" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="account-tools">
      {tools.map((t) => (
        <Link key={t.to} to={t.to} className="premium-card !p-4 group transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center justify-between text-sm font-medium">{t.label}<ArrowRight size={14} className="text-muted-foreground transition-transform group-hover:translate-x-1" /></span>
          <span className="block text-xs text-muted-foreground mt-0.5">{t.hint}</span>
        </Link>
      ))}
    </nav>
  );
}

function ActiveDashboard({ challenge, account }: { challenge: Challenge; account: TradingAccount | null }) {
  const [showCreds, setShowCreds] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const funded = challenge.status === "funded";
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { setCopied(null); }
  };

  return (
    <div className="space-y-6">
      {/* Active Challenge Card */}
      <div className="premium-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-lg">{challenge.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Account {publicAccountReference(challenge)}</p>
          </div>
          <span className="text-xs font-medium px-3 py-1 rounded-full bg-secondary text-foreground">
            {funded ? "Funded" : "In evaluation"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{funded ? "Program" : "Phase"}</p>
            <p className="font-medium">{funded ? `${challenge.phase.replace("-", " ")} · passed` : challenge.currentPhase ? `Phase ${challenge.currentPhase} · ${challenge.phase.replace("-", " ")}` : challenge.phase.replace("-", " ")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Account Size</p>
            <p className="font-medium">${challenge.accountSize.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Start Date</p>
            <p className="font-medium">{displayDate(challenge.startDate)}</p>
          </div>
        </div>
      </div>

      <AccountTools challenge={challenge} />

      <AccountPlanCard challenge={challenge} />

      {/* Trading Platform Credentials */}
      {account ? (
        <div className="premium-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Trading Platform Credentials</h3>
            <button onClick={() => setShowCreds(!showCreds)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              {showCreds ? <EyeOff size={12} /> : <Eye size={12} />}
              {showCreds ? "Hide" : "Show"}
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Platform</p>
              <p className="font-medium">{account.platform}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Server</p>
              <p className="font-medium flex items-center gap-2">{account.server}
                <button type="button" onClick={() => copy("server", account.server)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">{copied === "server" ? "Copied" : "Copy"}</button>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Login</p>
              <p className="font-medium font-mono flex items-center gap-2">{showCreds ? account.login : "••••••••"}
                {showCreds && <button type="button" onClick={() => copy("login", account.login)} className="font-sans text-xs text-muted-foreground underline-offset-2 hover:underline">{copied === "login" ? "Copied" : "Copy"}</button>}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="text-xs text-muted-foreground" data-testid="password-note">Never shown or stored on the dashboard, for your safety.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="premium-card text-center py-8">
          <Shield size={24} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">Trading credentials pending</p>
          <p className="text-xs text-muted-foreground">
            Your trading account will be provisioned once broker integration is activated.
          </p>
        </div>
      )}

      {/* Support Button */}
      <Link
        to="/dashboard/support"
        className="premium-card flex items-center gap-3 hover:bg-secondary/40 transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <MessageSquare size={18} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">Need help?</p>
          <p className="text-xs text-muted-foreground">Open a support ticket</p>
        </div>
        <ArrowRight size={16} className="ml-auto text-muted-foreground" />
      </Link>
    </div>
  );
}

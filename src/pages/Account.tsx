import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { mapFirebaseError } from "@/lib/auth-error-map";

export default function Account() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logout = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await signOut(); } catch (e) { setError(mapFirebaseError(e)); } finally { setBusy(false); }
  };
  return <main className="min-h-screen dot-grid px-6 py-10 sm:py-16">
    <div className="mx-auto max-w-xl">
      <Link to="/" className="text-2xl font-bold tracking-tight">FYNX<span className="ml-1 font-light text-muted-foreground">Funded</span></Link>
      <section className="mt-12 rounded-xl border border-border bg-card p-6 sm:p-8" aria-labelledby="account-title">
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 size={18} aria-hidden="true" /> Signed in</p>
        <h1 id="account-title" className="text-3xl font-semibold tracking-tight">Welcome{user?.fullName ? `, ${user.fullName}` : " to your account"}</h1>
        <p className="mt-3 text-muted-foreground">Your FYNX account is ready.</p>
        <dl className="mt-8 space-y-2"><dt className="text-xs text-muted-foreground">Email address</dt><dd className="break-all">{user?.email}</dd></dl>
        <p className="mt-3 flex items-center gap-2 text-sm"><ShieldCheck size={16} aria-hidden="true" /> Email verified</p>
        <div className="mt-8 rounded-lg border border-border p-5"><h2 className="font-semibold">Purchases and trading are paused</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">You can sign in and manage your account. Funded trading features are currently available only for authorized private testing. We’ll announce when customer access opens.</p></div>
        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm"><Link className="underline underline-offset-4" to="/forgot-password">Reset password</Link><a className="underline underline-offset-4" href="mailto:support@fynxfunded.com">Contact support</a><Link className="underline underline-offset-4" to="/dashboard">Check Funded access</Link><Link className="underline underline-offset-4" to="/">Back to home</Link></div>
        {error && <p role="alert" className="mt-5 text-sm text-destructive">{error}</p>}
        <button disabled={busy} onClick={logout} className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"><LogOut size={16} aria-hidden="true" />{busy ? "Signing out…" : "Sign out"}</button>
      </section>
    </div>
  </main>;
}

import { useEffect, useState } from "react";
import { loginPath } from "@/lib/auth-destination";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { checkPrivateFundedAccess } from "@/services/private-funded";

/** Account authentication never grants access to private Funded operations. */
export default function ProtectedRoute({ children, accountOnly = false }: { children: React.ReactNode; adminOnly?: boolean; accountOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [access, setAccess] = useState<{uid: string; expiresAt: number; denied?: boolean; error?: boolean} | null>(null);
  const [attempt, setAttempt] = useState(0);
  const uid = user?.userId;
  const verified = user?.emailVerified === true;
  const localTrade = import.meta.env.DEV && import.meta.env.VITE_FYNX_TRADE_DEV === "true";
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setAccess(null);
    if (!uid || !verified || accountOnly || localTrade || loading) return;
    checkPrivateFundedAccess().then(grant => {
      if (!active) return;
      setAccess({ uid: grant.ownerUID, expiresAt: grant.expiresAt });
      timer = setTimeout(() => { setAccess(null); setAttempt(n => n + 1); }, Math.max(0, grant.expiresAt - Date.now()));
    }).catch((error: unknown) => {
      if (!active) return;
      const denied = (error as {code?: string})?.code === "functions/permission-denied";
      setAccess({ uid, expiresAt: 0, denied, error: !denied });
    });
    const visibility = () => { setAccess(null); if (!document.hidden) setAttempt(n => n + 1); };
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [uid, verified, accountOnly, localTrade, loading, attempt]);

  if (loading) return <div className="grid min-h-screen place-items-center" role="status">Checking your session…</div>;
  if (!user || !verified) return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  if (accountOnly || localTrade) return <>{children}</>;
  if (access?.uid === uid && access.denied) return <Navigate to="/account" replace />;
  if (access?.uid === uid && access.error) return <main className="grid min-h-screen place-items-center px-6"><div className="max-w-sm space-y-5 text-center"><h1 className="text-xl font-semibold">You’re signed in</h1><p role="alert">We couldn’t check Funded access right now. Your account is still available.</p><Link className="block underline" to="/account">Go to my account</Link><button className="underline" onClick={() => setAttempt(n => n + 1)}>Try again</button></div></main>;
  if (!access || access.uid !== uid || access.expiresAt <= Date.now()) return <div className="grid min-h-screen place-items-center" role="status">Checking Funded access…</div>;
  return <>{children}</>;
}

import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { verifyPasswordResetCode, confirmPasswordReset } from "firebase/auth";
import { auth as firebaseAuth } from "@/lib/firebase";
import { mapFirebaseError } from "@/lib/auth-error-map";

import { emailActionRedirect } from "@/lib/email-action-routing";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const actionRedirect = emailActionRedirect(searchParams.toString());
  const oobCode = searchParams.get("oobCode") || "";

  const submitting = useRef(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [codeValid, setCodeValid] = useState(false);
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCodeValid(false); setSuccess(false);
    if (actionRedirect) { window.location.replace(actionRedirect); return; }
    if (!oobCode || !firebaseAuth) {
      setVerifying(false);
      setError("Invalid or missing reset link.");
      return;
    }
    let active = true;
    setVerifying(true); setCodeValid(false); setError("");
    verifyPasswordResetCode(firebaseAuth, oobCode)
      .then((userEmail) => {
        if (active) { setEmail(userEmail); setCodeValid(true); }
      })
      .catch((err) => { if (active) setError(mapFirebaseError(err)); })
      .finally(() => { if (active) setVerifying(false); });
    return () => { active = false; };
  }, [oobCode, actionRedirect]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => navigate("/login", { replace: true }), 3000);
    return () => clearTimeout(timer);
  }, [success, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || !codeValid || verifying) return;
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      setError("Password must contain at least 1 special character.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!firebaseAuth) {
      setError("Authentication not configured.");
      return;
    }

    submitting.current = true;
    setLoading(true);
    try {
      await confirmPasswordReset(firebaseAuth, oobCode, password);
      setSuccess(true);
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  if (actionRedirect) return <main className="min-h-screen flex items-center justify-center" role="status">Opening your secure account link…</main>;

  return (
    <main className="min-h-screen flex items-center justify-center dot-grid relative px-6">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="text-center mb-10">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            FYNX<span className="text-muted-foreground font-light ml-1">Funded</span>
          </Link>
          <h1 className="mt-2 text-sm font-normal text-muted-foreground">
            {success ? "Password updated" : "Set your new password"}
          </h1>
        </div>

        {verifying ? (
          <div role="status" className="text-center text-sm text-muted-foreground">Verifying reset link…</div>
        ) : success ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-foreground" />
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              Your password has been updated successfully. Redirecting to login…
            </p>
            <Link to="/login" className="text-sm text-foreground hover:underline">
              Go to Login
            </Link>
          </div>
        ) : !codeValid ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertCircle size={32} className="text-destructive" />
            </div>
            <p role="alert" className="text-sm text-destructive">{error || "Invalid reset link."}</p>
            <Link to="/forgot-password" className="text-sm text-foreground hover:underline">
              Request a new reset link
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div role="alert" className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {error}
              </div>
            )}
            <p className="text-xs text-muted-foreground mb-4 text-center">
              Setting new password for <span className="text-foreground font-medium">{email}</span>
            </p>
            <form aria-busy={loading} onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="text-xs font-medium text-muted-foreground block mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    id="new-password"
                    name="new-password"
                    autoComplete="new-password"
                    aria-describedby="reset-password-hint"
                    disabled={loading}
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-card border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 transition-shadow pr-10"
                    placeholder="8+ characters, including a symbol"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p id="reset-password-hint" className="mt-1 text-xs text-muted-foreground">Use at least 8 characters, including a symbol.</p>
              </div>
              <div>
                <label htmlFor="confirm-password" className="text-xs font-medium text-muted-foreground block mb-1.5">Confirm Password</label>
                <input
                  id="confirm-password"
                  name="confirm-password"
                  autoComplete="new-password"
                  disabled={loading}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-card border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 transition-shadow"
                  placeholder="Re-enter password"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground py-2.5 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Updating…
                  </>
                ) : (
                  "Set New Password"
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

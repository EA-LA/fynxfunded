import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { mapFirebaseError } from "@/lib/auth-error-map";

export default function ForgotPassword() {
  const submitting = useRef(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await resetPassword(normalizedEmail);
      setEmail(normalizedEmail);
      setSent(true);
    } catch (err: any) {
      setError(mapFirebaseError(err));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center dot-grid relative px-6">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="text-center mb-10">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            FYNX<span className="text-muted-foreground font-light ml-1">Funded</span>
          </Link>
          <h1 className="mt-2 text-sm font-normal text-muted-foreground">
            {sent ? "Check your inbox" : "Reset your password"}
          </h1>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-foreground" />
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              If an account uses <span className="text-foreground font-medium">{email}</span>, a password reset link will arrive shortly. Check your inbox and spam folder.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-foreground hover:underline"
            >
              <ArrowLeft size={14} /> Back to login
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div role="alert" className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {error}
              </div>
            )}
            <form aria-busy={loading} onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="text-xs font-medium text-muted-foreground block mb-1.5">Email</label>
                <input
                  id="reset-email"
                  name="email"
                  disabled={loading}
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-card border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 transition-shadow"
                  placeholder="trader@example.com"
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
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail size={14} /> Send Reset Link
                  </>
                )}
              </button>
            </form>
            <p className="mt-6 text-center">
              <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1">
                <ArrowLeft size={12} /> Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

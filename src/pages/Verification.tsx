import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, BadgeCheck, CheckCircle2, FileBadge, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { countries } from "@/lib/countries";
import { refreshKycStatus, submitKycProfile, watchCurrentUserKyc, type KycDocumentType, type KycStatus } from "@/services/kyc";

const documentTypes: Array<{ value: KycDocumentType; label: string }> = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver License" },
  { value: "national_id", label: "National ID" },
];

export default function Verification() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    countryOfResidence: user?.country || "",
    documentType: "passport" as KycDocumentType,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [liveStatus, setLiveStatus] = useState<KycStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [reason, setReason] = useState("");

  const kycStatus = liveStatus || user?.kycStatus || "not_started";
  const isVerified = kycStatus === "verified";
  const isPending = kycStatus === "pending";
  const countryOptions = useMemo(() => [...countries], []);

  useEffect(() => {
    if (!user?.userId) return;
    const unsubscribe = watchCurrentUserKyc(user.userId, (record) => {
      if (record.kycStatus) setLiveStatus(record.kycStatus);
      setReason(record.kycRejectionReason || "");
    });
    if (new URLSearchParams(window.location.search).has("verification-return")) {
      setChecking(true);
      refreshKycStatus()
        .then((result) => setOk(verificationMessage(result.status, result.reason)))
        .catch((e) => setError(e?.message || "Could not refresh verification status."))
        .finally(() => setChecking(false));
    }
    return unsubscribe;
  }, [user?.userId]);

  if (!user?.userId) return <Navigate to="/login" replace />;

  const submit = async () => {
    setError("");
    setOk("");
    if (!form.countryOfResidence || !form.documentType) {
      setError("Please complete all required fields before continuing to secure document capture.");
      return;
    }

    setSubmitting(true);
    try {
      const session = await submitKycProfile(user.userId, user.email, form);
      if (session.redirectUrl) {
        window.location.assign(session.redirectUrl);
        return;
      }
      if (session.status === "verified" || session.status === "processing") {
        setOk(verificationMessage(session.status));
      } else {
        setError("The verification link is unavailable. Please try again or contact support.");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to create a secure verification session.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <Link to="/dashboard/settings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to Settings
        </Link>

        <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-card shadow-2xl shadow-black/10">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-8 p-6 sm:p-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
                <ShieldCheck size={14} /> Secure identity verification
              </div>

              <div>
                <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">Identity Verification</h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Choose your country and document type, then securely verify your identity with Stripe using your document and a selfie.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Step icon={FileBadge} label="Profile" description="Country and document" active />
                <Step icon={UploadCloud} label="Provider" description="Stripe document capture" active={isPending || isVerified} />
                <Step icon={BadgeCheck} label="Decision" description="Verification result" active={isVerified} />
              </div>
            </div>

            <div className="border-t border-border bg-secondary/20 p-6 sm:p-10 lg:border-l lg:border-t-0">
              <div className="rounded-2xl border border-border bg-background/80 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Current Status</p>
                <div className="mt-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold capitalize">{kycStatus.replace("_", " ")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {isVerified ? "Your identity verification is complete." : isPending ? "Resume verification or check its latest status." : "Verification is required before payouts."}
                    </p>
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background">
                    {isVerified ? <CheckCircle2 size={24} /> : <LockKeyhole size={24} />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="premium-card border border-border">
            <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-xl font-semibold">Start your identity check</h2>
                <p className="mt-1 text-sm text-muted-foreground">Stripe securely collects the identity details and photos needed for verification.</p>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Provider: Stripe Identity</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Country of residence"><select className="input" value={form.countryOfResidence} onChange={(e) => setForm({ ...form, countryOfResidence: e.target.value })}><option value="">Select country</option>{countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}</select></Field>
              <Field label="Document type"><select className="input" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as KycDocumentType })}>{documentTypes.map((doc) => <option key={doc.value} value={doc.value}>{doc.label}</option>)}</select></Field>
            </div>

            {reason && <p className="mt-4 text-sm text-muted-foreground">{reason}</p>}
            {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
            {ok && <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">{ok}</p>}

            <button onClick={submit} disabled={submitting || checking || isVerified} className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
              <ShieldCheck size={16} /> {isVerified ? "Verified" : checking ? "Checking Status..." : submitting ? "Creating Secure Session..." : isPending ? "Resume Verification" : "Start Verification"}
            </button>
            <button disabled={checking || submitting} className="ml-3 mt-3 text-sm underline disabled:opacity-50" onClick={async () => {
              setChecking(true); setError(""); setOk("");
              try { const result = await refreshKycStatus(); setOk(verificationMessage(result.status, result.reason)); }
              catch (e) { setError(e instanceof Error ? e.message : "Unable to refresh verification."); }
              finally { setChecking(false); }
            }}>{checking ? "Checking…" : "Check status"}</button>
          </div>

          <aside className="space-y-4">
            <InfoCard icon={ShieldCheck} title="Verified results" text="Your status updates when Stripe finishes its checks. You can return here at any time to check progress." />
            <InfoCard icon={LockKeyhole} title="Payout protection" text="Payout requests remain blocked until kycStatus is verified on your account record." />
            <InfoCard icon={UploadCloud} title="Document and selfie" text="Have a valid government-issued photo ID ready. Stripe will guide you through document capture and a matching selfie." />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>{children}</div>;
}

function Step({ icon: Icon, label, description, active }: { icon: ElementType; label: string; description: string; active: boolean }) {
  return <div className={`rounded-2xl border p-4 ${active ? "border-foreground/20 bg-foreground text-background" : "border-border bg-secondary/40"}`}><Icon size={18} /><p className="mt-3 text-sm font-semibold">{label}</p><p className={`mt-1 text-xs ${active ? "text-background/70" : "text-muted-foreground"}`}>{description}</p></div>;
}

function InfoCard({ icon: Icon, title, text }: { icon: ElementType; title: string; text: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-2"><Icon size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold">{title}</h3></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p></div>;
}

export function verificationMessage(status: string, reason?: string | null) {
  if (status === "verified") return "Identity verified. Other payout requirements still apply.";
  if (status === "processing") return "Stripe is reviewing your verification. Check back shortly.";
  if (status === "requires_input") return reason || "Verification is incomplete. Resume verification to finish the required steps.";
  if (status === "canceled") return "This verification was canceled. Start a new verification to continue.";
  return "You have not started identity verification yet.";
}

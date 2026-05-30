import { useMemo, useState, type ElementType, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, BadgeCheck, CheckCircle2, FileBadge, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { countries } from "@/lib/countries";
import { submitKycProfile, type KycDocumentType } from "@/services/kyc";

const documentTypes: Array<{ value: KycDocumentType; label: string }> = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver License" },
  { value: "national_id", label: "National ID" },
];

export default function Verification() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    legalFullName: user?.fullName || "",
    dateOfBirth: "",
    countryOfResidence: user?.country || "",
    address: "",
    documentType: "passport" as KycDocumentType,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const kycStatus = user?.kycStatus || "not_started";
  const isVerified = kycStatus === "verified";
  const isPending = kycStatus === "pending";
  const countryOptions = useMemo(() => [...countries], []);

  if (!user?.userId) return <Navigate to="/login" replace />;

  const submit = async () => {
    setError("");
    setOk("");
    if (!form.legalFullName || !form.dateOfBirth || !form.countryOfResidence || !form.address || !form.documentType) {
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
      setOk("Verification session created. Continue in Stripe Identity when your deployment exposes the provider redirect.");
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
                <ShieldCheck size={14} /> Stripe Identity provider-ready verification
              </div>

              <div>
                <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">Identity Verification</h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Complete the required KYC profile and continue to secure document and biometric checks. FYNX does not approve accounts manually from this form and does not fake verification results.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Step icon={FileBadge} label="Profile" description="Legal identity details" active />
                <Step icon={UploadCloud} label="Provider" description="Stripe document capture" active={isPending || isVerified} />
                <Step icon={BadgeCheck} label="Decision" description="Webhook updates status" active={isVerified} />
              </div>
            </div>

            <div className="border-t border-border bg-secondary/20 p-6 sm:p-10 lg:border-l lg:border-t-0">
              <div className="rounded-2xl border border-border bg-background/80 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Current Status</p>
                <div className="mt-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold capitalize">{kycStatus.replace("_", " ")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {isVerified ? "Your account is payout eligible." : isPending ? "Your verification is being processed." : "Verification is required before payouts."}
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
                <h2 className="text-xl font-semibold">Required user information</h2>
                <p className="mt-1 text-sm text-muted-foreground">These fields are submitted to the KYC provider session architecture.</p>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Provider: Stripe Identity</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal full name"><input className="input" value={form.legalFullName} onChange={(e) => setForm({ ...form, legalFullName: e.target.value })} /></Field>
              <Field label="Date of birth"><input type="date" className="input" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></Field>
              <Field label="Country of residence"><select className="input" value={form.countryOfResidence} onChange={(e) => setForm({ ...form, countryOfResidence: e.target.value })}><option value="">Select country</option>{countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}</select></Field>
              <Field label="Document type"><select className="input" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as KycDocumentType })}>{documentTypes.map((doc) => <option key={doc.value} value={doc.value}>{doc.label}</option>)}</select></Field>
              <Field label="Residential address" className="sm:col-span-2"><textarea className="input min-h-28 resize-none" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city, region/state, postal code" /></Field>
            </div>

            {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
            {ok && <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">{ok}</p>}

            <button onClick={submit} disabled={submitting || isVerified} className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
              <ShieldCheck size={16} /> {isVerified ? "Already Verified" : submitting ? "Creating Secure Session..." : isPending ? "Resume / Retry Verification" : "Start Verification"}
            </button>
          </div>

          <aside className="space-y-4">
            <InfoCard icon={ShieldCheck} title="Provider decision only" text="Final verified or rejected status is written by verified Stripe Identity webhooks, not by this UI." />
            <InfoCard icon={LockKeyhole} title="Payout protection" text="Payout requests remain blocked until kycStatus is verified on your account record." />
            <InfoCard icon={UploadCloud} title="Switchable architecture" text="The frontend calls a KYC service layer so Sumsub, Persona, Veriff, or Onfido can be plugged in later." />
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

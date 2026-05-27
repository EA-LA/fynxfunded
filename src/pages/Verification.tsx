import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, BadgeCheck, ShieldCheck, UploadCloud } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { countries } from "@/lib/countries";
import { submitKycProfile } from "@/services/kyc";

export default function Verification() {
  const { user } = useAuth();
  const [form, setForm] = useState({ legalFullName: user?.fullName || "", dateOfBirth: "", countryOfResidence: user?.country || "", address: "", documentType: "passport" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const kycStatus = user?.kycStatus || "not_started";
  const isVerified = kycStatus === "verified";

  const countryOptions = useMemo(() => countries.map((c) => c.name), []);

  if (!user?.userId) return <Navigate to="/login" replace />;

  const submit = async () => {
    setError("");
    setOk("");
    if (!form.legalFullName || !form.dateOfBirth || !form.countryOfResidence || !form.address) {
      setError("Please complete all required fields.");
      return;
    }
    setSubmitting(true);
    try {
      await submitKycProfile(user.userId, user.email, form as any);
      setOk("Verification submitted successfully. We will review your identity shortly.");
    } catch (e: any) {
      setError(e?.message || "Failed to submit verification.");
    } finally { setSubmitting(false); }
  };

  return <div className="min-h-screen bg-background px-6 py-10">
    <div className="max-w-5xl mx-auto space-y-6">
      <Link to="/dashboard/settings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14}/>Back to Settings</Link>
      <div className="premium-card border border-border">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div><h1 className="text-3xl font-bold">Identity Verification</h1><p className="text-sm text-muted-foreground mt-1">Secure KYC onboarding for payouts and compliance.</p></div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary text-xs"><ShieldCheck size={14}/>Provider: Stripe Identity</div>
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 premium-card">
          <h2 className="text-lg font-semibold mb-4">Verification Details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Legal full name"><input className="input" value={form.legalFullName} onChange={(e)=>setForm({...form, legalFullName:e.target.value})}/></Field>
            <Field label="Date of birth"><input type="date" className="input" value={form.dateOfBirth} onChange={(e)=>setForm({...form, dateOfBirth:e.target.value})}/></Field>
            <Field label="Country of residence"><select className="input" value={form.countryOfResidence} onChange={(e)=>setForm({...form, countryOfResidence:e.target.value})}><option value="">Select country</option>{countryOptions.map((c)=><option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Document type"><select className="input" value={form.documentType} onChange={(e)=>setForm({...form, documentType:e.target.value})}><option value="passport">Passport</option><option value="drivers_license">Driver License</option><option value="national_id">National ID</option></select></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className="input min-h-24" value={form.address} onChange={(e)=>setForm({...form, address:e.target.value})}/></Field>
          </div>
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
          {ok && <p className="text-sm text-emerald-500 mt-3">{ok}</p>}
          <button onClick={submit} disabled={submitting || isVerified} className="mt-5 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50">{isVerified ? "Already Verified" : submitting ? "Submitting..." : "Submit Verification"}</button>
        </div>
        <div className="premium-card space-y-4">
          <h3 className="font-semibold">Status</h3>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-sm font-medium mt-1 capitalize">{kycStatus.replace("_", " ")}</p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-4 text-sm text-muted-foreground">
            <p className="flex items-center gap-2"><UploadCloud size={14}/>Document capture and biometric checks are processed by Stripe Identity.</p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-4 text-sm text-muted-foreground">
            <p className="flex items-center gap-2"><BadgeCheck size={14}/>Only verified users can request payouts.</p>
          </div>
        </div>
      </div>
    </div>
  </div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><label className="text-xs text-muted-foreground block mb-1.5">{label}</label>{children}</div>;
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Award, BadgeCheck, ExternalLink, ShieldCheck } from "lucide-react";
import { getCertificateByPublicId, getCertificateTitle } from "@/services/certificates";
import type { Certificate } from "@/services/types";

function money(value?: number) {
  return typeof value === "number" ? `$${value.toLocaleString()}` : "—";
}

function date(value?: unknown) {
  if (!value) return "—";
  const parsed = typeof value === "object" && value !== null && "toDate" in value ? (value as { toDate: () => Date }).toDate() : new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

export default function CertificateVerification() {
  const { certificateId = "" } = useParams();
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getCertificateByPublicId(certificateId)
      .then((record) => mounted && setCertificate(record))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [certificateId]);

  const isValid = certificate && certificate.status !== "revoked";

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"><ExternalLink size={14} /> FYNX Funded</Link>
        <section className="overflow-hidden rounded-[2rem] border border-white/15 bg-[radial-gradient(circle_at_top,#333,transparent_35%),linear-gradient(135deg,#0a0a0a,#171717)] p-6 shadow-2xl sm:p-10">
          {loading ? (
            <div className="grid min-h-[320px] place-items-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" /></div>
          ) : isValid ? (
            <div className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr]">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.25em] text-emerald-200">
                  <ShieldCheck size={14} /> Verified Certificate
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-white/50">FYNX Funded</p>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">{getCertificateTitle(certificate.type)}</h1>
                  <p className="mt-4 max-w-2xl text-white/65">This public verification page confirms that the certificate was generated from backend account progress, payout, and challenge status records.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <p className="text-sm text-white/50">Awarded to</p>
                  <p className="mt-1 text-3xl font-semibold">{certificate.traderName}</p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <Info label="Certificate ID" value={certificate.publicVerificationId} />
                    <Info label="Account ID" value={certificate.accountId} />
                    <Info label="Challenge" value={certificate.challengeType} />
                    <Info label="Account Size" value={money(certificate.accountSize)} />
                    <Info label="Passed Date" value={date(certificate.passedDate)} />
                    <Info label="Funded Date" value={date(certificate.fundedDate)} />
                    <Info label="Profit Split" value={certificate.profitSplit || "—"} />
                    <Info label="Issued" value={date(certificate.issuedAt)} />
                  </div>
                </div>
              </div>
              <aside className="rounded-3xl border border-white/10 bg-white p-6 text-black">
                <Award className="mx-auto" size={56} />
                <p className="mt-5 text-center text-xs uppercase tracking-[0.3em] text-black/50">Authenticity</p>
                <h2 className="mt-2 text-center text-2xl font-semibold">Valid & Active</h2>
                <div className="mt-8 grid aspect-square place-items-center rounded-2xl border border-black/10 bg-[linear-gradient(45deg,#000_25%,transparent_25%),linear-gradient(-45deg,#000_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#000_75%),linear-gradient(-45deg,transparent_75%,#000_75%)] bg-[length:18px_18px] bg-[position:0_0,0_9px,9px_-9px,-9px_0] p-4">
                  <div className="rounded bg-white px-3 py-2 text-center text-xs font-bold">FYNX<br />VERIFY</div>
                </div>
                <p className="mt-6 break-all rounded-xl bg-black/5 p-3 text-center text-xs text-black/60">{certificate.verificationUrl}</p>
              </aside>
            </div>
          ) : (
            <div className="grid min-h-[320px] place-items-center text-center">
              <div>
                <BadgeCheck className="mx-auto text-white/30" size={48} />
                <h1 className="mt-4 text-3xl font-semibold">Certificate not verified</h1>
                <p className="mt-2 max-w-md text-white/60">No active public certificate was found for ID {certificateId}. It may have been revoked or the ID may be incorrect.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-[0.2em] text-white/40">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

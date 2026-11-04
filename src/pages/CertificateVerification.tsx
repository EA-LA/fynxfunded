import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Award, BadgeCheck, Check, Copy, RefreshCw, Search, ShieldCheck } from "lucide-react";
import MarketingLayout from "@/components/MarketingLayout";
import { getCertificateByPublicId, getCertificateTitle } from "@/services/certificates";
import type { Certificate } from "@/services/types";
import { publicAccountReference } from "@/lib/publicReferences";
import { certificateVerifyPath, certificateVerifyUrl, normalizeCertificateInput } from "@/lib/certificateLookup";

function money(value?: number) {
  return typeof value === "number" && value > 0 ? `$${value.toLocaleString()}` : "—";
}

function date(value?: unknown) {
  if (!value) return "—";
  const parsed = typeof value === "object" && value !== null && "toDate" in value ? (value as { toDate: () => Date }).toDate() : new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

function recipientName(certificate: Certificate) {
  const name = certificate.traderName?.trim();
  return name && !name.includes("@") && name.toLowerCase() !== "trader" ? name : "FYNX Trader";
}

export default function CertificateVerification() {
  const { certificateId = "" } = useParams();
  const navigate = useNavigate();
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(Boolean(certificateId));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState(certificateId);
  const [inputError, setInputError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setQuery(certificateId); setInputError(""); setCopied(false); }, [certificateId]);

  useEffect(() => {
    if (!certificateId) { setLoading(false); setCertificate(null); setError(""); return; }
    let mounted = true;
    setLoading(true); setCertificate(null); setError("");
    getCertificateByPublicId(certificateId)
      .then((record) => { if (mounted) { setCertificate(record); setCheckedAt(new Date()); } })
      .catch(() => { if (mounted) setError("Certificate verification is temporarily unavailable. Please try again in a moment."); })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [certificateId, attempt]);

  const isValid = Boolean(certificate && certificate.status === "issued");

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = normalizeCertificateInput(query);
    if (!id) { setInputError("Enter a certificate ID or paste a verification link."); return; }
    setInputError("");
    if (id === certificateId) setAttempt((n) => n + 1);
    else navigate(certificateVerifyPath(id));
  }

  async function copyLink() {
    const url = certificateVerifyUrl(certificateId, typeof window !== "undefined" ? window.location.origin : undefined);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this verification link:", url);
    }
  }

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:px-6 md:py-16">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">Public certificate check</p>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{certificateId ? "Certificate verification" : "Verify a FYNX Funded certificate"}</h1>
          <p className="max-w-2xl text-muted-foreground">
            Anyone can check that a FYNX Funded certificate is genuine and still valid. Enter the certificate ID printed on it (for example FYNX-CERT-0A1B2C3) or paste the verification link the holder shared.
          </p>
          <form onSubmit={submit} className="flex max-w-2xl flex-col gap-2 sm:flex-row" role="search" aria-label="Verify a certificate">
            <label htmlFor="certificate-id" className="sr-only">Certificate ID or verification link</label>
            <input
              id="certificate-id"
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (inputError) setInputError(""); }}
              placeholder="Certificate ID or link"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? "certificate-id-error" : undefined}
              className="h-11 w-full min-w-0 rounded-md sm:flex-1 border border-border bg-background px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            />
            <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Search size={16} aria-hidden="true" /> Verify
            </button>
          </form>
          {inputError && <p id="certificate-id-error" role="alert" className="text-sm text-destructive">{inputError}</p>}
        </header>

        {certificateId && (
          <section aria-live="polite" className="overflow-hidden rounded-[2rem] border border-white/15 bg-[radial-gradient(circle_at_top,#333,transparent_35%),linear-gradient(135deg,#0a0a0a,#171717)] p-6 text-white shadow-2xl sm:p-10">
            {loading ? (
              <div className="grid min-h-[320px] place-items-center" role="status"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" /><span className="sr-only">Checking certificate…</span></div>
            ) : isValid && certificate ? (
              <div className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr]">
                <div className="space-y-6">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.25em] text-emerald-200">
                    <ShieldCheck size={14} /> Verified Certificate
                  </div>
                  <div>
                    <p className="text-sm uppercase tracking-[0.35em] text-white/50">FYNX Funded</p>
                    <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">{getCertificateTitle(certificate.type)}</h2>
                    <p className="mt-4 max-w-2xl text-white/65">This public verification page confirms that the certificate was generated from backend account progress, payout, and challenge status records.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                    <p className="text-sm text-white/50">Awarded to</p>
                    <p className="mt-1 break-words text-3xl font-semibold">{recipientName(certificate)}</p>
                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <Info label="Certificate ID" value={certificate.publicVerificationId || certificateId} />
                      <Info label="Account" value={certificate.type === "learning_completion" ? "FYNX Academy" : publicAccountReference({ accountId: certificate.accountId, challengeId: certificate.challengeId })} />
                      <Info label="Challenge" value={certificate.challengeType || "—"} />
                      <Info label="Account Size" value={money(certificate.accountSize)} />
                      <Info label="Passed Date" value={date(certificate.passedDate)} />
                      <Info label="Funded Date" value={date(certificate.fundedDate)} />
                      <Info label="Profit Split" value={certificate.profitSplit || "—"} />
                      <Info label="Issued" value={date(certificate.issuedAt)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-md border border-white/20 px-4 py-2 text-sm hover:bg-white/10">
                      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? "Link copied" : "Copy verification link"}
                    </button>
                    {checkedAt && <p className="text-xs text-white/50">Status checked {checkedAt.toLocaleString()}</p>}
                  </div>
                </div>
                <aside className="rounded-3xl border border-white/10 bg-white p-6 text-black">
                  <Award className="mx-auto" size={56} />
                  <p className="mt-5 text-center text-xs uppercase tracking-[0.3em] text-black/50">Authenticity</p>
                  <p className="mt-2 text-center text-2xl font-semibold">Valid & Active</p>
                  <div className="mt-8 grid aspect-square place-items-center rounded-2xl border border-black/10 bg-[linear-gradient(45deg,#000_25%,transparent_25%),linear-gradient(-45deg,#000_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#000_75%),linear-gradient(-45deg,transparent_75%,#000_75%)] bg-[length:18px_18px] bg-[position:0_0,0_9px,9px_-9px,-9px_0] p-4">
                    <div className="rounded bg-white px-3 py-2 text-center text-xs font-bold">FYNX<br />VERIFY</div>
                  </div>
                  <p className="mt-6 break-all rounded-xl bg-black/5 p-3 text-center text-xs text-black/60">{certificate.verificationUrl || certificateVerifyUrl(certificateId)}</p>
                </aside>
              </div>
            ) : (
              <div className="grid min-h-[320px] place-items-center text-center">
                <div className="max-w-lg">
                  <BadgeCheck className="mx-auto text-white/30" size={48} />
                  <h2 className="mt-4 text-3xl font-semibold">{error ? "Unable to verify certificate" : "Certificate not verified"}</h2>
                  <p className="mt-2 break-words text-white/60">{error || `No active public certificate was found for ID ${certificateId}. It may have been revoked or the ID may be incorrect.`}</p>
                  {error ? (
                    <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-6 inline-flex items-center gap-2 rounded-md border border-white/20 px-4 py-2 text-sm hover:bg-white/10">
                      <RefreshCw size={14} aria-hidden="true" /> Try again
                    </button>
                  ) : (
                    <ul className="mt-6 space-y-2 text-left text-sm text-white/60">
                      <li>• Check every character: IDs look like FYNX-CERT-0A1B2C3 or FYNX-LEARN-0A1B2C3.</li>
                      <li>• Ask the holder for the verification link from their dashboard and paste it above.</li>
                      <li>• Still not found? Email <a className="underline hover:text-white" href="mailto:support@fynxfunded.com">support@fynxfunded.com</a> with the ID.</li>
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="what-verification-shows" className="space-y-4">
          <h2 id="what-verification-shows" className="text-xl font-semibold">What a verified certificate tells you</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Explainer title="Issued from account records">
              Certificates are created automatically from FYNX Funded challenge, funded-account and payout records, or from completed FYNX Academy quizzes. They cannot be typed in by hand.
            </Explainer>
            <Explainer title="Always the current status">
              This page looks the certificate up each time it opens. A revoked certificate shows as not verified, even if someone still has an old copy or screenshot.
            </Explainer>
            <Explainer title="Only certificate details">
              It shows the holder's display name, the program, account size and dates. Email addresses, logins and trade history are never shown. Account sizes are simulated evaluation sizes, not deposits.
            </Explainer>
          </div>
          <p className="text-sm text-muted-foreground">
            Earned a certificate? Find it, download it as a PDF and share its link from <Link to="/dashboard/certificates" className="underline hover:text-foreground">your dashboard</Link>. Questions: <Link to="/faq#certificate-verification" className="underline hover:text-foreground">see the FAQ</Link>.
          </p>
        </section>
      </div>
    </MarketingLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-[0.2em] text-white/40">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>;
}

function Explainer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

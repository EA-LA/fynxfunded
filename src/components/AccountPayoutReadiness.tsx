import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, CircleDashed, ClipboardCheck } from "lucide-react";
import GlossaryTip from "@/components/GlossaryTip";
import { checkPayoutReadiness, type CheckState, type ReadinessCheck } from "@/lib/payoutReadiness";
import { payoutPrefill, selfCheckLink, type PrefillAccount, type PrefillChallenge, type PrefillPayout, type PrefillSource } from "@/lib/payoutPrefill";
import { publicAccountReference } from "@/lib/publicReferences";
import { useTradingData } from "@/hooks/use-trading-data";
import { engineLabel, useEngine } from "@/trade-access/useEngine";
import type { TradingGateway } from "@/engine/gateway";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const stateIcon: Record<CheckState, ReactNode> = {
  met: <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />,
  missing: <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />,
  unanswered: <CircleDashed size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />,
};
const stateWord: Record<CheckState, string> = { met: "Met", missing: "Not yet", unanswered: "Not known yet" };
const sourceWord: Record<PrefillSource, string> = {
  trades: "Your trade records",
  payouts: "Your payout requests",
  live: "Live from FYNX Trade",
  account: "Your account record",
  kyc: "Your verification",
  unknown: "Check yourself",
};
const checkTerm: Partial<Record<ReadinessCheck["id"], string>> = { days: "trading-day", violations: "breach", kyc: "kyc", minimum: "profit-split" };

export type ReadinessChallenge = PrefillChallenge & { name?: string; accountReference?: string };

/**
 * Dashboard Payouts: "Payout readiness for your account". The five published
 * payout conditions answered from the trader's own records (trades, payout
 * requests, verification, and the live FYNX Trade account when connected).
 * Reads only; requests are still sent and reviewed as before.
 */
export default function AccountPayoutReadiness({
  challenges, accounts, payouts, kycVerified, gateway, now,
}: {
  challenges: ReadinessChallenge[];
  accounts: (PrefillAccount & { challengeId?: string })[];
  payouts: PrefillPayout[];
  kycVerified: boolean | null;
  gateway?: TradingGateway;
  now?: Date;
}) {
  const funded = useMemo(() => challenges.filter((c) => c.status === "funded"), [challenges]);
  const [selected, setSelected] = useState("");
  const challenge = funded.find((c) => c.challengeId === selected) ?? funded[0];
  const account = useMemo(() => {
    if (!challenge) return null;
    const matches = accounts.filter((a) => a.challengeId === challenge.challengeId && (!challenge.brokerAccountId || [a.accountId, a.login].includes(String(challenge.brokerAccountId))));
    return matches.length === 1 ? matches[0] : null;
  }, [accounts, challenge]);

  // This account's closed trades (the same records Trades and Analytics read).
  const trades = useTradingData(challenge?.challengeId).trades ?? [];
  const onFynxTrade = account?.platform === "FYNX Trade";
  const engine = useEngine(onFynxTrade ? account!.accountId : null, gateway, { pollMs: 10_000, enabled: onFynxTrade });
  const snap = engine.snapshot;
  const live = onFynxTrade && snap ? { positions: snap.state.positions.length, status: snap.state.status } : null;

  const [today, setToday] = useState<Date | null>(now ?? null);
  useEffect(() => { if (!now) setToday(new Date()); }, [now]);

  if (!challenge) return null;
  const prefill = payoutPrefill({ challenge, account, trades, payouts, fundedCount: funded.length, kycVerified, live });
  const name = publicAccountReference(challenge) || challenge.name || "Funded account";

  return (
    <section className="premium-card" aria-labelledby="account-readiness-title" data-testid="account-payout-readiness">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <ClipboardCheck size={16} className="text-muted-foreground" aria-hidden="true" />
        <h3 id="account-readiness-title" className="text-sm font-semibold">Payout readiness for your account</h3>
        {onFynxTrade && <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground" title={engine.status?.message}>{engine.status ? engineLabel(engine.status) : "Checking FYNX Trade…"}</span>}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The published payout conditions, answered from your own records. It reads only: nothing is sent, and every request is still reviewed.
      </p>

      {funded.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Funded account">
          {funded.map((c) => {
            const active = c.challengeId === challenge.challengeId;
            return (
              <button key={c.challengeId} type="button" aria-pressed={active} onClick={() => setSelected(c.challengeId)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>
                {publicAccountReference(c) || c.name || c.challengeId} · {usd(c.accountSize).replace(".00", "")}
              </button>
            );
          })}
        </div>
      )}

      {!prefill.program ? (
        <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground" data-testid="readiness-no-plan">
          {name}'s plan isn't in the published schedule, so its split and payout minimum can't be worked out here. Contact support for this account's payout terms.
        </p>
      ) : (
        <Result prefill={prefill} today={today} name={name} />
      )}
    </section>
  );
}

function Result({ prefill, today, name }: { prefill: ReturnType<typeof payoutPrefill>; today: Date | null; name: string }) {
  const result = checkPayoutReadiness({ accountSize: prefill.accountSize, program: prefill.program!, ...prefill.input }, today ?? new Date(0));
  const headline = result.ready ? "Ready to request" : result.missing.length ? "Not ready yet" : "Almost there: a few things to check";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="rounded-lg bg-secondary/50 p-4" data-testid="account-readiness-summary">
        <p className="text-xs text-muted-foreground">{name} · {result.metCount} of {result.checks.length} conditions met</p>
        <p className="mt-1 text-xl font-bold" aria-live="polite">{headline}</p>
        <div className="mt-2 h-2 rounded-full bg-background" aria-hidden="true">
          <div className={`h-2 rounded-full ${result.ready ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${(result.metCount / result.checks.length) * 100}%` }} />
        </div>
        {today && <p className="mt-3 text-sm">{result.summary}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Net profit counted</dt><dd className="font-semibold tabular-nums">{prefill.input.netProfit === null ? "—" : usd(prefill.input.netProfit)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Your estimated share ({result.splitPercent}%)</dt><dd className="font-semibold tabular-nums">{prefill.input.netProfit === null ? "—" : usd(result.traderShare)}</dd></div>
        </dl>
        {prefill.pending && (
          <p className="mt-4 rounded-md border border-border p-3 text-xs" role="status" data-testid="readiness-pending">
            You already have a request waiting for review{prefill.pending.amount !== null ? ` (${usd(prefill.pending.amount)})` : ""}, sent {new Date(prefill.pending.requestedAt).toLocaleDateString()}. Its result is shown in your payout history below.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium">
          <Link to={selfCheckLink(prefill)} className="underline underline-offset-4">Open in the self-check</Link>
          {prefill.input.kycDone === false && <Link to="/verification" className="underline underline-offset-4">Start identity verification</Link>}
          <Link to="/dashboard/objectives" className="underline underline-offset-4">Check my objectives</Link>
        </div>
      </div>
      <ul className="space-y-3 text-sm">
        {result.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2" data-state={c.state} data-check={c.id}>
            {stateIcon[c.state]}
            <div className="min-w-0">
              <p className="font-medium">
                <span className="sr-only">{stateWord[c.state]}: </span>
                {c.label}
                {checkTerm[c.id] && <GlossaryTip term={checkTerm[c.id]!} className="ml-1" />}
              </p>
              {c.state !== "unanswered" && <p className="text-xs text-muted-foreground">{c.detail}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">{sourceWord[prefill.notes[c.id].source]}</span>
                {prefill.notes[c.id].note}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

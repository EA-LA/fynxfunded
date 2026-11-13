import { useState } from 'react';
import { Mail } from 'lucide-react';
import { NOTICE_KINDS, nearLimitPercent, noticePrefs } from '@/engine/core';
import type { NoticeKind } from '@/engine/types';
import type { EngineHandle } from './useEngine';
import { NEAR_CHOICES, nearPreview, previewSentence, todaysWarnings, warningSentence } from './near-limit';

const localTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const NOTICE_LABELS: Record<NoticeKind, string> = {
  alert: 'A price alert fires',
  fill: 'A pending order is filled',
  stop: 'A stop loss or take profit closes a trade',
  limit: 'A loss limit is reached, or trades are closed before the weekend',
  target: 'The profit target is reached',
  expiry: 'A pending order expires',
  near: 'Equity comes close to a loss limit',
};

/**
 * "Email me when…" choices in the Alerts tab. The choices are kept on the
 * trading server with the account, so they apply with the terminal closed.
 * Whether an email actually goes out depends on the owner connecting a sender
 * (`/v1/status` notices: true); until then the box says so plainly.
 */
export default function NoticeSettings({ engine }: { engine: EngineHandle }) {
  const snap = engine.snapshot, connected = !!engine.status?.connected && !!snap;
  const sender = !!engine.status?.notices;
  const prefs = noticePrefs(snap?.state ?? {});
  const [saved, setSaved] = useState('');
  const toggle = (k: NoticeKind, on: boolean) => {
    if (!snap) return;
    setSaved('');
    void engine.run(g => g.setNotices(snap.state.accountId, { [k]: on })).then(ok => ok && setSaved(`${on ? 'On' : 'Off'}: ${NOTICE_LABELS[k].toLowerCase()}.`));
  };
  const percent = nearLimitPercent(snap?.state ?? {});
  const choices = NEAR_CHOICES.includes(percent) ? NEAR_CHOICES : [...NEAR_CHOICES, percent].sort((a, b) => a - b);
  const setDistance = (nearPercent: number) => {
    if (!snap) return;
    setSaved('');
    void engine.run(g => g.setNotices(snap.state.accountId, { nearPercent })).then(ok => ok && setSaved(`Close-to-limit warning at ${nearPercent}% of the allowance left.`));
  };
  const preview = snap ? nearPreview(snap.state, snap.metrics, percent) : null;
  const warnings = snap ? todaysWarnings(snap.state) : [];
  return <fieldset className="space-y-1.5 rounded-md border p-3 text-sm" data-testid="notice-settings" disabled={!connected || engine.busy}>
    <legend className="flex items-center gap-1.5 px-1 font-semibold"><Mail size={14} aria-hidden="true" />Email me when…</legend>
    {NOTICE_KINDS.map(k => <label key={k} className="flex items-start gap-2 text-xs">
      <input type="checkbox" className="mt-0.5" checked={connected && prefs[k]} onChange={e => toggle(k, e.target.checked)} data-testid={`notice-${k}`} />
      <span>{NOTICE_LABELS[k]}</span>
    </label>)}
    <div className="ml-5 space-y-1 border-l pl-2 text-[11px]" data-testid="near-settings">
      <label className="flex flex-wrap items-center gap-1.5">
        <span>Warn me when this share of a loss allowance is left:</span>
        <select className="rounded border bg-background px-1 py-0.5" value={percent} onChange={e => setDistance(Number(e.target.value))} data-testid="near-percent" aria-label="Close-to-limit warning distance">
          {choices.map(c => <option key={c} value={c}>{c}%</option>)}
        </select>
      </label>
      <p className="text-muted-foreground" data-testid="near-preview">{!connected || !preview
        ? 'Once connected, this shows the warning level in dollars for your account.'
        : `${previewSentence(preview)}${preview.roomNow !== null ? ` Now: $${preview.roomNow.toFixed(2)} left before the daily level.` : ''}`}</p>
      <p className="text-muted-foreground">Sent at most once per limit per trading day, on live prices. A warning never opens or closes a trade.</p>
      {connected && prefs.near && warnings.length > 0 && <ul className="space-y-0.5 text-amber-700 dark:text-amber-400" data-testid="near-today" aria-label="Close-to-limit warnings today">
        {warnings.map(w => <li key={w.limit}>{warningSentence(w, localTime)}</li>)}
      </ul>}
    </div>
    <p className="pt-1 text-[11px] text-muted-foreground" data-testid="notice-status">{!connected
      ? 'Email notices can be chosen once the trading server is connected.'
      : sender
        ? 'Sent to the email address of your FYNX account, also when this page is closed. At most 30 an hour.'
        : 'Your choices are saved on the trading server. Emails start once FYNX connects the email sender; nothing is emailed before that.'}</p>
    {saved && <p role="status" className="text-[11px] text-emerald-600 dark:text-emerald-400" data-testid="notice-saved">{saved}</p>}
  </fieldset>;
}

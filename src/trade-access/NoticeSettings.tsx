import { useState } from 'react';
import { Mail } from 'lucide-react';
import { NOTICE_KINDS, noticePrefs } from '@/engine/core';
import type { NoticeKind } from '@/engine/types';
import type { EngineHandle } from './useEngine';

export const NOTICE_LABELS: Record<NoticeKind, string> = {
  alert: 'A price alert fires',
  fill: 'A pending order is filled',
  stop: 'A stop loss or take profit closes a trade',
  limit: 'A loss limit is reached',
  target: 'The profit target is reached',
  expiry: 'A pending order expires',
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
  return <fieldset className="space-y-1.5 rounded-md border p-3 text-sm" data-testid="notice-settings" disabled={!connected || engine.busy}>
    <legend className="flex items-center gap-1.5 px-1 font-semibold"><Mail size={14} aria-hidden="true" />Email me when…</legend>
    {NOTICE_KINDS.map(k => <label key={k} className="flex items-start gap-2 text-xs">
      <input type="checkbox" className="mt-0.5" checked={connected && prefs[k]} onChange={e => toggle(k, e.target.checked)} data-testid={`notice-${k}`} />
      <span>{NOTICE_LABELS[k]}</span>
    </label>)}
    <p className="pt-1 text-[11px] text-muted-foreground" data-testid="notice-status">{!connected
      ? 'Email notices can be chosen once the trading server is connected.'
      : sender
        ? 'Sent to the email address of your FYNX account, also when this page is closed. At most 30 an hour.'
        : 'Your choices are saved on the trading server. Emails start once FYNX connects the email sender; nothing is emailed before that.'}</p>
    {saved && <p role="status" className="text-[11px] text-emerald-600 dark:text-emerald-400" data-testid="notice-saved">{saved}</p>}
  </fieldset>;
}

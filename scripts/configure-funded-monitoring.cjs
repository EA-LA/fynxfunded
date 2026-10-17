#!/usr/bin/env node
// Funded-only console incident policies. Never attaches notification recipients or sends test mail.
const fs = require('node:fs'), path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');
const project = 'fynx-c7a28', marker = 'funded_checklist_oct17';
const scope = service => `resource.type="cloud_run_revision" AND resource.labels.project_id="${project}" AND resource.labels.service_name="${service}"`;
const specs = [
  ['FYNX Funded: reconciliation failed', `${scope('reconcilefundedorders')} AND (jsonPayload.code="FYNX_FUNDED_RECONCILIATION_FAILED" OR severity>=ERROR)`, 'The scheduled internal scan failed. Check the current report timestamp and function logs. Do not infer provider health or replay payments.'],
  ['FYNX Funded: reconciliation needs review', `${scope('reconcilefundedorders')} AND jsonPayload.code="FYNX_FUNDED_RECONCILIATION_ATTENTION"`, 'Review Operations health for pending account setup, binding conflicts, incomplete scans and duplicate references. Findings are internal; no automatic repair runs.'],
  ['FYNX Funded: payment webhook processing failed', `${scope('stripewebhook')} AND (textPayload:"[Stripe Webhook] Event processing failed" OR jsonPayload.message:"[Stripe Webhook] Event processing failed")`, 'Inspect the failed webhook and current owned order before a controlled idempotent replay. A failed processing event does not authorize a second payment or entitlement.'],
];
async function main() {
  const token = (await admin.credential.applicationDefault().getAccessToken()).access_token;
  const root = `https://monitoring.googleapis.com/v3/projects/${project}/alertPolicies`;
  const call = async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw Error(`Monitoring request failed (${response.status}, ${data.error?.status || 'unknown'}).`); return data;
  };
  let page, all = [];
  do { const data = await call(root + (page ? '?pageToken=' + encodeURIComponent(page) : '')); all.push(...(data.alertPolicies || [])); page = data.nextPageToken; } while (page);
  const report = { checkedAt: new Date().toISOString(), mode: process.argv.includes('--apply') ? 'apply' : 'plan', notificationDeliveryVerified: false, notificationRecipientsAdded: false, policies: [] };
  for (const [displayName, filter, instructions] of specs) {
    const existing = all.filter(p => p.displayName === displayName);
    if (existing.length > 1 || existing.some(p => p.userLabels?.managed_by !== marker)) throw Error('Policy name conflicts with an unmanaged policy; no overwrite is allowed.');
    const body = { displayName, combiner: 'OR', enabled: true, userLabels: { managed_by: marker },
      documentation: { mimeType: 'text/markdown', content: instructions + '\n\nConsole incident only. An owner must confirm routing and receipt before this is treated as an attended alert.' },
      conditions: [{ displayName, conditionMatchedLog: { filter } }], alertStrategy: { notificationRateLimit: { period: '3600s' }, autoClose: '86400s' }, notificationChannels: [] };
    let policy = existing[0];
    if (!policy && process.argv.includes('--apply')) policy = await call(root, 'POST', body);
    if (policy && (!policy.enabled || policy.conditions?.[0]?.conditionMatchedLog?.filter !== filter)) throw Error('Existing managed policy differs; inspect it before changing its configuration.');
    report.policies.push({ displayName, name: policy?.name ?? null, enabled: policy?.enabled ?? false, filter, configured: !!policy, notificationChannelCount: policy?.notificationChannels?.length ?? 0 });
  }
  const file = path.join(__dirname, '../docs/launch-2026-10-17/monitoring.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ mode: report.mode, configured: report.policies.filter(p => p.configured).length, recipientsAdded: false, deliveryVerified: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

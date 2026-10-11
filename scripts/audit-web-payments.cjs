#!/usr/bin/env node
// Read-only configuration inspection. Secret values stay in memory and are never recorded.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');
async function main() {
  const project = 'fynx-c7a28';
  const credential = admin.credential.applicationDefault();
  const token = (await credential.getAccessToken()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const report = { checkedAt: new Date().toISOString(), mode: 'read-only; no payments created', functions: {}, stripe: {} };
  for (const name of ['createCheckoutSession', 'verifySession', 'stripeWebhook']) {
    const response = await fetch(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/us-central1/functions/${name}`, { headers });
    const data = await response.json();
    report.functions[name] = response.ok ? { state: data.state, updatedAt: data.updateTime, runtime: data.buildConfig?.runtime,
      secrets: (data.serviceConfig?.secretEnvironmentVariables ?? []).map(x => ({ name: x.key, version: x.version })),
      purchasesApproved: data.serviceConfig?.environmentVariables?.FYNX_FUNDED_PURCHASES_APPROVED === 'true' } : { httpStatus: response.status };
  }
  const binding = report.functions.createCheckoutSession.secrets?.find(x => x.name === 'STRIPE_SECRET_KEY');
  if (binding) {
    const response = await fetch(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/STRIPE_SECRET_KEY/versions/${binding.version}:access`, { headers });
    if (response.ok) {
      const data = await response.json();
      const key = Buffer.from(data.payload.data, 'base64').toString('utf8').trim();
      report.stripe.keyMode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : 'unconfigured';
      if (report.stripe.keyMode !== 'unconfigured') {
        const stripeHeaders = { Authorization: `Bearer ${key}` };
        const accountResponse = await fetch('https://api.stripe.com/v1/account', { headers: stripeHeaders });
        const account = await accountResponse.json();
        report.stripe.account = accountResponse.ok ? { readable: true, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted } : { readable: false, httpStatus: accountResponse.status };
        const hooksResponse = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', { headers: stripeHeaders });
        const hooks = await hooksResponse.json();
        report.stripe.webhooks = hooksResponse.ok ? (hooks.data ?? []).filter(x => /fynx-c7a28.*stripeWebhook|stripewebhook-/i.test(x.url)).map(x => ({ url: x.url, status: x.status, enabledEvents: x.enabled_events, live: x.livemode })) : { readable: false, httpStatus: hooksResponse.status };
        report.stripe.webhookListComplete = hooks.has_more === false;
      }
    } else report.stripe.secretAccessStatus = response.status;
  }
  const hold = await fetch(`https://us-central1-${project}.cloudfunctions.net/createCheckoutSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const holdResult = await hold.json();
  report.purchaseHold = { httpStatus: hold.status, enforced: hold.status === 503 && holdResult.code === 'PAYMENTS_PAUSED' };
  const output = path.resolve(__dirname, '../docs/launch-2026-10-11/payments-configuration.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Payment audit could not finish. Check authorized Google access; no credentials logged.'); process.exitCode = 1; });

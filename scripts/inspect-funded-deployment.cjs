#!/usr/bin/env node
// Read-only release provenance. Environment values and secret values are excluded.
const fs = require('node:fs'), path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');
async function main() {
  const phase = process.argv[2];
  if (!['before', 'after'].includes(phase)) throw Error('Use before or after.');
  const token = (await admin.credential.applicationDefault().getAccessToken()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const report = { checkedAt: new Date().toISOString(), phase, functions: {} };
  for (const name of ['createCheckoutSession', 'verifySession', 'stripeWebhook', 'adminChallengeProgression', 'fundedPrivacy']) {
    const response = await fetch(`https://cloudfunctions.googleapis.com/v2/projects/fynx-c7a28/locations/us-central1/functions/${name}`, { headers });
    if (!response.ok) throw Error(`Unable to inspect ${name}: ${response.status}`);
    const data = await response.json();
    report.functions[name] = { state: data.state, updatedAt: data.updateTime, runtime: data.buildConfig?.runtime, build: data.buildConfig?.build,
      source: data.buildConfig?.source?.storageSource, revision: data.serviceConfig?.revision, service: data.serviceConfig?.service,
      secrets: (data.serviceConfig?.secretEnvironmentVariables ?? []).map(value => ({ name: value.key, version: value.version })) };
  }
  const output = path.resolve(__dirname, `../docs/launch-2026-10-11/functions-${phase}.json`);
  if (phase === 'before' && fs.existsSync(output)) throw Error('Preserve the existing baseline.');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase, states: Object.fromEntries(Object.entries(report.functions).map(([key, value]) => [key, value.state])) }));
}
main().catch(error => { console.error(error.message?.startsWith('Unable') || error.message?.startsWith('Preserve') ? error.message : 'Deployment inspection failed; no credentials logged.'); process.exitCode = 1; });

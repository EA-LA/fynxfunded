#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
async function main() {
  const identities = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'fynx-funded-web-qa-20261011/identities.json'), 'utf8'));
  const config = fs.readFileSync(path.join(__dirname, '../src/lib/firebase.ts'), 'utf8');
  const apiKey = config.match(/VITE_FIREBASE_API_KEY\s*\|\|\s*"([^"]+)"/)[1];
  const report = { checkedAt: new Date().toISOString(), environment: 'production services, disposable QA identities; email verification preset', checks: [], complete: false };
  const check = (name, passed) => { report.checks.push({ name, passed: !!passed }); if (!passed) throw Error('Check failed: ' + name); };
  const credentials = [];
  for (const identity of identities) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identity.email, password: identity.password, returnSecureToken: true }) });
    const data = await response.json(); check('Disposable QA password authentication', response.ok && data.localId === identity.uid); credentials.push(data.idToken);
  }
  const rest = async (uid, token) => fetch(`https://firestore.googleapis.com/v1/projects/fynx-c7a28/databases/(default)/documents/orders/${uid}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  check('Owner can read their failed-order fixture', (await rest(identities[0].uid, credentials[0])).status === 200);
  check('Another customer cannot read that order', (await rest(identities[0].uid, credentials[1])).status === 403);
  check('Anonymous client cannot read that order', [401, 403].includes((await rest(identities[0].uid)).status));
  const call = async (name, data, token, callable = true) => {
    const response = await fetch(`https://us-central1-fynx-c7a28.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(callable ? { data } : data) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  check('Privacy export rejects anonymous calls', (await call('fundedPrivacy', { action: 'export' })).body.error?.status === 'UNAUTHENTICATED');
  const exported = (await call('fundedPrivacy', { action: 'export', uid: identities[1].uid }, credentials[0])).body.result;
  check('Export ignores a supplied foreign UID and contains the owned order', exported?.uid === identities[0].uid && exported.documents.some(row => row.path === `orders/${identities[0].uid}`));
  const json = JSON.stringify(exported);
  check('Export excludes the other customer and QA credentials', !json.includes(identities[1].uid) && identities.every(i => !json.includes(i.password)) && credentials.every(token => !json.includes(token)));
  report.export = { documents: exported.documents.length, sha256: crypto.createHash('sha256').update(json).digest('hex') };
  const first = (await call('fundedPrivacy', { action: 'request_deletion', confirmScope: 'FYNX Funded only' }, credentials[0])).body.result;
  const second = (await call('fundedPrivacy', { action: 'request_deletion', confirmScope: 'FYNX Funded only' }, credentials[0])).body.result;
  check('Deletion request is pending and retry-safe', first?.status === 'pending_review' && first.requestedAt === second?.requestedAt);
  check('Non-owner cannot control progression', (await call('adminChallengeProgression', { action: 'pass', challengeId: 'qa-nonexistent' }, credentials[0])).body.error?.status === 'PERMISSION_DENIED');
  check('Web checkout remains paused', (await call('createCheckoutSession', {}, credentials[0], false)).body.code === 'PAYMENTS_PAUSED');
  check('Payment verification rejects anonymous callers', (await call('verifySession', { sessionId: 'cs_test_qa' }, undefined, false)).status === 401);
  const webhook = await fetch('https://us-central1-fynx-c7a28.cloudfunctions.net/stripeWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'invalid-qa-signature' }, body: '{}' });
  check('Webhook rejects an invalid signature without fulfillment', webhook.status === 400);
  report.complete = true;
  const output = path.resolve(__dirname, '../docs/launch-2026-10-11/live-web-services.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message?.startsWith('Check failed:') ? error.message : 'QA verification failed; no credentials logged.'); process.exitCode = 1; });

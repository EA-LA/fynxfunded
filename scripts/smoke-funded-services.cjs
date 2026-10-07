#!/usr/bin/env node
// Authorized production smoke on a disposable QA identity; no emails, charges, broker imports or customer edits.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const admin = require('../functions/node_modules/firebase-admin');
const project = 'fynx-c7a28';
async function main() {
  if (!process.argv.includes('--run-production')) throw Error('Explicit --run-production required.');
  const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
  const publicConfig = fs.readFileSync(path.join(__dirname, '../src/lib/firebase.ts'), 'utf8');
  const apiKey = env.match(/^VITE_FIREBASE_API_KEY=["']?([^\s"']+)/m)?.[1] || publicConfig.match(/VITE_FIREBASE_API_KEY\s*\|\|\s*"([^"]+)"/)?.[1];
  if (!apiKey) throw Error('Firebase public configuration missing.');
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();
  const uid = 'funded-launch-qa-' + crypto.randomBytes(10).toString('hex');
  const password = crypto.randomBytes(24).toString('base64url');
  const email = uid + '@example.invalid';
  const report = { checkedAt: new Date().toISOString(), project, identity: 'disposable QA; email verification preset by test administrator', checks: [], cleanup: false, complete: false };
  const check = (name, condition) => { report.checks.push({ name, passed: !!condition }); if (!condition) throw Error('Check failed: ' + name); };
  let created = false;
  try {
    await admin.auth().createUser({ uid, email, password, emailVerified: true }); created = true;
    await db.doc(`users/${uid}`).set({ email, displayName: 'Funded release QA', country: 'US', twoFactorEnabled: false, qaRun: uid });
    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    const auth = await authResponse.json(); check('Firebase password authentication', authResponse.ok && auth.localId === uid && !!auth.idToken);
    async function call(name, data, authenticated = true) {
      const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${auth.idToken}` } : {}) }, body: JSON.stringify({ data }) });
      let value; try { value = await response.json(); } catch { throw Error(`${name}: HTTP ${response.status}`); }
      return { httpStatus: response.status, ...value };
    }
    check('Privacy denies anonymous calls', (await call('fundedPrivacy', { action: 'export' }, false)).error?.status === 'UNAUTHENTICATED');
    const catalog = await call('fundedMobileCheckout', { action: 'catalog' });
    check('Native catalog serves 18 plans with purchases paused', catalog.result?.available === false && catalog.result.plans?.length === 18);
    check('Native purchase creation remains blocked', (await call('fundedMobileCheckout', { action: 'create' })).error?.status === 'FAILED_PRECONDITION');
    const documents = await call('fundedWorkspace', { action: 'documents' });
    check('Native owned documents loads without fabricated contracts', Array.isArray(documents.result?.items) && documents.result.items.length === 0);
    const profile = await call('fundedCustomerAction', { action: 'profile', displayName: 'Funded QA verified', nickname: '', country: 'US' });
    check('Native profile persists on the authenticated account', profile.result?.saved === true && (await db.doc(`users/${uid}`).get()).data().displayName === 'Funded QA verified');
    const exported = await call('fundedPrivacy', { action: 'export', uid: 'ignored-other-user' });
    check('Operational export is server scoped and contains the QA profile', exported.result?.uid === uid && exported.result.documents?.some(row => row.path === `users/${uid}`));
    const serialized = JSON.stringify(exported.result);
    check('Export excludes passwords and authentication tokens', !serialized.includes(password) && !serialized.includes(auth.idToken));
    report.export = { documents: exported.result.documents.length, sha256: crypto.createHash('sha256').update(serialized).digest('hex'), syntheticAccount: true };
    const privacy = await call('fundedPrivacy', { action: 'request_deletion', confirmScope: 'FYNX Funded only' });
    const repeat = await call('fundedPrivacy', { action: 'request_deletion', confirmScope: 'FYNX Funded only' });
    check('Deletion request is pending review and retry-safe', privacy.result?.status === 'pending_review' && repeat.result?.requestedAt === privacy.result.requestedAt);
    check('Privacy status returns the recorded request', (await call('fundedPrivacy', { action: 'status' })).result?.status === 'pending_review');
    check('Non-owner cannot use progression controls', (await call('adminChallengeProgression', { action: 'pass', challengeId: 'not-a-customer' })).error?.status === 'PERMISSION_DENIED');
    check('MFA remains closed pending coordinated activation', (await call('fundedMfa', { action: 'status' })).error?.status === 'FAILED_PRECONDITION');
    report.complete = true;
  } finally {
    if (created) {
      const audits = await db.collection('audit_logs').where('userId', '==', uid).get();
      const batch = db.batch(); audits.docs.forEach(row => batch.delete(row.ref));
      batch.delete(db.doc(`funded_privacy_requests/${uid}`)); batch.delete(db.doc(`users/${uid}`));
      await batch.commit(); await admin.auth().deleteUser(uid); report.cleanup = true;
    }
    fs.writeFileSync(path.join(__dirname, '../docs/launch-2026-10-07/live-service-checks.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error.message?.startsWith('Check failed:') ? error.message : 'Smoke failed; no credentials logged. Inspect sanitized evidence.'); process.exitCode = 1; });

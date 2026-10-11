#!/usr/bin/env node
// Disposable website QA only. No mail, charges, customer records or broker provisioning.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const admin = require('../functions/node_modules/firebase-admin');
const directory = path.join(os.tmpdir(), 'fynx-funded-web-qa-20261011');
const file = path.join(directory, 'identities.json');
async function main() {
  const action = process.argv[2];
  if (action === 'prepare-login') {
    const index = Number(process.argv[3] ?? 0); if (![0, 1].includes(index)) throw Error('Invalid QA index');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))[index];
    const code = `async page => { await page.getByRole('textbox', {name:'trader@example.com'}).fill(${JSON.stringify(data.email)}); await page.getByRole('textbox', {name:'••••••••'}).fill(${JSON.stringify(data.password)}); await page.getByRole('button', {name:'Log In', exact:true}).click(); await page.waitForURL('**/dashboard', {timeout:30000}); return {signedIn:true, url:page.url()}; }`;
    fs.writeFileSync(path.join(directory, 'login.js'), code, { mode: 0o600 }); console.log('Prepared private QA login script.'); return;
  }
  admin.initializeApp({ projectId: 'fynx-c7a28' }); const db = admin.firestore();
  if (action === 'create') {
    if (fs.existsSync(file)) throw Error('Existing QA state must be cleaned up or reused.');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const identities = [];
    try {
      for (const label of ['A', 'B']) {
        const uid = 'funded-web-qa-' + crypto.randomBytes(12).toString('hex');
        const email = `${uid}@example.invalid`, password = crypto.randomBytes(30).toString('base64url');
        await admin.auth().createUser({ uid, email, password, emailVerified: true, displayName: `Website QA ${label}` });
        identities.push({ uid, email, password, label }); fs.writeFileSync(file, JSON.stringify(identities), { mode: 0o600 });
        await db.doc(`users/${uid}`).set({ email, displayName: `Website QA ${label}`, country: 'US', twoFactorEnabled: false, loginAlertsEnabled: false, qaRun: uid });
        await db.doc(`users/${uid}/security/settings`).set({ twoFactorEnabled: false, loginAlertsEnabled: false });
        await db.doc(`orders/${uid}`).set({ userId: uid, qaRun: uid, status: 'failed', challenge: `Synthetic website QA ${label}`, amount: 79, currency: 'USD', createdAt: new Date().toISOString() });
      }
      console.log('Created two disposable verified QA identities and failed-order fixtures; no payments or email.');
    } catch { throw Error('QA creation incomplete. Run cleanup; no credentials logged.'); }
    return;
  }
  if (action === 'seed-history') {
    const identities = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const account of identities) {
      const profile = (await db.doc(`users/${account.uid}`).get()).data();
      if (profile?.qaRun !== account.uid) throw Error('QA ownership mismatch.');
      await db.doc(`challenges/${account.uid}`).set({ userId: account.uid, qaRun: account.uid, name: 'Synthetic website history QA', status: 'active', accountSize: 10000, phase: '2-phase', currentPhase: 1, currency: 'USD', style: 'normal', startDate: new Date().toISOString() });
    }
    console.log('Seeded owned empty-history QA challenges; no broker data or outcome notifications.'); return;
  }
  if (action === 'cleanup') {
    if (!fs.existsSync(file)) { console.log('No QA state to clean.'); return; }
    const identities = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const account of identities) {
      if (!/^funded-web-qa-[a-f0-9]{24}$/.test(account.uid) || account.email !== `${account.uid}@example.invalid`) throw Error('Cleanup scope mismatch.');
      const profile = await db.doc(`users/${account.uid}`).get();
      if (profile.exists && profile.data().qaRun !== account.uid) throw Error('QA ownership changed; stop cleanup.');
      for (const name of ['orders', 'audit_logs', 'tickets', 'challenges']) {
        const rows = await db.collection(name).where('userId', '==', account.uid).get();
        for (const row of rows.docs) await db.recursiveDelete(row.ref);
      }
      await db.doc(`funded_privacy_requests/${account.uid}`).delete(); await db.recursiveDelete(db.doc(`users/${account.uid}`));
      await admin.auth().deleteUser(account.uid);
    }
    fs.rmSync(directory, { recursive: true, force: true }); console.log('Removed both QA identities, their fixtures, sessions, privacy requests and private local credentials.'); return;
  }
  throw Error('Use create, prepare-login [0|1], or cleanup.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

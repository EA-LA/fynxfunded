#!/usr/bin/env node
// Synthetic Firestore-emulator rehearsal; this command cannot target production.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const admin = require('../functions/node_modules/firebase-admin');
const { executeDeletion, suppressRestoredDeletions, planHash } = require('../functions/lib/fundedRetention');
async function main() {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw Error('A local Firestore emulator is required.');
  const project = 'demo-funded-retention';
  admin.initializeApp({ projectId: project });
  const db = admin.firestore(); const restoredDb = require('node:module').createRequire(path.join(__dirname, '../functions/package.json'))('firebase-admin/firestore').getFirestore('funded-restore-qa'); const uid = 'synthetic-retention-qa';
  const ledgerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'funded-independent-ledger-'));
  const report = { checkedAt: new Date().toISOString(), environment: 'local Firestore emulator; synthetic records only', checks: [], productionRestore: false };
  const check = (name, passed) => { report.checks.push({ name, passed: !!passed }); if (!passed) throw Error(name); };
  try {
    const deletedPath = 'tickets/retention-qa', retainedPath = 'orders/retention-qa', sharedPath = `users/${uid}`;
    await db.doc(deletedPath).set({ userId: uid, status: 'closed', message: 'Synthetic ticket' });
    await db.doc(retainedPath).set({ userId: uid, status: 'paid', amount: 79 });
    await db.doc(sharedPath).set({ displayName: 'Shared identity fixture' });
    await db.doc(`funded_privacy_requests/${uid}`).set({ userId: uid, status: 'pending_review', scope: 'FYNX Funded only' });
    const plan = { schemaVersion: 1, uid, requestPath: `funded_privacy_requests/${uid}`, scope: 'FYNX Funded only', policyReference: 'synthetic-rehearsal-only', reviewedBy: 'automated-test-fixture', reviewedAt: new Date().toISOString(), records: [] };
    for (const [recordPath, action] of [[deletedPath, 'delete'], [retainedPath, 'retain']]) {
      const snapshot = await db.doc(recordPath).get();
      plan.records.push({ path: recordPath, updateTime: `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`, action, reason: 'Synthetic approved retention decision; not a production policy' });
    }
    const hash = planHash(plan);
    const ledger = { create: async (name, value) => { const fd = fs.openSync(path.join(ledgerDirectory, name), 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } };
    await executeDeletion(db, ledger, plan, hash);
    check('Approved synthetic ticket deleted', !(await db.doc(deletedPath).get()).exists);
    check('Retained billing record and shared profile preserved', (await db.doc(retainedPath).get()).exists && (await db.doc(sharedPath).get()).exists);
    check('Request records completion and exact plan hash', (await db.doc(plan.requestPath).get()).data()?.deletionPlanHash === hash);
    const prepared = JSON.parse(fs.readFileSync(path.join(ledgerDirectory, `${hash}.prepared`)));
    const completed = JSON.parse(fs.readFileSync(path.join(ledgerDirectory, `${hash}.completed`)));
    // Simulate a backup containing the deleted record. The independent ledger remains current.
    await restoredDb.doc(deletedPath).set({ userId: uid, status: 'closed', message: 'Resurrected backup fixture' });
    await restoredDb.doc(retainedPath).set({ userId: uid, status: 'paid', amount: 79 });
    let blocked = false;
    try { await suppressRestoredDeletions(restoredDb, [{ prepared }], { isolated: true, databaseId: 'funded-restore-qa' }); } catch { blocked = true; }
    check('Missing completion ledger blocks restoration', blocked && (await restoredDb.doc(deletedPath).get()).exists);
    const restored = await suppressRestoredDeletions(restoredDb, [{ prepared, completed }], { isolated: true, databaseId: 'funded-restore-qa' });
    check('Restored deleted record suppressed before release', restored.suppressed === 1 && !(await restoredDb.doc(deletedPath).get()).exists);
    check('Restoration does not remove retained records or approve launch', (await restoredDb.doc(retainedPath).get()).exists && restored.releaseApproved === false);
    report.complete = true;
  } finally {
    for (const p of ['tickets/retention-qa', 'orders/retention-qa', `users/${uid}`, `funded_privacy_requests/${uid}`]) await db.doc(p).delete();
    for (const p of ['tickets/retention-qa', 'orders/retention-qa']) await restoredDb.doc(p).delete();
    fs.rmSync(ledgerDirectory, { recursive: true, force: true });
    report.cleanup = true;
    const output = path.resolve(__dirname, '../docs/launch-2026-10-11/retention-rehearsal.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

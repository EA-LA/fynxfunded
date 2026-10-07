#!/usr/bin/env node
// Read-only operational inventory. Reports counts and configuration, never credentials or customer records.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');
const project = 'fynx-c7a28';
async function main() {
  const credential = admin.credential.applicationDefault();
  admin.initializeApp({ projectId: project, credential });
  const token = (await credential.getAccessToken()).access_token;
  const report = { checkedAt: new Date().toISOString(), project, mode: 'read-only', checks: {} };
  const read = async (name, url, summarize) => {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      report.checks[name] = response.ok ? { status: 'read', value: summarize(data) } : { status: 'unverified', httpStatus: response.status, code: data.error?.status };
    } catch { report.checks[name] = { status: 'unverified', reason: 'request_failed' }; }
  };
  await read('database', `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`, d => ({ locationId: d.locationId, pointInTimeRecoveryEnablement: d.pointInTimeRecoveryEnablement, earliestVersionTime: d.earliestVersionTime, deleteProtectionState: d.deleteProtectionState }));
  await read('backupSchedules', `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/backupSchedules`, d => (d.backupSchedules ?? []).map(x => ({ name: x.name, retention: x.retention, dailyRecurrence: x.dailyRecurrence, weeklyRecurrence: x.weeklyRecurrence })));
  await read('backups', `https://firestore.googleapis.com/v1/projects/${project}/locations/-/backups`, d => (d.backups ?? []).map(x => ({ name: x.name, state: x.state, snapshotTime: x.snapshotTime, expireTime: x.expireTime })));
  await read('alertPolicies', `https://monitoring.googleapis.com/v3/projects/${project}/alertPolicies`, d => (d.alertPolicies ?? []).map(x => ({ displayName: x.displayName, enabled: x.enabled, notificationChannelCount: x.notificationChannels?.length ?? 0 })));
  await read('notificationChannels', `https://monitoring.googleapis.com/v3/projects/${project}/notificationChannels`, d => (d.notificationChannels ?? []).map(x => ({ displayName: x.displayName, type: x.type, enabled: x.enabled, verificationStatus: x.verificationStatus })));
  const db = admin.firestore();
  for (const name of ['challenges', 'accounts', 'trades', 'rule_events', 'contracts', 'funded_memberships']) {
    try { report.checks[name] = { status: 'read', count: (await db.collection(name).count().get()).data().count }; }
    catch { report.checks[name] = { status: 'unverified' }; }
  }
  for (const name of ['funded_mfa_rollout/current', 'funded_release/current']) {
    try { const snap = await db.doc(name).get(); report.checks[name] = { status: 'read', exists: snap.exists, ready: snap.data()?.ready === true, progressionApproved: snap.data()?.progressionApproved === true }; }
    catch { report.checks[name] = { status: 'unverified' }; }
  }
  report.limitations = ['Alert configuration does not prove alert delivery.', 'Backup presence does not prove restoration.', 'Counts do not establish complete broker equity coverage.'];
  const output = path.resolve(__dirname, '../docs/launch-2026-10-07/operations.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Operational audit failed; verify local Google authentication. No secrets logged.'); process.exitCode = 1; });

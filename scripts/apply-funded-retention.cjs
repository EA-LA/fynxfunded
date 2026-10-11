#!/usr/bin/env node
// Operator-only exact-plan executor. Default is validation, without cloud writes.
const fs = require('node:fs');
const admin = require('../functions/node_modules/firebase-admin');
const { validatePlan, planHash, executeDeletion } = require('../functions/lib/fundedRetention');
async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes('--plan')) throw Error('Use --plan /absolute/reviewed-plan.json. Default: dry run.');
  const plan = JSON.parse(fs.readFileSync(value('--plan'), 'utf8')); validatePlan(plan);
  const hash = planHash(plan);
  if (!args.includes('--execute')) { console.log(JSON.stringify({ mode: 'validation only; no cloud writes', hash, delete: plan.records.filter(r => r.action === 'delete').length, retain: plan.records.filter(r => r.action === 'retain').length })); return; }
  if (!args.includes('--approved-hash') || value('--approved-hash') !== hash || !args.includes('--ledger-bucket')) throw Error('Execution requires the exact reviewed --approved-hash and an independent --ledger-bucket.');
  admin.initializeApp({ projectId: 'fynx-c7a28' });
  const bucket = admin.storage().bucket(value('--ledger-bucket'));
  const [metadata] = await bucket.getMetadata();
  const [iam] = await bucket.iam.getPolicy({ requestedPolicyVersion: 3 });
  if (!metadata.versioning?.enabled || !metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled || iam.bindings?.some(binding => binding.members?.some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member)))) throw Error('The independent ledger bucket needs versioning, uniform access and restricted IAM.');
  const ledger = { create: async (name, value) => bucket.file(`funded-deletions/${name}.json`).save(JSON.stringify(value), { resumable: false, contentType: 'application/json', preconditionOpts: { ifGenerationMatch: 0 } }) };
  const result = await executeDeletion(admin.firestore(), ledger, plan, hash);
  console.log(JSON.stringify({ completed: true, hash, deleted: result.deleted, retained: result.retained }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

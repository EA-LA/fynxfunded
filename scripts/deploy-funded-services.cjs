#!/usr/bin/env node
// Selected Funded services only. Does not deploy Firestore rules, website, MFA activation or payment activation.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const exportsByModule = {
  nativeCustomer: ['fundedCustomerAction'], fundedWorkspace: ['fundedWorkspace'],
  fundedLeaderboard: ['refreshFundedLeaderboard'], fundedMfa: ['fundedMfa'],
  nativeCheckout: ['fundedMobileCheckout'], kyc: ['fundedMobileIdentity'],
  fundedPrivacy: ['fundedPrivacy'],
  challengeProgression: ['adminChallengeProgression', 'evaluateAutomaticProgressionOnTrade'],
};
const names = Object.values(exportsByModule).flat();
if (!fs.readFileSync(path.join(root, 'functions/src/stripe/paymentAvailability.ts'), 'utf8').includes('return true;')) throw Error('Payment hold must remain enabled.');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fynx-funded-services-'));
fs.cpSync(path.join(root, 'functions/src'), path.join(stage, 'functions/src'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'functions', name), path.join(stage, 'functions', name));
fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), 'import * as admin from "firebase-admin";\nadmin.initializeApp();\n' + Object.entries(exportsByModule).map(([module, names]) => `export { ${names.join(', ')} } from "./${module}";`).join('\n') + '\n');
fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] } }));
// Explicit disabled value is not a Stripe key and cannot satisfy the checkout gate.
fs.writeFileSync(path.join(stage, 'functions/.env.fynx-c7a28'), 'STRIPE_PUBLISHABLE_KEY=unconfigured\n');
const hashes = {};
function hashFiles(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) hashFiles(file); else hashes[path.relative(path.join(stage, 'functions/src'), file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } }
hashFiles(path.join(stage, 'functions/src'));
const evidence = { preparedAt: new Date().toISOString(), project: 'fynx-c7a28', names, paymentHold: true, mfaActivated: false, sourceHashes: hashes, deployed: false };
const output = path.join(root, 'docs/launch-2026-10-07/services-deployment.json');
try {
  execFileSync('npm', ['run', 'build'], { cwd: path.join(stage, 'functions'), stdio: 'inherit' });
  if (process.argv.includes('--deploy')) {
    execFileSync('firebase', ['deploy', '--only', names.map(name => 'functions:' + name).join(','), '--project', 'fynx-c7a28', '--non-interactive'], { cwd: stage, stdio: 'inherit' });
    evidence.deployed = true; evidence.completedAt = new Date().toISOString();
  }
} finally {
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  fs.rmSync(stage, { recursive: true, force: true });
}

#!/usr/bin/env node
// Deploy only shared order status, secure trading access, safe notifications and updated export.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const names = process.argv.includes('--operations-only') ? ['fundedOperations', 'reconcileFundedOrders'] : process.argv.includes('--access-only') ? ['fundedTradingAccess', 'sendBrokerCredentialsEmail', 'reconcileFundedOrders'] : process.argv.includes('--reconcile-only') ? ['reconcileFundedOrders'] : process.argv.includes('--mail-only') ? ['sendBrokerCredentialsEmail'] : ['fundedOrderStatus', 'fundedTradingAccess', 'sendBrokerCredentialsEmail', 'stripeWebhook', 'fundedPrivacy'];
if (!fs.readFileSync(path.join(root, 'functions/src/stripe/paymentAvailability.ts'), 'utf8').includes('return true;')) throw Error('Purchases must remain paused for this engineering release.');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'funded-web-deploy-'));
const report = { preparedAt: new Date().toISOString(), names, project: 'fynx-c7a28', deployed: false, paymentHold: true, firestoreRulesDeployed: false, mfaActivated: false, sourceHashes: {} };
try {
  fs.cpSync(path.join(root, 'functions/src'), path.join(stage, 'functions/src'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'functions', name), path.join(stage, 'functions', name));
  fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
  fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), 'import * as admin from "firebase-admin";\nadmin.initializeApp();\nexport { fundedOrderStatus } from "./fundedOrderStatus";\nexport { fundedTradingAccess } from "./fundedTradingAccess";\nexport { sendBrokerCredentialsEmail } from "./credentialDelivery";\nexport { stripeWebhook } from "./stripe/webhook";\nexport { fundedPrivacy } from "./fundedPrivacy";\nexport { reconcileFundedOrders } from "./fundedReconciliation";\nexport { fundedOperations } from "./fundedOperations";\n');
  fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] } }));
  fs.writeFileSync(path.join(stage, 'functions/.env.fynx-c7a28'), 'FYNX_FUNDED_PURCHASES_APPROVED=false\n');
  const hashFiles = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) hashFiles(file); else report.sourceHashes[path.relative(path.join(stage, 'functions/src'), file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } };
  hashFiles(path.join(stage, 'functions/src'));
  execFileSync('npm', ['run', 'build'], { cwd: path.join(stage, 'functions'), stdio: 'inherit' });
  if (process.argv.includes('--deploy')) {
    execFileSync('firebase', ['deploy', '--only', names.map(name => `functions:${name}`).join(','), '--project', 'fynx-c7a28', '--non-interactive'], { cwd: stage, stdio: 'inherit', env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '120' } });
    report.deployed = true; report.completedAt = new Date().toISOString();
  }
} finally {
  const output = process.argv.includes('--operations-only') ? path.join(root, 'docs/launch-2026-10-17/operations-deployment.json') : path.join(root, 'docs/launch-2026-10-14/' + (process.argv.includes('--access-only') ? 'access-deployment.json' : process.argv.includes('--reconcile-only') ? 'reconciliation-deployment.json' : process.argv.includes('--mail-only') ? 'mail-deployment.json' : 'backend-deployment.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(stage, { recursive: true, force: true });
}

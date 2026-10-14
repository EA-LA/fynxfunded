#!/usr/bin/env node
// Deploy only the listed additive services. Does not activate push, MFA, purchases or progression.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const modules = { fundedMfa: ['fundedMfa'], nativeCheckout: ['fundedMobileCheckout'], 'stripe/webhook': ['stripeWebhook'], fundedAccountInsights: ['fundedAccountInsights'], fundedNotifications: ['fundedNotifications', 'fundedAccountUpdated', 'fundedChallengeUpdated', 'fundedPayoutUpdated'], fundedPrivacy: ['fundedPrivacy'] };
if (process.argv.includes('--insights-only')) { for (const key of Object.keys(modules)) if (key !== 'fundedAccountInsights') delete modules[key]; }
if (process.argv.includes('--mfa-only')) { for (const key of Object.keys(modules)) if (key !== 'fundedMfa') delete modules[key]; }
const names = Object.values(modules).flat(), stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fynx-ios-services-'));
const output = path.join(root, 'docs/ios-completion-2026-10-12'); fs.mkdirSync(output, { recursive: true });
const evidence = { preparedAt: new Date().toISOString(), project: 'fynx-c7a28', names, pushActivated: false, mfaActivated: false, paymentsActivated: false, deployed: false, sourceHashes: {} };
try {
  fs.cpSync(path.join(root, 'functions/src'), path.join(stage, 'functions/src'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'functions', name), path.join(stage, 'functions', name));
  fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
  fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), 'import * as admin from "firebase-admin";\nadmin.initializeApp();\n' + Object.entries(modules).map(([file, names]) => `export { ${names.join(', ')} } from "./${file}";`).join('\n'));
  fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] } }));
  fs.writeFileSync(path.join(stage, 'functions/.env.fynx-c7a28'), 'STRIPE_PUBLISHABLE_KEY=unconfigured\nFYNX_FUNDED_PURCHASES_APPROVED=false\n');
  function hashFiles(dir) { for (const item of fs.readdirSync(dir, {withFileTypes:true})) { const file=path.join(dir,item.name);if(item.isDirectory())hashFiles(file);else evidence.sourceHashes[path.relative(path.join(stage,'functions/src'),file)]=createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } }
  hashFiles(path.join(stage,'functions/src'));
  execFileSync('npm', ['run', 'build'], { cwd: path.join(stage, 'functions'), stdio: 'inherit' });
  if (process.argv.includes('--deploy')) {
    execFileSync('firebase', ['deploy', '--only', names.map(n => 'functions:' + n).join(','), '--project', 'fynx-c7a28', '--non-interactive'], { cwd: stage, stdio: 'inherit', env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: '120' } });
    evidence.deployed = true; evidence.completedAt = new Date().toISOString();
  }
} finally { fs.writeFileSync(path.join(output, process.argv.includes('--mfa-only') ? 'mfa-deployment.json' : process.argv.includes('--insights-only') ? 'insights-deployment.json' : 'deployment.json'), JSON.stringify(evidence, null, 2) + '\n'); fs.rmSync(stage, { recursive: true, force: true }); }

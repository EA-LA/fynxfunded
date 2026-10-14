#!/usr/bin/env node
// Deploy only the listed additive services. Does not activate push, MFA, purchases or progression.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const modules = { fundedAccountInsights: ['fundedAccountInsights'], fundedNotifications: ['fundedNotifications', 'fundedAccountUpdated', 'fundedChallengeUpdated', 'fundedPayoutUpdated'], fundedPrivacy: ['fundedPrivacy'] };
const names = Object.values(modules).flat(), stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fynx-ios-services-'));
const output = path.join(root, 'docs/ios-completion-2026-10-11'); fs.mkdirSync(output, { recursive: true });
const evidence = { preparedAt: new Date().toISOString(), project: 'fynx-c7a28', names, pushActivated: false, mfaActivated: false, paymentsActivated: false, deployed: false, sourceHashes: {} };
try {
  fs.cpSync(path.join(root, 'functions/src'), path.join(stage, 'functions/src'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'functions', name), path.join(stage, 'functions', name));
  fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
  fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), 'import * as admin from "firebase-admin";\nadmin.initializeApp();\n' + Object.entries(modules).map(([file, names]) => `export { ${names.join(', ')} } from "./${file}";`).join('\n'));
  fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] } }));
  for (const file of fs.readdirSync(path.join(stage, 'functions/src'))) if (file.endsWith('.ts')) evidence.sourceHashes[file] = createHash('sha256').update(fs.readFileSync(path.join(stage, 'functions/src', file))).digest('hex');
  execFileSync('npm', ['run', 'build'], { cwd: path.join(stage, 'functions'), stdio: 'inherit' });
  if (process.argv.includes('--deploy')) {
    execFileSync('firebase', ['deploy', '--only', names.map(n => 'functions:' + n).join(','), '--project', 'fynx-c7a28', '--non-interactive'], { cwd: stage, stdio: 'inherit' });
    evidence.deployed = true; evidence.completedAt = new Date().toISOString();
  }
} finally { fs.writeFileSync(path.join(output, 'deployment.json'), JSON.stringify(evidence, null, 2) + '\n'); fs.rmSync(stage, { recursive: true, force: true }); }

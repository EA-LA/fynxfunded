#!/usr/bin/env node
// Review with no flags. --deploy updates only fundedMfa and the canonical OAuth hostname.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  const admin = require('../functions/node_modules/firebase-admin');
  const token = (await admin.credential.applicationDefault().getAccessToken()).access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = 'https://identitytoolkit.googleapis.com/admin/v2/projects/fynx-c7a28/config';
  const response = await fetch(url, { headers });
  if (!response.ok) throw Error('Cannot inspect authorized domains.');
  const config = await response.json();
  const domains = Array.from(new Set([...(config.authorizedDomains || []), 'www.fynxfunded.com']));
  console.log(JSON.stringify({ function: 'fundedMfa', addAuthorizedDomain: !config.authorizedDomains.includes('www.fynxfunded.com'), financialRecordsChanged: false, mfaEnrollmentActivated: false, deploy: process.argv.includes('--deploy') }));
  if (!process.argv.includes('--deploy')) return;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fynx-auth-repair-'));
  try {
    fs.cpSync(path.join(root, 'functions/src'), path.join(stage, 'functions/src'), { recursive: true });
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'functions', name), path.join(stage, 'functions', name));
    fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
    fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), 'import * as admin from "firebase-admin";\nadmin.initializeApp();\nexport { fundedMfa } from "./fundedMfa";\n');
    fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] } }));
    execFileSync('firebase', ['deploy', '--only', 'functions:fundedMfa', '--project', 'fynx-c7a28', '--non-interactive'], { cwd: stage, stdio: 'inherit' });
    if (!config.authorizedDomains.includes('www.fynxfunded.com')) {
      const update = await fetch(url + '?updateMask=authorizedDomains', { method: 'PATCH', headers, body: JSON.stringify({ authorizedDomains: domains }) });
      if (!update.ok) throw Error('Function deployed, but OAuth domain update needs retry.');
    }
    console.log('Authentication service and canonical OAuth hostname updated. Website release is separate.');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

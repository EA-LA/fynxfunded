#!/usr/bin/env node
// Default: inspect and build only. --deploy releases exactly the account MFA callable.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const oauth = require('/Users/h/.npm-global/lib/node_modules/firebase-tools/lib/auth');

const root = path.resolve(__dirname, '..');
const evidence = path.resolve(root, '../evidence');
const project = 'fynx-c7a28';
const target = 'fundedMfa';
const files = ['fundedMfa.ts', 'mfaPolicy.ts', 'privateFundedOwner.ts', 'privateFundedPolicy.ts'];
const generatedIndex = 'import * as admin from "firebase-admin";\nadmin.initializeApp();\nexport { fundedMfa } from "./fundedMfa";\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const reserved = new Set(['FIREBASE_CONFIG', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'EVENTARC_CLOUD_EVENT_SOURCE', 'FUNCTION_TARGET', 'FUNCTION_SIGNATURE_TYPE', 'LOG_EXECUTION_ID']);
const variables = current => Object.fromEntries(Object.entries(current?.serviceConfig?.environmentVariables || {}).filter(([key]) => !reserved.has(key)).sort(([a], [b]) => a.localeCompare(b)));
const summary = current => ({
  state: current.state,
  revision: current.serviceConfig?.revision,
  updateTime: current.updateTime,
  runtime: current.buildConfig?.runtime,
  source: current.buildConfig?.source?.storageSource,
  environmentKeys: Object.keys(variables(current)),
});

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--deploy')) throw Error('Unsupported argument. Use no arguments for a dry run, or --deploy.');
  const deploy = args.includes('--deploy');
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const source = fs.readFileSync(path.join(root, 'functions/src/fundedMfa.ts'), 'utf8');
  const boundary = source.slice(source.indexOf('export async function requireFundedMfa'), source.indexOf('async function assertRecent'));
  if (!boundary.includes('await requirePrivateFundedOwner(request);')) throw Error('Private Funded authorization must remain enforced.');
  if (source.slice(source.indexOf('export const fundedMfa')).includes('requirePrivateFundedOwner(request)')) throw Error('Account authentication still requires the private owner.');
  if (!fs.readFileSync(path.join(root, 'functions/src/stripe/paymentAvailability.ts'), 'utf8').includes('return true;')) throw Error('Public purchases must remain paused.');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'), 'utf8'));
  if (String(packageJson.engines?.node) !== '22') throw Error('Expected the existing Node 22 runtime.');

  const account = oauth.getGlobalDefaultAccount();
  if (!account) throw Error('Firebase CLI authentication is unavailable.');
  const access = await oauth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const headers = { Authorization: `Bearer ${access.access_token}` };
  const functionUrl = `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/us-central1/functions/${target}`;
  async function inspect() {
    const response = await fetch(functionUrl, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`Could not inspect the existing ${target} function (${response.status}).`);
    return response.json();
  }
  const before = await inspect();
  if (before.state !== 'ACTIVE') throw Error('Existing fundedMfa is not active; inspect it before release.');
  if (before.serviceConfig?.secretEnvironmentVariables?.length) throw Error('Existing secret bindings require explicit preservation; stopped before deployment.');
  const preserved = variables(before);
  const sourceHashes = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, 'functions/src', file)))]));
  sourceHashes['index.ts'] = hash(generatedIndex);
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) sourceHashes[file] = hash(fs.readFileSync(path.join(root, 'functions', file)));
  const report = {
    preparedAt: new Date().toISOString(), project, target,
    mode: deploy ? 'deploy' : 'dry-run', selectedFunctions: [target],
    sourceHashes, before: summary(before),
    publicPurchaseHold: true, privateFundedBoundaryPreserved: true,
    rulesChanged: false, configurationChanged: false, ownerClaimsChanged: false,
    built: false, deployed: false,
  };
  const output = path.join(evidence, deploy ? 'auth-repair-deployment.json' : 'auth-repair-deployment-plan.json');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fynx-auth-repair-'));
  fs.chmodSync(stage, 0o700);
  try {
    fs.mkdirSync(path.join(stage, 'functions/src'), { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(root, 'functions/src', file), path.join(stage, 'functions/src', file));
    for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'functions', file), path.join(stage, 'functions', file));
    fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
    fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), generatedIndex);
    fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] } }));
    fs.writeFileSync(path.join(stage, `functions/.env.${project}`), Object.entries(preserved).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
    execFileSync('npm', ['run', 'build'], { cwd: path.join(stage, 'functions'), stdio: 'inherit' });
    report.built = true;
    if (deploy) {
      execFileSync('firebase', ['deploy', '--only', `functions:${target}`, '--project', project, '--non-interactive'], {
        cwd: stage, stdio: 'inherit', env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: '120' },
      });
      const after = await inspect();
      report.after = summary(after);
      report.environmentPreserved = hash(JSON.stringify(variables(after))) === hash(JSON.stringify(preserved));
      report.deployed = after.state === 'ACTIVE' && after.serviceConfig?.revision !== before.serviceConfig?.revision;
      if (!report.deployed || !report.environmentPreserved) throw Error('Deployment finished but active revision/environment verification requires review.');
    }
    report.completedAt = new Date().toISOString();
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    fs.rmSync(stage, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ mode: report.mode, target, built: report.built, deployed: report.deployed, report: path.basename(output) }));
}
main().catch(error => {
  console.error(error.message?.startsWith('Command failed') ? 'Bounded authentication build/deployment failed; inspect the saved sanitized report.' : error.message);
  process.exitCode = 1;
});

// Creates a reviewable, isolated release. Never deploys or changes credentials.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.argv.length > 2) throw Error('Preparation only. This script does not accept deployment arguments.');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fynx-trade-email-release-'));
const names = ['fundedTradeAccess', 'sendTradeAccessEmail', 'retryTradeAccessEmails', 'tradeMailDeliveryWebhook'];
fs.mkdirSync(path.join(stage, 'functions/src/tradeAccess'), { recursive: true });
fs.cpSync(path.join(root, 'functions/src'), path.join(stage, 'functions/src'), { recursive: true });
// The engine cannot be included by an accidental release export.
fs.rmSync(path.join(stage, 'functions/src/tradeDev'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) {
  fs.copyFileSync(path.join(root, 'functions', name), path.join(stage, 'functions', name));
}
fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'functions/node_modules'), 'dir');
fs.writeFileSync(path.join(stage, 'functions/src/index.ts'), `import * as admin from 'firebase-admin';
admin.initializeApp();
export { fundedTradeAccess, sendTradeAccessEmail, retryTradeAccessEmails, tradeMailDeliveryWebhook } from './tradeAccess';
`);
fs.writeFileSync(path.join(stage, 'functions/.env.fynx-c7a28'), 'FYNX_TRADE_ACCESS_ENABLED=true\n');
fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions' } }, null, 2));
execFileSync('npm', ['run', 'build'], { cwd: path.join(stage, 'functions'), stdio: 'inherit' });
const report = {
  stage, project: 'fynx-c7a28', functions: names,
  requiredSecrets: ['MAILGUN_API_KEY', 'MAILGUN_WEBHOOK_SIGNING_KEY'],
  deployed: false, tradingEnabled: false, purchasesPaused: true,
  approvalsRequired: ['Owner release approval', 'Mailgun signing key and event webhook configuration'],
  deployCommandAfterApproval: `firebase deploy --project fynx-c7a28 --only ${names.map(n => `functions:${n}`).join(',')} --non-interactive`,
};
fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

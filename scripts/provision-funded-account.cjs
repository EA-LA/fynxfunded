// Operator-only bridge. Supply reviewed provider JSON through stdin; never command arguments or a tracked file.
const admin = require('../functions/node_modules/firebase-admin');
const { credentialKey } = require('./funded-credential-key.cjs');
const { provisionAccount } = require('../functions/lib/fundedProvisionAccount');
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Use --apply only with an independently confirmed provider account.');
  let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 20000) throw Error('Input too large.'); }
  const input = JSON.parse(raw); raw = '';
  const key = await credentialKey(); admin.initializeApp({projectId:'fynx-c7a28'});
  const result = await provisionAccount(admin.firestore(), input, key);
  console.log(JSON.stringify({saved:true, alreadyProvisioned:result.alreadyProvisioned}));
}
main().catch(() => { console.error('Account was not provisioned. Check the reviewed provider input, order ownership and operator access; no credentials were logged.'); process.exitCode=1; });

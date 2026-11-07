#!/usr/bin/env node
// Gives a second owner account (listed in functions/src/privateFundedPolicy.ts FUNDED_OWNER_EMAILS)
// private Funded dashboard access. Default: print the plan only. --run makes the two changes:
//   1. sets the fundedOwner custom claim on that Firebase Auth user (other claims are kept);
//   2. adds the user's UID to ownerUIDs in funded_private_access/current (ownerUID is kept).
// Needs the Firebase CLI to be signed in to project fynx-c7a28, and the functions that read
// privateFundedPolicy.ts (fundedPrivateAccess, fundedMfa and the private Funded callables) redeployed.
const crypto = require('node:crypto');
const path = require('node:path');
const project = 'fynx-c7a28';
const email = 'ha6876122@gmail.com';
const args = process.argv.slice(2);

async function main() {
  if (args.some(arg => arg !== '--run')) throw Error('Unsupported argument. Use no arguments for a dry run, or --run.');
  const run = args.includes('--run');
  if (!run) {
    console.log(JSON.stringify({ mode: 'dry-run', project, email, changesMade: false, steps: ['set fundedOwner claim', 'add UID to funded_private_access/current.ownerUIDs'] }));
    return;
  }
  const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
  const oauth = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/firebase-tools/lib/auth');
  const account = oauth.getGlobalDefaultAccount();
  if (!account) throw Error('Sign in with `firebase login` first.');
  const access = await oauth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const app = admin.initializeApp({ projectId: project, credential: { getAccessToken: async () => ({ access_token: access.access_token, expires_in: 3600 }) } }, 'grant-owner-' + crypto.randomBytes(4).toString('hex'));
  const user = await app.auth().getUserByEmail(email);
  if (!user.emailVerified || user.disabled) throw Error('The account must be verified and enabled.');
  if (!user.providerData.some(p => p.providerId === 'password')) throw Error('The account needs an email + password sign-in method (private access only accepts password sessions).');
  await app.auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), fundedOwner: true });
  const ref = app.firestore().doc('funded_private_access/current');
  await app.firestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() || {};
    if (current.enabled !== true || !current.ownerUID) throw Error('funded_private_access/current is not set up; leaving it unchanged.');
    const ownerUIDs = Array.from(new Set([...(Array.isArray(current.ownerUIDs) ? current.ownerUIDs : []), user.uid])).filter(uid => uid !== current.ownerUID);
    if (ownerUIDs.length > 5) throw Error('Too many private owners.');
    tx.update(ref, { ownerUIDs });
  });
  console.log(JSON.stringify({ mode: 'run', project, email, uid: user.uid, claimSet: true, uidPinned: true, next: 'Sign out and sign in again with email and password.' }));
  await app.delete();
}

main().catch(error => { console.error(error.message || String(error)); process.exit(1); });

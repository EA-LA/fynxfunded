// Key creation is explicit; secret bytes never leave memory or appear in output.
const admin = require('../functions/node_modules/firebase-admin');
async function credentialKey(create = false) {
  const token = (await admin.credential.applicationDefault().getAccessToken()).access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const root = 'https://secretmanager.googleapis.com/v1/projects/fynx-c7a28/secrets';
  let response = await fetch(`${root}/FUNDED_TRADING_CREDENTIAL_KEY/versions/latest:access`, { headers });
  if (response.status === 404 && create) {
    const made = await fetch(`${root}?secretId=FUNDED_TRADING_CREDENTIAL_KEY`, { method: 'POST', headers, body: JSON.stringify({replication:{automatic:{}}}) });
    if (!made.ok && made.status !== 409) throw Error('Credential key creation failed.');
    // On a concurrent creator, stop instead of replacing its key.
    if (made.status === 409) throw Error('Credential key exists without an accessible version; review it in Secret Manager.');
    const key = require('node:crypto').randomBytes(32).toString('base64');
    const version = await fetch(`${root}/FUNDED_TRADING_CREDENTIAL_KEY:addVersion`, { method:'POST', headers, body: JSON.stringify({payload:{data:Buffer.from(key).toString('base64')}}) });
    if (!version.ok) throw Error('Credential key version creation failed.');
    return key;
  }
  if (!response.ok) throw Error('Credential key is unavailable.');
  const key = Buffer.from((await response.json()).payload.data, 'base64').toString();
  if (Buffer.from(key, 'base64').length !== 32) throw Error('Credential key has an invalid format.');
  return key;
}
module.exports = { credentialKey };
if (require.main === module) credentialKey(process.argv.includes('--create')).then(() => console.log('Credential key available; no secret value displayed.')).catch(() => { console.error('Credential key setup failed. Review Secret Manager access.'); process.exitCode=1; });

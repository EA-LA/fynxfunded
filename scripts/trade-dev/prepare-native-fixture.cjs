// Seed only the loopback emulator through the same callable API used by the web terminal.
const fs = require('node:fs');
process.env.GCLOUD_PROJECT = 'demo-fynx-trade';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-fynx-trade' });
const email = 'trade-native-acceptance@example.invalid', password = 'LocalNative!123';
(async () => {
  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch (e) { if (e.code !== 'auth/user-not-found') throw e; user = await admin.auth().createUser({ email, password, emailVerified: true }); }
  const authResponse = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=development-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const auth = await authResponse.json(); if (!authResponse.ok) throw Error('Local fixture login failed.');
  async function call(data) {
    const r = await fetch('http://127.0.0.1:5009/demo-fynx-trade/us-central1/fynxTradeDev', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(30000) });
    const body = await r.json(); if (!r.ok) throw Error(JSON.stringify(body)); return body.result;
  }
  const accountId = (await call({ action: 'purchase', requestId: 'native_fixture_v1' })).accountId;
  await call({ action: 'activate', accountId });
  const snapshot = await call({ action: 'snapshot', accountId });
  const existing = snapshot.account.positions.find(p => p.symbol === 'EURUSD' && p.lots === 0.1);
  if (!existing) await call({ action: 'place', accountId, requestId: `web_fixture_${Date.now()}`, order: { symbol: 'EURUSD', side: 'buy', kind: 'market', lots: 0.1 } });
  fs.mkdirSync('docs/trade-engine-2026-10-20', { recursive: true });
  fs.writeFileSync('docs/trade-engine-2026-10-20/native-fixture.json', JSON.stringify({ environment: 'demo-fynx-trade', accountId, createdThrough: 'authenticated web callable transport', email, preparedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log('Native fixture prepared through authenticated web callable transport:', accountId);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => admin.app().delete());

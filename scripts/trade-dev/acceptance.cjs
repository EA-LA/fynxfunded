// Requires npm run dev:trade. Exercises real local Auth, callable HTTP and Firestore transactions.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
process.env.GCLOUD_PROJECT = 'demo-fynx-trade'; process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const admin = require('../../functions/node_modules/firebase-admin'); admin.initializeApp({ projectId: 'demo-fynx-trade' });
const { purchase, transact } = require('../../functions/lib/tradeDev/service'), { syntheticMarket } = require('../../functions/lib/tradeDev/market');
const db = admin.firestore(), checks = [], suffix = Date.now(), email = `acceptance-${suffix}@example.invalid`, password = 'DevelopmentOnly!123';
async function authCall(action, body) { const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${action}?key=development-only`, { signal: AbortSignal.timeout(30000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw Error(data.error?.message); return data; }
async function call(token, data, name = 'fynxTradeDev') { const response = await fetch(`http://127.0.0.1:5009/demo-fynx-trade/us-central1/${name}`, { signal: AbortSignal.timeout(30000), method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) }); return { response, body: await response.json() }; }
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
(async () => {
 const created = await authCall('signUp', { email, password, returnSecureToken: true });
 await check('Registration creates an unverified development identity', async () => { assert.ok(created.localId); assert.equal((await admin.auth().getUser(created.localId)).emailVerified, false); });
 await check('Anonymous and unverified customers cannot trade', async () => { assert.equal((await call('', { action: 'purchase', requestId: 'anonymous_req' })).response.status, 401); assert.equal((await call(created.idToken, { action: 'purchase', requestId: 'unverified_req' })).response.status, 401); });
 await authCall('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: created.idToken });
 const oob = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-fynx-trade/oobCodes', { signal: AbortSignal.timeout(30000) })).json();
 await authCall('update', { oobCode: oob.oobCodes.find(x => x.email === email).oobCode });
 const login = await authCall('signInWithPassword', { email, password, returnSecureToken: true }); const uid = login.localId;
 await check('Verified login passes the paused-MFA status service', async () => { const r = await call(login.idToken, { action: 'status' }, 'fundedMfa'); assert.equal(r.response.status, 200); assert.equal(r.body.result.verified, true); });
 let accountId;
 await check('Concurrent simulated purchase provisions exactly one $25K account', async () => {
   const results = await Promise.all(Array.from({ length: 6 }, () => call(login.idToken, { action: 'purchase', requestId: `purchase_${suffix}` })));
   results.forEach(r => assert.equal(r.response.status, 200, JSON.stringify(r.body))); accountId = results[0].body.result.accountId;
   assert.equal(new Set(results.map(r => r.body.result.accountId)).size, 1); assert.equal((await db.doc(`accounts/${accountId}`).get()).data().balance, 25000);
 });
 await check('Protected accounts cannot bypass the shared two-factor gate', async () => {
   const ref = db.doc(`funded_mfa_private/${uid}`); await ref.set({ enabled: true, version: 'test-factor' });
   try { assert.equal((await call(login.idToken, { action: 'snapshot', accountId })).response.status, 400); }
   finally { await ref.delete(); }
 });
 await check('Account-ready message is captured once with no secret and no delivery claim', async () => {
   const messages = await db.collection('trade_dev_outbox').where('accountId', '==', accountId).get(); assert.equal(messages.size, 1); assert.equal(messages.docs[0].data().status, 'captured_locally'); assert.equal(messages.docs[0].data().password, undefined);
 });
 const order = { action: 'place', accountId, requestId: `market_${suffix}`, order: { symbol: 'EURUSD', side: 'buy', kind: 'market', lots: 0.1, fillPrice: 0, balance: 999999 } };
 await check('Concurrent order retries execute once and ignore client-supplied financial fields', async () => {
   const rows = await Promise.all(Array.from({ length: 5 }, () => call(login.idToken, order))); rows.forEach(r => assert.equal(r.response.status, 200, JSON.stringify(r.body)));
   const a = (await db.doc(`accounts/${accountId}`).get()).data(); assert.equal(a.positions.length, 1); assert.ok(a.positions[0].entry > 1); assert.equal(a.balance, 24999.65);
 });
 await check('Reusing an idempotency key for a different order is rejected', async () => { const r = await call(login.idToken, { ...order, order: { ...order.order, lots: 0.2 } }); assert.equal(r.response.status, 409); });
 const other = await authCall('signUp', { email: `other-${suffix}@example.invalid`, password, returnSecureToken: true }); await admin.auth().updateUser(other.localId, { emailVerified: true }); const otherLogin = await authCall('signInWithPassword', { email: `other-${suffix}@example.invalid`, password, returnSecureToken: true });
 await check('Another customer cannot read or close the account', async () => { for (const data of [{ action: 'snapshot', accountId }, { action: 'close', accountId, requestId: 'ownership_test', positionId: order.requestId, lots: 0.1 }]) assert.equal((await call(otherLogin.idToken, data)).response.status, 404); });
 await check('Firestore rules reject client balance tampering', async () => {
   const r = await fetch(`http://127.0.0.1:8089/v1/projects/demo-fynx-trade/databases/(default)/documents/accounts/${accountId}?updateMask.fieldPaths=balance`, { signal: AbortSignal.timeout(30000), method: 'PATCH', headers: { Authorization: `Bearer ${login.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { balance: { doubleValue: 999999 } } }) }); assert.equal(r.status, 403);
 });
 await check('Partial and final closes update the shared authoritative snapshot', async () => {
   for (const [index, lots] of [0.04, 0.06].entries()) { const r = await call(login.idToken, { action: 'close', accountId, requestId: `close_${suffix}_${index}`, positionId: order.requestId, lots }); assert.equal(r.response.status, 200, JSON.stringify(r.body)); }
   const snapshot = (await call(login.idToken, { action: 'snapshot', accountId })).body.result; assert.equal(snapshot.account.positions.length, 0); assert.equal(snapshot.account.history.length, 2);
 });
 // Server-controlled synthetic clock for deterministic acceptance, never exposed as a customer action.
 const start = Date.now() + 600000; let low = { time: start, quote: syntheticMarket.quote('EURUSD', start) };
 for (let i = 1; i < 500; i++) { const time = start + i * 1000, quote = syntheticMarket.quote('EURUSD', time); if (quote.ask < low.quote.ask) low = { time, quote }; }
 let high = { time: low.time + 1000, quote: syntheticMarket.quote('EURUSD', low.time + 1000) };
 for (let i = 1; i < 700; i++) { const time = low.time + i * 1000, quote = syntheticMarket.quote('EURUSD', time); if (quote.bid > high.quote.bid) high = { time, quote }; }
 const progression = await purchase(uid, `progression_${suffix}`);
 await check('Closed target passes phase one and atomically creates phase two', async () => {
   await transact(uid, progression.accountId, { action: 'place', order: { id: `progress_buy_${suffix}`, symbol: 'EURUSD', side: 'buy', kind: 'market', lots: 6 } }, 'progression_open', low.time);
   await transact(uid, progression.accountId, { action: 'close', positionId: `progress_buy_${suffix}`, lots: 6 }, 'progression_close', high.time);
   const a = (await db.doc(`accounts/${progression.accountId}`).get()).data(); assert.equal(a.status, 'passed'); assert.ok(a.balance >= 27000); assert.ok(a.nextAccountId);
   const next = (await db.doc(`accounts/${a.nextAccountId}`).get()).data(); assert.equal(next.balance, 25000); assert.equal(next.phase, 2); assert.equal(next.userId, uid);
   assert.equal((await db.doc(`trade_dev_outbox/${a.nextAccountId}-phase_two_ready`).get()).data().status, 'captured_locally');
 });
 const failed = await purchase(uid, `failure_${suffix}`);
 await check('Failed challenge liquidates, disables trading, and preserves records', async () => {
   await transact(uid, failed.accountId, { action: 'place', order: { id: `failure_sell_${suffix}`, symbol: 'EURUSD', side: 'sell', kind: 'market', lots: 6 } }, 'failure_open', low.time);
   await transact(uid, failed.accountId, { action: 'tick' }, 'failure_tick', high.time);
   const a = (await db.doc(`accounts/${failed.accountId}`).get()).data(); assert.equal(a.status, 'failed'); assert.equal(a.positions.length, 0); assert.equal(a.history.length, 1);
   await assert.rejects(() => transact(uid, failed.accountId, { action: 'place', order: { id: 'cannot_reopen', symbol: 'EURUSD', side: 'buy', kind: 'market', lots: 1 } }, 'cannot_reopen', high.time + 1), /history-only/);
 });
 const report = { checkedAt: new Date().toISOString(), environment: 'demo-fynx-trade', checks, count: checks.length, limitations: ['SMTP delivery is not tested; messages are captured locally.', 'Progression/failure uses server-controlled synthetic timestamps.', 'Real provider OAuth, commercial data and iOS visual acceptance are separate checks.'] };
 fs.mkdirSync(path.join(__dirname, '../../docs/fynx-trade-dev'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '../../docs/fynx-trade-dev/acceptance.json'), JSON.stringify(report, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });

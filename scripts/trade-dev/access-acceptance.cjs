// Real local Auth/Firestore/callable integration; no charges or external email.
const assert = require('node:assert/strict'), fs = require('node:fs');
process.env.GCLOUD_PROJECT = 'demo-fynx-trade'; process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FUNCTIONS_EMULATOR = 'true'; process.env.FYNX_TRADE_ACCESS_ENABLED = 'true'; delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const admin = require('../../functions/node_modules/firebase-admin'); admin.initializeApp({ projectId: 'demo-fynx-trade' });
const { recordCompletedCheckout } = require('../../functions/lib/stripe/webhook');
const { fulfillNativePayment } = require('../../functions/lib/nativePaymentFulfillment');
const { provisionTradeAccess, tradeAccountId } = require('../../functions/lib/tradeAccess/provision');
const { recordDelivery } = require('../../functions/lib/tradeAccess/delivery');
const { verifiedDeliveryEvent } = require('../../functions/lib/tradeAccess/deliveryPolicy');
const { createHmac } = require('node:crypto');
const { deliverAccessEmail, MailRejected } = require('../../functions/lib/tradeAccess/mail');
const { build } = require('../../functions/lib/purchasedAgreement'), { VERSION } = require('../../functions/lib/fundedPolicy');
const { documentHash, recordLegalAcceptance } = require('../../functions/lib/fundedLegal');
const db = admin.firestore(), checks = [], suffix = Date.now(), password = 'LocalAccess!123';
async function check(label, fn) { await fn(); checks.push(label); console.log('PASS', label); }
async function call(token, data) { const r = await fetch('http://127.0.0.1:5009/demo-fynx-trade/us-central1/fundedTradeAccess', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(20000) }); return { status: r.status, body: await r.json() }; }
async function login(email) { const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=development-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(20000) }); return (await r.json()).idToken; }
async function fixture(uid, channel, tag) {
  const id = `${channel === 'web' ? 'cs' : 'pi'}_access_${suffix}_${tag}`, eventId = `evt_access_${suffix}_${tag}`;
  const rules = build({ uid, program: '2-phase', starting_balance: '25000', accepted: true, accepted_version: VERSION });
  const release = { version: 'local-only', status: 'approved', approvedBy: 'local-fixture', approvedAt: '2026-01-01T00:00:00Z', effectiveAt: '2026-01-01T00:00:00Z', operator: { name: 'Local fixture', country: 'US', contact: 'qa@example.invalid' }, billing: 'one_time', documents: ['terms', 'privacy', 'refund', 'risk'].map(kind => ({ kind, version: 'local-only', url: `https://www.fynxfunded.com/${kind}`, text: kind, sha256: documentHash(kind) })) };
  const legal = recordLegalAcceptance(release, { accepted: true, version: release.version, documentHashes: Object.fromEntries(release.documents.map(d => [d.kind, d.sha256])) }, uid, new Date().toISOString(), channel === 'web' ? 'authenticated_web_checkout' : 'authenticated_ios_checkout');
  const metadata = { userId: uid, accountSize: '25000', phase: '2', style: 'normal', rule_policy_version: VERSION, rule_document_sha256: rules.document_sha256, legal_version: release.version };
  if (channel === 'web') {
    await db.doc(`orders/${id}`).set({ userId: uid, status: 'pending', accountSize: 25000, phase: '2-phase', style: 'normal', amount: 149, amountCents: 14900, currency: 'USD', purchasedRules: rules, legalAcceptance: legal });
    const session = { id, payment_status: 'paid', livemode: false, amount_total: 14900, currency: 'usd', metadata, client_reference_id: uid };
    return { id, eventId, fulfill: () => recordCompletedCheckout(session, eventId) };
  }
  const attemptId = `${uid}_${tag}`;
  await db.doc(`native_checkout_attempts/${attemptId}`).set({ userId: uid, accountSize: 25000, amountCents: 14900, phase: '2', style: 'normal', rules, legalAcceptance: legal });
  const intent = { id, status: 'succeeded', livemode: false, amount: 14900, amount_received: 14900, currency: 'usd', metadata: { ...metadata, channel: 'ios_native', native_checkout_attempt: attemptId } };
  return { id, eventId, fulfill: () => fulfillNativePayment(intent, eventId) };
}
(async () => {
  const email = `access-${suffix}@example.invalid`, user = await admin.auth().createUser({ email, password, emailVerified: true }), uid = user.uid, token = await login(email);
  const web = await fixture(uid, 'web', 'web'), native = await fixture(uid, 'ios', 'native');
  await check('Pending payment cannot create account access', async () => { assert.equal((await provisionTradeAccess(db, web.id)).created, false); assert.equal((await db.doc(`accounts/${tradeAccountId(web.id)}`).get()).exists, false); });
  await check('Verified web payment provisions one account and one email under concurrent retries', async () => {
    await web.fulfill(); const results = await Promise.all([provisionTradeAccess(db, web.id), provisionTradeAccess(db, web.id)]); assert.equal(results.filter(x => x.created).length, 1);
    const a = (await db.doc(`accounts/${tradeAccountId(web.id)}`).get()).data(); assert.equal(a.startingBalance, 25000); assert.equal(a.rules.min_trading_days, 5); assert.equal(a.tradingEnabled, false); assert.equal(a.userId, uid);
  });
  await check('Native payment uses the same account provisioning and email queue', async () => { await native.fulfill(); assert.equal((await provisionTradeAccess(db, native.id)).created, true); assert.equal((await db.doc(`trade_access_mail/ready_${tradeAccountId(native.id)}`).get()).data().status, 'pending'); });
  const accountId = tradeAccountId(web.id), jobId = `ready_${accountId}`, jobRef = db.doc(`trade_access_mail/${jobId}`);
  await check('Existing verified FYNX login lists and activates its purchased account idempotently', async () => {
    const list = await call(token, { action: 'list' }); assert.equal(list.status, 200); assert.equal(list.body.result.accounts.length, 2);
    const results = await Promise.all([call(token, { action: 'open', accountId }), call(token, { action: 'open', accountId })]); for (const r of results) { assert.equal(r.status, 200); assert.equal(r.body.result.activationStatus, 'active'); assert.equal(r.body.result.tradingEnabled, false); }
  });
  await check('First account activation queues one state-confirmed confirmation email', async () => {
    const ref = db.doc(`trade_access_mail/activated_${accountId}`);
    assert.equal((await ref.get()).data().kind, 'account_access_activated');
    let count = 0;
    const send = async (to, message) => { count++; assert.equal(to, email); assert.ok(message.subject.includes('activated')); assert.ok(message.text.includes('Trading is not available yet')); return { providerId: 'local-activation-ack' }; };
    await Promise.all([deliverAccessEmail(db, admin.auth(), ref.id, send), deliverAccessEmail(db, admin.auth(), ref.id, send)]);
    assert.equal(count, 1);
  });
  await check('Guests, unverified users and another customer cannot open account access', async () => {
    assert.equal((await call('', { action: 'list' })).status, 401);
    const otherEmail = `other-access-${suffix}@example.invalid`; await admin.auth().createUser({ email: otherEmail, password, emailVerified: false }); const unverified = await login(otherEmail);
    assert.equal((await call(unverified, { action: 'list' })).status, 401); const other = await admin.auth().getUserByEmail(otherEmail); await admin.auth().updateUser(other.uid, { emailVerified: true });
    assert.equal((await call(await login(otherEmail), { action: 'open', accountId })).status, 404);
  });
  await check('Trading commands and client account mutations are rejected', async () => {
    assert.equal((await call(token, { action: 'place', accountId, balance: 999999, tradingEnabled: true })).status, 400);
    const r = await fetch(`http://127.0.0.1:8089/v1/projects/demo-fynx-trade/databases/(default)/documents/accounts/${accountId}?updateMask.fieldPaths=tradingEnabled`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { tradingEnabled: { booleanValue: true } } }) }); assert.equal(r.status, 403);
  });
  let sends = 0;
  const sender = async (to, message) => { sends++; assert.equal(to, email); assert.ok(message.text.includes(accountId)); assert.ok(message.text.includes('Trading is not available yet')); assert.ok(message.text.includes('https://www.fynxfunded.com/trade/access?account=')); assert.ok(!message.text.includes(password)); return { providerId: 'local-provider-ack' }; };
  await check('Concurrent email jobs submit one password-free notification and retain provider acknowledgement', async () => {
    await Promise.all([deliverAccessEmail(db, admin.auth(), jobId, sender), deliverAccessEmail(db, admin.auth(), jobId, sender)]); assert.equal(sends, 1); assert.equal((await jobRef.get()).data().status, 'provider_accepted');
    await deliverAccessEmail(db, admin.auth(), jobId, sender); assert.equal(sends, 1);
  });
  const nativeJob = `ready_${tradeAccountId(native.id)}`, nativeRef = db.doc(`trade_access_mail/${nativeJob}`);
  await check('Rejected email schedules a retry; uncertain delivery does not automatically resend', async () => {
    await deliverAccessEmail(db, admin.auth(), nativeJob, async () => { throw new MailRejected(true); }); assert.equal((await nativeRef.get()).data().status, 'pending');
    await nativeRef.update({ nextAttemptAt: 0 }); await deliverAccessEmail(db, admin.auth(), nativeJob, async () => { throw Error('network timeout'); }); assert.equal((await nativeRef.get()).data().status, 'delivery_unknown');
    await deliverAccessEmail(db, admin.auth(), nativeJob, async () => { throw Error('Must not run'); });
  });
  function signedEvent(id, state = 'delivered', severity) {
    const at = Math.floor(Date.now() / 1000), signingKey = 'local-delivery-test-secret', timestamp = String(at), token = `local-token-${id}`;
    const body = { signature: { timestamp, token, signature: createHmac('sha256', signingKey).update(timestamp + token).digest('hex') }, 'event-data': { id, event: state, severity, timestamp: at, domain: { name: 'mail.fynxfunded.com' }, recipient: email, message: { headers: { 'message-id': '<local-provider-ack>' } }, 'user-variables': { 'notification-id': jobId } } };
    return verifiedDeliveryEvent(body, signingKey);
  }
  await check('Signed delivery receipts deduplicate, correlate, and update the customer portal', async () => {
    const event = signedEvent(`delivered-${suffix}`);
    const results = await Promise.all([recordDelivery(db, event), recordDelivery(db, event)]);
    assert.equal(results.filter(r => r.duplicate).length, 1);
    assert.equal((await call(token, { action: 'open', accountId })).body.result.accountEmailStatus, 'delivered');
    await recordDelivery(db, signedEvent(`late-delay-${suffix}`, 'failed', 'temporary'));
    assert.equal((await jobRef.get()).data().deliveryStatus, 'delivered');
    await assert.rejects(() => recordDelivery(db, { ...signedEvent(`mismatch-${suffix}`), providerId: 'different-message' }), /correlation/);
    await assert.rejects(() => recordDelivery(db, { ...signedEvent(`wrong-recipient-${suffix}`), recipientHash: '0'.repeat(64) }), /correlation/);
    await assert.rejects(() => recordDelivery(db, { ...signedEvent(`replayed-token-${suffix}`), tokenId: event.tokenId }), /already used/);
    await deliverAccessEmail(db, admin.auth(), jobId, sender); assert.equal(sends, 1);
  });
  const racing = await fixture(uid, 'web', 'delivery-race'), racingAccount = tradeAccountId(racing.id);
  await check('A delivery receipt arriving before the send acknowledgement is preserved', async () => {
    await racing.fulfill(); await provisionTradeAccess(db, racing.id);
    const racingJob = `ready_${racingAccount}`;
    await deliverAccessEmail(db, admin.auth(), racingJob, async () => {
      await recordDelivery(db, { ...signedEvent(`early-receipt-${suffix}`), jobId: racingJob, providerId: 'early-provider-id' });
      return { providerId: '<early-provider-id>' };
    });
    assert.equal((await db.doc(`trade_access_mail/${racingJob}`).get()).data().deliveryStatus, 'delivered');
    assert.equal((await call(token, { action: 'open', accountId: racingAccount })).body.result.accountEmailStatus, 'delivered');
  });
  await check('Refunded accounts become history-only and pending ready mail is cancelled', async () => {
    await db.doc(`orders/${web.id}`).update({ status: 'refunded' }); await jobRef.update({ status: 'pending', nextAttemptAt: 0 });
    const r = await call(token, { action: 'open', accountId }); assert.equal(r.body.result.access, 'history_only');
    await deliverAccessEmail(db, admin.auth(), jobId, sender); assert.equal((await jobRef.get()).data().status, 'cancelled'); assert.equal(sends, 1);
    await web.fulfill(); assert.equal((await db.doc(`orders/${web.id}`).get()).data().status, 'refunded');
  });
  await check('Fulfillment replay preserves existing account activation and financial values', async () => {
    const ref = db.doc(`accounts/${tradeAccountId(native.id)}`); await ref.update({ balance: 24000, activationStatus: 'active', status: 'closed' }); await native.fulfill(); await provisionTradeAccess(db, native.id);
    const a = (await ref.get()).data(); assert.equal(a.balance, 24000); assert.equal(a.status, 'closed'); assert.equal(a.activationStatus, 'active');
  });
  await check('A verified complaint suppresses further mail and cannot be undone by delayed events', async () => {
    await jobRef.update({ status: 'provider_accepted' });
    await recordDelivery(db, signedEvent(`complaint-${suffix}`, 'complained'));
    await recordDelivery(db, signedEvent(`late-delivery-${suffix}`));
    assert.equal((await jobRef.get()).data().deliveryStatus, 'complained');
    let suppressedSends = 0;
    await deliverAccessEmail(db, admin.auth(), `activated_${racingAccount}`, async () => { suppressedSends++; return { providerId: 'must-not-send' }; });
    assert.equal(suppressedSends, 0);
    assert.equal((await db.doc(`trade_access_mail/activated_${racingAccount}`).get()).data().status, 'blocked');
  });
  fs.mkdirSync('docs/trade-engine-2026-10-20', { recursive: true }); fs.writeFileSync('docs/trade-engine-2026-10-20/access-acceptance.json', JSON.stringify({ checkedAt: new Date().toISOString(), environment: 'demo-fynx-trade', checks, count: checks.length, externalDelivery: false }, null, 2) + '\n');
  await admin.app().delete();
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });

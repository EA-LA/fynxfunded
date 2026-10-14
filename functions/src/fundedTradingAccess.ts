import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { nativeCustomer } from './nativeCustomer';
import { documentId } from './nativeCustomerPolicy';
import { confirmedAccount, tradingLink } from './fundedProvisioningPolicy';
import { openCredential, SealedCredential } from './fundedCredentialVault';
export const tradingCredentialKey = defineSecret('FUNDED_TRADING_CREDENTIAL_KEY');
const metadataFields = ['userId', 'challengeId', 'platform', 'server', 'login', 'balance', 'equity', 'currency', 'status', 'currentPhase', 'nextEligiblePayoutAt', 'provisioningStatus', 'environment'];
export const fundedTradingAccess = onCall({ region: 'us-central1', maxInstances: 10, secrets: [tradingCredentialKey] }, async request => {
  const uid = await nativeCustomer(request), db = admin.firestore();
  request.rawRequest?.res?.setHeader('Cache-Control', 'no-store');
  if (request.data?.action === 'metadata') {
    const rows = await db.collection('accounts').where('userId', '==', uid).limit(501).get();
    if (rows.size > 500) throw new HttpsError('resource-exhausted', 'Contact support to load this account history.');
    return { accounts: rows.docs.map(d => ({ ...Object.fromEntries(metadataFields.filter(k => d.data()[k] !== undefined).map(k => [k, d.data()[k]])), accountId: d.id })) };
  }
  if (request.data?.action !== 'reveal') throw new HttpsError('invalid-argument', 'Choose a valid account action.');
  const accountId = documentId(request.data.accountId), challengeId = documentId(request.data.challengeId);
  return db.runTransaction(async tx => {
    const [a, c, v] = await Promise.all([tx.get(db.doc(`accounts/${accountId}`)), tx.get(db.doc(`challenges/${challengeId}`)), tx.get(db.doc(`funded_account_secrets/${accountId}`))]);
    const account = a.data(), challenge = c.data(), vault = v.data();
    if (!account || !challenge || account.userId !== uid || challenge.userId !== uid || account.challengeId !== challengeId || challenge.brokerAccountId !== accountId) throw new HttpsError('not-found', 'Trading access unavailable.');
    if (!confirmedAccount(account) || account.status !== 'active' || !['active', 'passed', 'funded'].includes(challenge.status) || !vault) throw new HttpsError('failed-precondition', 'Secure trading access is not ready. Contact support.');
    const orderId = documentId(challenge.orderId);
    const order = (await tx.get(db.doc(`orders/${orderId}`))).data();
    if (!order || order.userId !== uid || order.challengeId !== challengeId || order.status !== 'paid') throw new HttpsError('failed-precondition', 'This order no longer authorizes trading access. Contact support.');
    const binding = { userId: uid, challengeId, accountId };
    let password: string;
    try { password = openCredential(vault as SealedCredential, binding, tradingCredentialKey.value()); }
    catch { throw new HttpsError('failed-precondition', 'Secure trading access needs support review.'); }
    tx.create(db.collection('funded_credential_access').doc(), { ...binding, action: 'revealed', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { ...binding, platform: account.platform, server: account.server, login: account.login, password, environment: 'simulated', tradingUrl: tradingLink(account.tradingUrl) };
  });
});

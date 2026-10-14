import * as admin from 'firebase-admin';
import { createHmac } from 'node:crypto';
import { sealCredential } from './fundedCredentialVault';
import { tradingLink } from './fundedProvisioningPolicy';
/** Operator bridge for a real, independently confirmed provider account. Never creates a broker account. */
export async function provisionAccount(db: FirebaseFirestore.Firestore, input: Record<string, any>, key: string) {
  for (const field of ['userId', 'challengeId', 'accountId']) if (!/^[A-Za-z0-9_-]{1,128}$/.test(input[field] ?? '')) throw Error('Invalid account binding.');
  for (const field of ['platform', 'server', 'login', 'password', 'providerReference', 'reviewedBy']) if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 4096) throw Error('Complete provider confirmation and credentials are required.');
  const confirmedAt = Date.parse(input.providerConfirmedAt);
  if (input.environment !== 'simulated' || !Number.isFinite(confirmedAt) || confirmedAt > Date.now() || confirmedAt < Date.now() - 86400000) throw Error('A simulated account confirmed within 24 hours is required.');
  const url = input.tradingUrl ? tradingLink(input.tradingUrl) : null;
  if (input.tradingUrl && !url) throw Error('Use an HTTPS platform URL without credentials, query or fragment.');
  const binding = { userId: input.userId, challengeId: input.challengeId, accountId: input.accountId };
  const fingerprint = createHmac('sha256', Buffer.from(key, 'base64')).update(JSON.stringify([binding, input.platform, input.server, input.login, input.password, input.providerReference, url])).digest('hex');
  const sealed = sealCredential(input.password, binding, key);
  return db.runTransaction(async tx => {
    const challengeRef = db.doc(`challenges/${input.challengeId}`), accountRef = db.doc(`accounts/${input.accountId}`), vaultRef = db.doc(`funded_account_secrets/${input.accountId}`);
    const [challengeSnap, accountSnap, vaultSnap] = await Promise.all([tx.get(challengeRef), tx.get(accountRef), tx.get(vaultRef)]);
    const c = challengeSnap.data(), a = accountSnap.data(), v = vaultSnap.data();
    if (!c || c.userId !== input.userId || !c.orderId || c.orderId.includes('/') || c.status !== 'active' || (c.currentPhase ?? 1) !== 1) throw Error('An owned active first-phase challenge is required. Use the reviewed transition workflow for later phases.');
    const order = (await tx.get(db.doc(`orders/${c.orderId}`))).data();
    if (!order || order.userId !== input.userId || order.challengeId !== input.challengeId || order.status !== 'paid') throw Error('A confirmed paid owned order is required.');
    if (c.brokerAccountId && c.brokerAccountId !== input.accountId) throw Error('Challenge already bound to a different account.');
    if (a && (a.userId !== input.userId || a.challengeId !== input.challengeId || a.status !== 'active')) throw Error('Existing account cannot be rebound or reactivated.');
    if (v) { if (v.provisioningFingerprint === fingerprint && c.brokerAccountId === input.accountId) return { alreadyProvisioned: true }; throw Error('Existing secure credentials require an explicit rotation workflow.'); }
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.create(vaultRef, { ...sealed, provisioningFingerprint: fingerprint, status: 'active', createdAt: now });
    tx.set(accountRef, { ...binding, platform: input.platform, server: input.server, login: input.login, environment: 'simulated', providerReference: input.providerReference,
      providerConfirmedAt: new Date(confirmedAt).toISOString(), tradingUrl: url, provisioningStatus: 'ready', status: 'active', currentPhase: 1,
      password: admin.firestore.FieldValue.delete(), updatedAt: now }, { merge: true });
    tx.update(challengeRef, { brokerAccountId: input.accountId, accountReference: input.login, provisioningStatus: 'ready', updatedAt: now });
    tx.create(db.collection('audit_logs').doc(), { ...binding, action: 'provider_account_bound', result: 'confirmed', reviewedBy: input.reviewedBy, providerReference: input.providerReference, createdAt: now });
    return { alreadyProvisioned: false };
  });
}

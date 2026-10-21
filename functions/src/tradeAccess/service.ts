import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { nativeCustomer } from '../nativeCustomer';
import { documentId } from '../nativeCustomerPolicy';

export function accountView(id: string, a: FirebaseFirestore.DocumentData, mail?: FirebaseFirestore.DocumentData) {
  const known = ['pending', 'sending', 'provider_accepted', 'delivery_unknown', 'blocked', 'failed', 'cancelled', 'delivered', 'delayed', 'bounced', 'complained'];
  const mailState = mail?.userId === a.userId && mail?.accountId === id ? mail.deliveryStatus ?? mail.status : undefined;
  return { accountId: id, challengeId: a.challengeId, orderId: a.orderId, platform: a.platform,
    status: a.status, activationStatus: a.activationStatus, currentPhase: a.currentPhase, currency: a.currency,
    startingBalance: a.startingBalance, balance: a.balance, equity: a.equity, rules: a.rules,
    accountEmailStatus: known.includes(mailState) ? mailState : 'unavailable',
    tradingEnabled: false, tradingHoldReason: 'Trading is not available yet.' };
}

export async function activateTradeAccess(db: FirebaseFirestore.Firestore, uid: string, id: string) {
  documentId(id);
  return db.runTransaction(async tx => {
    const ref = db.doc(`accounts/${id}`), a = (await tx.get(ref)).data();
    if (!a || a.userId !== uid || a.platform !== 'FYNX Trade' || a.accessVersion !== 1) throw new HttpsError('not-found', 'Account unavailable. Sign in with the FYNX account used at checkout.');
    const [c, o, mail] = await Promise.all([tx.get(db.doc(`challenges/${documentId(a.challengeId)}`)), tx.get(db.doc(`orders/${documentId(a.orderId)}`)), tx.get(db.doc(`trade_access_mail/ready_${id}`))]);
    const challenge = c.data(), order = o.data();
    if (!challenge || !order || challenge.userId !== uid || order.userId !== uid || order.challengeId !== a.challengeId || challenge.orderId !== a.orderId) throw new HttpsError('failed-precondition', 'Account binding needs support review.');
    if (order.status !== 'paid' || !['active', 'passed', 'funded'].includes(challenge.status) || a.status !== 'active' || challenge.brokerAccountId !== id) {
      return { ...accountView(id, a, mail.data()), access: 'history_only', tradingHoldReason: 'This account is available for historical review only.' };
    }
    if (a.activationStatus !== 'active') {
      const now = FieldValue.serverTimestamp();
      tx.update(ref, { activationStatus: 'active', activatedAt: now, updatedAt: now });
      tx.create(db.doc(`trade_access_events/activate_${id}`), { userId: uid, accountId: id, type: 'account_access_activated', tradingEnabled: false, createdAt: now });
      tx.create(db.doc(`trade_access_mail/activated_${id}`), {
        userId: uid, accountId: id, challengeId: a.challengeId, orderId: a.orderId,
        kind: 'account_access_activated', status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: now,
      });
    }
    return { ...accountView(id, a, mail.data()), activationStatus: 'active', access: 'view_only' };
  });
}

export const fundedTradeAccess = onCall({ region: 'us-central1', maxInstances: 10, invoker: 'public' }, async request => {
  const uid = await nativeCustomer(request), db = admin.firestore();
  request.rawRequest?.res?.setHeader('Cache-Control', 'no-store');
  if (request.data?.action === 'list') {
    const rows = await db.collection('accounts').where('userId', '==', uid).limit(501).get();
    if (rows.size > 500) throw new HttpsError('resource-exhausted', 'Contact support to load more accounts.');
    return { accounts: rows.docs.filter(d => d.data().platform === 'FYNX Trade' && d.data().accessVersion === 1).map(d => accountView(d.id, d.data())), tradingEnabled: false };
  }
  if (request.data?.action === 'open') return activateTradeAccess(db, uid, documentId(request.data.accountId));
  // No order placement, client balances or customer provisioning endpoints in this release.
  throw new HttpsError('invalid-argument', 'Choose an account to view. Trading is not available yet.');
});

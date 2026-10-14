import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { nativeCustomer } from './nativeCustomer';
import { documentId } from './nativeCustomerPolicy';
import { orderLifecycle } from './fundedProvisioningPolicy';

export const fundedOrderStatus = onCall({ region: 'us-central1', maxInstances: 10 }, async request => {
  const uid = await nativeCustomer(request), id = documentId(request.data?.orderId), db = admin.firestore();
  return db.runTransaction(async tx => {
    const order = (await tx.get(db.doc(`orders/${id}`))).data();
    if (!order || order.userId !== uid) throw new HttpsError('not-found', 'Order unavailable. Open an order from your Billing page.');
    const challengeId = order.challengeId ? documentId(order.challengeId) : null;
    const challenge = challengeId ? (await tx.get(db.doc(`challenges/${challengeId}`))).data() : undefined;
    if (challenge && (challenge.userId !== uid || challenge.orderId !== id)) throw new HttpsError('failed-precondition', 'Order setup needs support review.');
    const accountId = challenge?.brokerAccountId ? documentId(challenge.brokerAccountId) : null;
    const account = accountId ? (await tx.get(db.doc(`accounts/${accountId}`))).data() : undefined;
    if (account && (account.userId !== uid || account.challengeId !== challengeId)) throw new HttpsError('failed-precondition', 'Account setup needs support review.');
    return { ...orderLifecycle(order, challenge, account), orderId: id, challengeId, accountId,
      paymentStatus: order.status, checkedAt: new Date().toISOString() };
  });
});

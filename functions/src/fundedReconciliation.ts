import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { orderLifecycle } from './fundedProvisioningPolicy';
import * as logger from 'firebase-functions/logger';
export async function reconcileOrders(db: FirebaseFirestore.Firestore) {
  const report = { checkedAt: new Date().toISOString(), providerReconciliation: false, complete: true, orders: 0, findingsTotal: 0, findingsTruncated: false, findings: [] as { orderId: string; reason: string }[], states: {} as Record<string, number> };
  const finding = (value: {orderId: string; reason: string}) => { report.findingsTotal++; if (report.findings.length < 500) report.findings.push(value); else report.findingsTruncated = true; };
  const paymentIds = new Set<string>(); let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection('orders').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); if (page.empty) break;
    for (const row of page.docs) {
      if (report.orders >= 2000) { report.complete = false; return report; }
      report.orders++; const order = row.data();
      const reference = order.stripePaymentIntentId || order.stripeSessionId;
      if (reference) { if (paymentIds.has(reference)) finding({orderId:row.id,reason:'duplicate_payment_reference'}); paymentIds.add(reference); }
      const challengeId = typeof order.challengeId === 'string' && /^[A-Za-z0-9_-]{1,220}$/.test(order.challengeId) ? order.challengeId : null;
      const challenge = challengeId ? (await db.doc(`challenges/${challengeId}`).get()).data() : undefined;
      const id = typeof challenge?.brokerAccountId === 'string' && /^[A-Za-z0-9_-]{1,220}$/.test(challenge.brokerAccountId) ? challenge.brokerAccountId : null;
      const account = id ? (await db.doc(`accounts/${id}`).get()).data() : undefined;
      if (challenge && (challenge.userId !== order.userId || challenge.orderId !== row.id) || account && (account.userId !== order.userId || account.challengeId !== challengeId)) finding({orderId:row.id,reason:'binding_conflict'});
      if (order.status === 'paid' && !challenge) finding({orderId:row.id,reason:'paid_order_missing_challenge'});
      if (account?.password) finding({orderId:row.id,reason:'plaintext_credential_requires_migration'});
      const state=orderLifecycle(order,challenge,account).state; report.states[state]=(report.states[state]||0)+1;
      if (['account_pending','provisioning_failed','review_required'].includes(state)) finding({orderId:row.id,reason:state});
    }
    cursor = page.docs[page.docs.length-1];
  }
  return report;
}
export const reconcileFundedOrders = onSchedule({ schedule: 'every 60 minutes', region: 'us-central1', timeoutSeconds: 300, maxInstances: 1 }, async () => {
  const db = admin.firestore();
  try {
    const report = await reconcileOrders(db);
    // Keep one current operational snapshot; never change payments, trading status or phases.
    await db.doc('funded_reconciliation/current').set(report);
    const summary = { code: report.complete && !report.findingsTotal ? 'FYNX_FUNDED_RECONCILIATION_CLEAR' : 'FYNX_FUNDED_RECONCILIATION_ATTENTION', complete: report.complete, orders: report.orders, findingsTotal: report.findingsTotal, findingsTruncated: report.findingsTruncated };
    if (report.complete && !report.findingsTotal) logger.info('Funded internal reconciliation complete', summary);
    else logger.warn('Funded internal reconciliation needs review', summary);
  } catch {
    logger.error('Funded reconciliation failed; the previous snapshot is stale.', { code: 'FYNX_FUNDED_RECONCILIATION_FAILED' });
    throw Error('Funded reconciliation failed.');
  }
});

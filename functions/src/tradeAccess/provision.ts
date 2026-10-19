import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { bindRecordedRules as bind } from '../recordedPurchaseRules';
import { documentId } from '../nativeCustomerPolicy';

export const tradeAccessEnabled = () => process.env.FYNX_TRADE_ACCESS_ENABLED === 'true';
export const tradeAccountId = (orderId: string) => `ft_${createHash('sha256').update(orderId).digest('hex').slice(0, 32)}_p1`;

/** Only signed payment fulfillment can request this; never callable by a customer. */
export async function provisionTradeAccess(db: FirebaseFirestore.Firestore, orderId: string) {
  documentId(orderId);
  const accountId = tradeAccountId(orderId);
  return db.runTransaction(async tx => {
    const orderRef = db.doc(`orders/${orderId}`), accountRef = db.doc(`accounts/${accountId}`);
    const order = (await tx.get(orderRef)).data();
    if (!order || order.tradeProvisioningRequested !== true || order.status !== 'paid' || order.fulfillmentStatus !== 'complete') return { created: false };
    // Test-mode payments must remain on the exact local demo project.
    const local = process.env.GCLOUD_PROJECT === 'demo-fynx-trade' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8089';
    if (order.paymentLiveMode !== true && !local) throw Error('Live payment evidence required.');
    const challengeId = documentId(order.challengeId), eventId = documentId(order.paymentEventId);
    const challengeRef = db.doc(`challenges/${challengeId}`), mailRef = db.doc(`trade_access_mail/ready_${accountId}`);
    const [c, a, e, m] = await Promise.all([tx.get(challengeRef), tx.get(accountRef), tx.get(db.doc(`stripe_events/${eventId}`)), tx.get(mailRef)]);
    const challenge = c.data(), account = a.data(), event = e.data();
    if (!challenge || challenge.userId !== order.userId || challenge.orderId !== orderId
      || !(event?.stripeSessionId === orderId || event?.stripePaymentIntentId === orderId)) throw Error('Payment/challenge binding needs review.');
    if (account) {
      if (account.userId !== order.userId || account.orderId !== orderId || challenge.brokerAccountId !== accountId || !m.exists) throw Error('Trade account binding needs review.');
      return { created: false, accountId }; // Never reset balances, activation or a later phase.
    }
    if (challenge.brokerAccountId || challenge.currentPhase !== 1 || challenge.status !== 'active') throw Error('Existing account or phase must not be replaced.');
    const policy = bind(order.purchasedRules, { uid: order.userId, order_id: orderId, program: order.phase,
      starting_balance: String(order.accountSize), start_timestamp: challenge.rulePolicy?.start_timestamp,
      expected_hash: challenge.rulePolicy?.agreement?.document_sha256 });
    if (!order.legalAcceptance || order.legalAcceptance.uid !== order.userId) throw Error('Purchase agreement unavailable.');
    const now = FieldValue.serverTimestamp();
    tx.create(accountRef, {
      userId: order.userId, challengeId, orderId, platform: 'FYNX Trade', accountReference: accountId,
      environment: 'simulated', status: 'active', provisioningStatus: 'access_ready', accessVersion: 1,
      activationStatus: 'pending', tradingEnabled: false, tradingHoldReason: 'Trading is not available yet.',
      currentPhase: 1, phase: 1, currency: 'USD', startingBalance: order.accountSize,
      balance: order.accountSize, equity: order.accountSize, balanceCents: order.accountSize * 100,
      rulePolicy: policy, rules: policy.agreement.rule_snapshot,
      // Leverage is intentionally unset until instrument/execution terms are approved.
      leverage: null, createdAt: now, updatedAt: now,
    });
    tx.update(challengeRef, { brokerAccountId: accountId, accountReference: accountId, provisioningStatus: 'access_ready', platform: 'FYNX Trade', updatedAt: now });
    tx.update(orderRef, { tradeAccountId: accountId, tradeProvisioningStatus: 'access_ready', updatedAt: now });
    tx.create(mailRef, { userId: order.userId, accountId, challengeId, orderId, kind: 'account_access_ready',
      status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: now });
    tx.create(db.doc(`trade_access_events/provision_${accountId}`), { userId: order.userId, accountId, orderId, type: 'account_access_created', tradingEnabled: false, createdAt: now });
    return { created: true, accountId };
  });
}

import * as admin from "firebase-admin";
import type Stripe from "stripe";
import { bind as bindPurchasedRules } from "./purchasedAgreement";
import { documentHash } from "./fundedLegal";

/** Native payments must never be fulfilled by a client callback or a web Checkout event. */
export async function fulfillNativePayment(intent: Stripe.PaymentIntent, eventId: string) {
  if (intent.metadata?.channel !== "ios_native" || intent.status !== "succeeded"
    || (!intent.livemode && process.env.FUNCTIONS_EMULATOR !== "true")) return;
  const meta = intent.metadata, uid = meta.userId, attemptId = meta.native_checkout_attempt;
  if (!uid || !/^[A-Za-z0-9_-]{1,220}$/.test(attemptId ?? "") || !/^pi_[A-Za-z0-9_]+$/.test(intent.id)
    || !/^evt_[A-Za-z0-9_]+$/.test(eventId)) throw Error("Invalid native payment reference.");
  const db = admin.firestore(), orderRef = db.doc(`orders/${intent.id}`), challengeRef = db.doc(`challenges/${intent.id}`);
  const attemptRef = db.doc(`native_checkout_attempts/${attemptId}`), eventRef = db.doc(`stripe_events/${eventId}`);
  return db.runTransaction(async tx => {
    const [attemptSnapshot, orderSnapshot, challengeSnapshot, eventSnapshot] = await Promise.all([
      tx.get(attemptRef), tx.get(orderRef), tx.get(challengeRef), tx.get(eventRef),
    ]);
    const attempt = attemptSnapshot.data(), order = orderSnapshot.data(), challenge = challengeSnapshot.data();
    if (!attempt || attempt.userId !== uid || (attempt.intentId && attempt.intentId !== intent.id)
      || attempt.accountSize !== Number(meta.accountSize) || attempt.phase !== meta.phase || attempt.style !== meta.style
      || intent.currency !== "usd" || !Number.isSafeInteger(intent.amount) || intent.amount !== attempt.amountCents
      || intent.amount_received !== attempt.amountCents) throw Error("Payment does not match the reserved native checkout.");
    if (order && (order.userId !== uid || order.channel !== "ios_native" || order.amountCents !== intent.amount
      || order.stripePaymentIntentId !== intent.id)) throw Error("Native order binding conflict.");
    if (challenge && (challenge.userId !== uid || challenge.orderId !== intent.id)) throw Error("Challenge ownership conflict.");
    if (eventSnapshot.exists && eventSnapshot.data()?.stripePaymentIntentId !== intent.id) throw Error("Event binding conflict.");
    if (order?.fulfillmentStatus === "complete") {
      if (!challenge) throw Error("Fulfilled native order needs missing-challenge review.");
      return { fulfilled: true, duplicate: true }; // Never reset failure, phase, broker binding or refund state.
    }
    if (challenge || (order && order.status !== "pending")) throw Error("Native order needs reconciliation before fulfillment.");
    const legal = attempt.legalAcceptance;
    if (!legal || legal.uid !== uid || legal.source !== "authenticated_ios_checkout" || legal.releaseVersion !== meta.legal_version
      || !Array.isArray(legal.documents) || legal.documents.length !== 4 || new Set(legal.documents.map((d: any) => d.kind)).size !== 4
      || legal.documents.some((d: any) => typeof d.text !== "string" || documentHash(d.text) !== d.sha256)) throw Error("Native legal acceptance is missing or altered.");
    const policy = bindPurchasedRules(attempt.rules, { uid, order_id: intent.id, program: `${attempt.phase}-phase`,
      starting_balance: String(attempt.accountSize), start_timestamp: new Date().toISOString(), expected_hash: meta.rule_document_sha256 });
    if (meta.rule_policy_version !== policy.policy_version) throw Error("Payment policy version does not match the purchased rules.");
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(orderRef, { userId: uid, channel: "ios_native", challengeId: intent.id, status: "paid", fulfillmentStatus: "complete",
      amount: intent.amount / 100, amountCents: intent.amount, currency: "USD", accountSize: attempt.accountSize,
      phase: `${attempt.phase}-phase`, style: attempt.style, purchasedRules: attempt.rules, legalAcceptance: legal,
      stripePaymentIntentId: intent.id, createdAt: order?.createdAt ?? now, paidAt: now }, { merge: true });
    tx.create(challengeRef, { userId: uid, orderId: intent.id, name: `$${attempt.accountSize.toLocaleString("en-US")} ${attempt.phase}-phase challenge`,
      phase: `${attempt.phase}-phase`, accountSize: attempt.accountSize, currency: "USD", style: attempt.style, currentPhase: 1,
      status: "active", progressionMode: "manual", brokerAccountId: null, rulePolicyVersion: policy.policy_version, rulePolicy: policy, startDate: now });
    tx.set(attemptRef, { intentId: intent.id, fulfilledAt: now }, { merge: true });
    tx.create(eventRef, { type: "payment_intent.succeeded", stripePaymentIntentId: intent.id, processedAt: now });
    return { fulfilled: true, duplicate: false };
  });
}

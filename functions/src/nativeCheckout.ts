import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { nativeCustomer } from "./nativeCustomer";
import { requestId, documentId } from "./nativeCustomerPolicy";
import { getPlan } from "./stripe/priceMap";
import { paymentsPaused } from "./stripe/paymentAvailability";
import { build as buildRules } from "./purchasedAgreement";
import { VERSION } from "./fundedPolicy";
const secret = defineSecret("STRIPE_SECRET_KEY");
const publicKey = defineString("STRIPE_PUBLISHABLE_KEY", { default: "" });
export const fundedMobileCheckout = onCall({ region: "us-central1", secrets: [secret], maxInstances: 10 }, async request => {
  const uid = await nativeCustomer(request); const data = request.data ?? {};
  const db = admin.firestore();
  const available = !paymentsPaused() && process.env.FYNX_FUNDED_PURCHASES_APPROVED === "true" && /^pk_(live|test)_/.test(publicKey.value());
  if (data.action === "catalog") {
    const plans = ["5k", "10k", "25k", "50k", "100k", "200k"].flatMap(size => ["1", "2", "3"].map(phase => {
      const plan = getPlan(size, phase)!;
      const agreement = buildRules({ uid, program: `${phase}-phase`, starting_balance: String(plan.accountSize), accepted_version: VERSION, accepted: true });
      return { id: `${size}_${phase}`, size, ...plan, rules: agreement.document.phases };
    }));
    return { available, message: available ? "" : "Challenge purchases are temporarily paused while launch checks are completed.", version: VERSION, currency: "USD", plans };
  }
  if (data.action === "status") {
    const snapshot = await db.doc(`orders/${documentId(data.orderId)}`).get(); const order = snapshot.data();
    if (!order || order.userId !== uid) throw new HttpsError("not-found", "Order unavailable.");
    return { status: order.status, orderId: snapshot.id, challengeId: order.challengeId ?? null };
  }
  if (data.action !== "create") throw new HttpsError("invalid-argument", "Unknown checkout action.");
  if (!available) throw new HttpsError("failed-precondition", "Challenge purchases are temporarily paused while launch checks are completed.");
  const live = publicKey.value().startsWith("pk_live_") && /^(sk|rk)_live_/.test(secret.value());
  if (!live && process.env.FUNCTIONS_EMULATOR !== "true") throw new HttpsError("failed-precondition", "Live payments are not configured. Please contact Support.");
  const style = data.style ?? "normal";
  if (!["normal", "swing"].includes(style)) throw new HttpsError("invalid-argument", "Choose a supported trading style.");
  const id = requestId(data.requestId); const plan = getPlan(data.size, data.phase);
  if (!plan) throw new HttpsError("invalid-argument", "Choose a challenge.");
  if (data.acceptRules !== true || data.rulePolicyVersion !== VERSION) throw new HttpsError("failed-precondition", "Review and accept the current challenge rules.");
  const ref = db.doc(`native_checkout_attempts/${uid}_${id}`);
  const agreement = buildRules({ uid, program: `${plan.phase}-phase`, starting_balance: String(plan.accountSize), accepted_version: VERSION, accepted: true });
  const attempt: admin.firestore.DocumentData = await db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data();
    if (prior) {
      if (prior.amountCents !== plan.amountCents || prior.style !== style || prior.size !== data.size || prior.phase !== plan.phase || prior.rules.document_sha256 !== agreement.document_sha256) throw new HttpsError("already-exists", "Checkout details changed. Start a new checkout.");
      return prior;
    }
    const reserved = { userId: uid, style, size: data.size, phase: plan.phase, amountCents: plan.amountCents, rules: agreement, email: request.auth!.token.email ?? "", createdAt: Date.now() };
    tx.create(ref, reserved); return reserved;
  });
  // Stripe retains idempotency keys for at least 24 hours. Never create a second payment after that window.
  if (!attempt.intentId && Date.now() - attempt.createdAt > 23 * 60 * 60 * 1000) throw new HttpsError("failed-precondition", "This checkout expired. Contact support before starting another payment.");
  const stripe = new Stripe(secret.value(), { apiVersion: "2023-10-16" });
  const intent = attempt.intentId ? await stripe.paymentIntents.retrieve(attempt.intentId) : await stripe.paymentIntents.create({
    amount: plan.amountCents, currency: "usd", payment_method_types: ["card"],
    receipt_email: attempt.email || undefined,
    metadata: { channel: "ios_native", userId: uid, accountSize: String(plan.accountSize), phase: plan.phase, style, rule_policy_version: VERSION, rule_document_sha256: attempt.rules.document_sha256 },
  }, { idempotencyKey: `native-checkout-${uid}-${id}` });
  await db.runTransaction(async tx => {
    const orderRef = db.doc(`orders/${intent.id}`); const existing = await tx.get(orderRef);
    tx.set(ref, { intentId: intent.id }, { merge: true });
    if (!existing.exists) tx.create(orderRef, { userId: uid, channel: "ios_native", style, status: "pending", amount: plan.amountCents / 100, amountCents: plan.amountCents, currency: "USD", accountSize: plan.accountSize, phase: `${plan.phase}-phase`, purchasedRules: attempt.rules, stripePaymentIntentId: intent.id, customerEmail: attempt.email, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { orderId: intent.id, clientSecret: intent.client_secret, publishableKey: publicKey.value(), status: intent.status };
});

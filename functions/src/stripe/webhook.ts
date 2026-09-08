import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const webhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

export const stripeWebhook = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey, webhookSecret], invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") { res.status(400).send("Missing Stripe signature"); return; }

    let event: Stripe.Event;
    try {
      const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: "2023-10-16" });
      event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret.value());
    } catch (error) {
      console.error("[Stripe Webhook] Signature verification failed", error);
      res.status(400).send("Invalid webhook signature");
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        await recordCompletedCheckout(event.data.object as Stripe.Checkout.Session, event.id);
      }
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[Stripe Webhook] Event processing failed", { eventId: event.id, error });
      res.status(500).send("Webhook processing failed");
    }
  },
);

async function recordCompletedCheckout(session: Stripe.Checkout.Session, eventId: string) {
  if (session.payment_status !== "paid") return;

  const userId = session.metadata?.userId;
  const accountSize = Number(session.metadata?.accountSize);
  const phase = session.metadata?.phase;
  if (!userId || !Number.isFinite(accountSize) || accountSize <= 0 || !phase || !["1", "2", "3"].includes(phase)) {
    throw new Error("Checkout metadata is incomplete");
  }

  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(session.id);
  const challengeRef = db.collection("challenges").doc(session.id);
  const eventRef = db.collection("stripe_events").doc(eventId);
  const phaseLabel = `${phase}-phase`;
  const challengeName = `$${accountSize.toLocaleString("en-US")} ${phase}-phase challenge`;

  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(eventRef)).exists) return;

    transaction.set(orderRef, {
      userId,
      challengeId: challengeRef.id,
      amount: (session.amount_total || 0) / 100,
      currency: (session.currency || "usd").toUpperCase(),
      paymentMethod: "card",
      status: "paid",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      challenge: challengeName,
      accountSize,
      phase: phaseLabel,
      style: session.metadata?.style === "swing" ? "swing" : "normal",
      stripeSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    }, { merge: true });

    transaction.set(challengeRef, {
      userId,
      orderId: orderRef.id,
      name: challengeName,
      phase: phaseLabel,
      accountSize,
      style: session.metadata?.style === "swing" ? "swing" : "normal",
      status: "active",
      startDate: admin.firestore.FieldValue.serverTimestamp(),
      brokerAccountId: null,
      currency: (session.currency || "usd").toUpperCase(),
    }, { merge: true });

    transaction.create(eventRef, {
      type: "checkout.session.completed",
      stripeSessionId: session.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

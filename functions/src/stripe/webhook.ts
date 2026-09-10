import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const webhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const mailgunApiKey = defineSecret("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = "mail.fynxfunded.com";
const MAILGUN_SENDER = "FYNX Funded <security@mail.fynxfunded.com>";

export const stripeWebhook = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey, webhookSecret, mailgunApiKey], invoker: "public" },
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

  const email = session.customer_details?.email || session.customer_email || "";
  const shouldSendEmail = await db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (eventSnapshot.exists && eventSnapshot.data()?.emailStatus === "sent") return false;

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

    transaction.set(eventRef, {
      type: "checkout.session.completed",
      stripeSessionId: session.id,
      emailStatus: email ? "pending" : "not_available",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return Boolean(email);
  });

  if (!shouldSendEmail) return;
  await sendPurchaseConfirmation(email, {
    challengeName,
    orderReference: session.id,
    amount: (session.amount_total || 0) / 100,
    currency: (session.currency || "usd").toUpperCase(),
  });
  await Promise.all([
    eventRef.set({ emailStatus: "sent", emailSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
    orderRef.set({ confirmationEmailStatus: "sent", confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
  ]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] || character);
}

function purchaseEmailHtml(details: { challengeName: string; orderReference: string; amount: number; currency: string }): string {
  const challengeName = escapeHtml(details.challengeName);
  const orderReference = escapeHtml(details.orderReference);
  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: details.currency }).format(details.amount);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050505;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your FYNX Funded purchase is confirmed.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;">
<tr><td align="center" style="padding:0 0 22px;"><img src="https://www.fynxfunded.com/fynx-sender-logo.png" width="88" height="88" alt="FYNX" style="display:block;width:88px;height:88px;border:1px solid #303030;border-radius:22px;"><div style="padding-top:12px;color:#ffffff;font-size:22px;font-weight:800;">FYNX <span style="color:#9a9a9a;font-weight:500;">Funded</span></div></td></tr>
<tr><td style="background:#111111;border:1px solid #303030;border-radius:18px;padding:36px 38px;">
<div style="display:inline-block;padding:7px 11px;border:1px solid #444444;border-radius:999px;background:#1b1b1b;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Payment confirmed</div>
<h1 style="margin:20px 0 10px;font-size:30px;line-height:1.2;color:#ffffff;">Thank you for your purchase.</h1>
<p style="margin:0 0 24px;color:#aaaaaa;font-size:15px;line-height:1.7;">Your challenge order is confirmed and now appears in your FYNX Funded dashboard.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#080808;border:1px solid #303030;border-radius:13px;padding:6px 18px;">
<tr><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#a3a3a3;font-size:13px;">Challenge</td><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${challengeName}</td></tr>
<tr><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#a3a3a3;font-size:13px;">Total paid</td><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${total}</td></tr>
<tr><td style="padding:14px 0;color:#a3a3a3;font-size:13px;">Order reference</td><td style="padding:14px 0;color:#ffffff;font-size:11px;font-weight:600;text-align:right;word-break:break-all;">${orderReference}</td></tr>
</table>
<div style="margin:24px 0;padding:16px 18px;border-left:3px solid #ffffff;background:#1a1a1a;border-radius:8px;color:#cfcfcf;font-size:13px;line-height:1.6;"><strong style="color:#ffffff;">What happens next?</strong><br>Your trading account credentials will be emailed separately and displayed in your dashboard as soon as account provisioning is complete.</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#ffffff;"><a href="https://www.fynxfunded.com/dashboard" style="display:inline-block;padding:14px 22px;color:#000000;text-decoration:none;font-size:14px;font-weight:800;">Open your dashboard&nbsp; →</a></td></tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 20px;color:#777777;font-size:12px;line-height:1.7;">This receipt confirms a simulated trading evaluation purchase.<br><a href="https://www.fynxfunded.com" style="color:#ffffff;text-decoration:none;">fynxfunded.com</a> &nbsp;•&nbsp; <a href="mailto:support@fynxfunded.com" style="color:#ffffff;text-decoration:none;">support@fynxfunded.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendPurchaseConfirmation(email: string, details: { challengeName: string; orderReference: string; amount: number; currency: string }) {
  const text = `Thank you for your purchase. Your ${details.challengeName} order is confirmed. Total paid: ${details.currency} ${details.amount.toFixed(2)}. Your trading account credentials will be emailed separately and displayed in your dashboard as soon as account provisioning is complete. Order reference: ${details.orderReference}`;
  const form = new URLSearchParams({
    from: MAILGUN_SENDER,
    to: email,
    subject: "Thank you for your FYNX Funded purchase",
    text,
    html: purchaseEmailHtml(details),
    "v:order-reference": details.orderReference,
  });
  const authorization = Buffer.from(`api:${mailgunApiKey.value()}`).toString("base64");
  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    console.error("Mailgun rejected purchase confirmation", { status: response.status, providerMessage });
    throw new Error("Purchase confirmation delivery failed");
  }
}

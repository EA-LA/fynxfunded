import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { getPlan } from "./priceMap";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const allowedOrigins = new Set(["https://fynxfunded.com", "https://www.fynxfunded.com", "https://fynxfunded.vercel.app"]);

function applyCors(req: { headers: Record<string, unknown> }, res: { set: (name: string, value: string) => void }) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (allowedOrigins.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

async function authenticatedUser(authorization: unknown) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  try { return await admin.auth().verifyIdToken(authorization.slice(7)); } catch { return null; }
}

export const createCheckoutSession = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey], cors: false, invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const user = await authenticatedUser(req.headers.authorization);
    if (!user?.uid || !user.email) { res.status(401).json({ error: "Authentication required" }); return; }
    const plan = getPlan(req.body?.accountSize, req.body?.phase);
    if (!plan) { res.status(400).json({ error: "Invalid challenge plan" }); return; }
    const style = req.body?.style === "swing" ? "swing" : "normal";

    try {
      const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: "2023-10-16" });
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: user.email,
        client_reference_id: user.uid,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: plan.amountCents, product_data: { name: plan.label } } }],
        metadata: { userId: user.uid, accountSize: String(plan.accountSize), phase: plan.phase, style, currency: "USD" },
        payment_method_types: ["card"],
        success_url: "https://www.fynxfunded.com/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://www.fynxfunded.com/checkout",
      });
      await admin.firestore().collection("orders").doc(session.id).set({
        userId: user.uid,
        customerEmail: user.email,
        amount: plan.amountCents / 100,
        currency: "USD",
        paymentMethod: "card",
        status: "pending",
        challenge: plan.label,
        accountSize: plan.accountSize,
        phase: `${plan.phase}-phase`,
        style,
        stripeSessionId: session.id,
        checkoutUrl: session.url,
        checkoutExpiresAt: admin.firestore.Timestamp.fromMillis(session.expires_at * 1000),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (error) {
      console.error("[Stripe] createCheckoutSession failed", error);
      res.status(500).json({ error: "Unable to start secure checkout" });
    }
  },
);

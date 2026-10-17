import { requireFundedMfa } from "../fundedMfa";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const allowedOrigins = new Set(["https://fynxfunded.com", "https://www.fynxfunded.com", "https://fynxfunded.vercel.app"]);

export const verifySession = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey], cors: false, invoker: "public" },
  async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (allowedOrigins.has(origin)) res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { res.status(401).json({ error: "Authentication required" }); return; }
    let uid = "";
    try {
      const token = await admin.auth().verifyIdToken(authorization.slice(7), true);
      uid = token.uid;
      await requireFundedMfa({ auth: { uid, token, rawToken: authorization.slice(7) } });
    }
    catch { res.status(401).json({ error: "Invalid authentication" }); return; }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    if (!sessionId.startsWith("cs_")) { res.status(400).json({ error: "Invalid session" }); return; }

    try {
      const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: "2023-10-16" });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.userId !== uid) { res.status(403).json({ error: "Session does not belong to this user" }); return; }
      if (session.payment_status !== "paid") { res.status(402).json({ error: "Payment not completed", status: session.payment_status }); return; }
      const orderDoc = await admin.firestore().doc(`orders/${sessionId}`).get();
      if (!orderDoc.exists) { res.status(200).json({ verified: true, status: "paid", order: null, message: "Payment confirmed; order processing is pending." }); return; }
      const order = orderDoc.data()!;
      if (order.userId !== uid) { res.status(403).json({ error: "Order does not belong to this user" }); return; }
      if (order.status !== "paid" || !order.challengeId) {
        res.status(200).json({ verified: true, status: "paid", order: null, fulfillment: "pending", message: "Payment confirmed; order processing is pending." }); return;
      }
      const safeOrder = Object.fromEntries(["userId", "orderNumber", "challengeId", "amount", "currency", "paymentMethod", "status", "challenge", "accountSize", "phase", "style", "createdAt", "paidAt"].filter(key => order[key] !== undefined).map(key => [key, order[key]]));
      res.status(200).json({ verified: true, status: "paid", fulfillment: "complete", order: { ...safeOrder, orderId: orderDoc.id } });
    } catch (error) {
      console.error("[Stripe] verifySession failed", { code: "VERIFICATION_FAILED" });
      res.status(500).json({ error: "Unable to verify checkout" });
    }
  },
);

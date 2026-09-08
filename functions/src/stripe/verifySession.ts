import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const allowedOrigins = new Set(["https://fynxfunded.com", "https://www.fynxfunded.com", "https://fynxfunded.vercel.app"]);

export const verifySession = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey], cors: false },
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
    try { uid = (await admin.auth().verifyIdToken(authorization.slice(7))).uid; }
    catch { res.status(401).json({ error: "Invalid authentication" }); return; }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    if (!sessionId.startsWith("cs_")) { res.status(400).json({ error: "Invalid session" }); return; }

    try {
      const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: "2023-10-16" });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.userId !== uid) { res.status(403).json({ error: "Session does not belong to this user" }); return; }
      if (session.payment_status !== "paid") { res.status(402).json({ error: "Payment not completed", status: session.payment_status }); return; }
      const snap = await admin.firestore().collection("orders").where("stripeSessionId", "==", sessionId).limit(1).get();
      if (snap.empty) { res.status(200).json({ verified: true, status: "paid", order: null, message: "Payment confirmed; order processing is pending." }); return; }
      const orderDoc = snap.docs[0];
      res.status(200).json({ verified: true, status: "paid", order: { ...orderDoc.data(), orderId: orderDoc.id } });
    } catch (error) {
      console.error("[Stripe] verifySession failed", error);
      res.status(500).json({ error: "Unable to verify checkout" });
    }
  },
);

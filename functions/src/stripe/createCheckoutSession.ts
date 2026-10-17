import { nativeCustomer } from "../nativeCustomer";
import { createHash } from "node:crypto";
import { recordLegalAcceptance, type LegalRelease } from "../fundedLegal";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { build as buildPurchasedRules } from "../purchasedAgreement";
import { getPlan } from "./priceMap";
import { paymentsPaused } from "./paymentAvailability";


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
  try { return await admin.auth().verifyIdToken(authorization.slice(7), true); } catch { return null; }
}

export const createCheckoutSession = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey], cors: false, invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    // Keep this server-side hold in place until purchases are ready to launch.
    if (paymentsPaused()) {
      res.status(503).json({ code: "PAYMENTS_PAUSED", error: "Please wait while we finish the final step. Payments are not open yet. You can still explore the platform and manage your account." });
      return;
    }
    const user = await authenticatedUser(req.headers.authorization);
    if (!user?.uid || !user.email || user.email_verified !== true) { res.status(401).json({ error: "Authentication required" }); return; }
    try { await nativeCustomer({ auth: { uid: user.uid, token: user, rawToken: req.headers.authorization!.slice(7) } }); }
    catch { res.status(403).json({ error: "Two-factor verification required" }); return; }
    if (process.env.FYNX_FUNDED_PURCHASES_APPROVED !== "true") { res.status(503).json({ error: "Purchases remain closed pending legal and launch approval." }); return; }
    const plan = getPlan(req.body?.accountSize, req.body?.phase);
    if (!plan) { res.status(400).json({ error: "Invalid challenge plan" }); return; }
    const style = req.body?.style ?? "normal";
    const requestId = req.body?.requestId;
    if (!["normal", "swing"].includes(style) || typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
      res.status(400).json({ error: "A valid trading style and checkout request reference are required." }); return;
    }
    if (!/^(sk|rk)_live_/.test(stripeSecretKey.value()) && process.env.FUNCTIONS_EMULATOR !== "true") {
      res.status(503).json({ error: "Live payments are not configured." }); return;
    }

    try {
      const purchasedRules = buildPurchasedRules({ uid: user.uid, program: `${plan.phase}-phase`, starting_balance: String(plan.accountSize), accepted_version: req.body?.rulePolicyVersion, accepted: req.body?.acceptRules });
      const db = admin.firestore();
      const legalRelease = (await db.doc("funded_legal_releases/current").get()).data() as LegalRelease | undefined;
      const legalAcceptance = recordLegalAcceptance(legalRelease, req.body?.legalAcceptance, user.uid);
      const fingerprint = createHash("sha256").update(JSON.stringify([plan, style, purchasedRules.document_sha256, legalAcceptance.releaseVersion, legalAcceptance.documents.map(d => d.sha256)])).digest("hex");
      const attemptRef = db.doc(`web_checkout_attempts/${user.uid}_${requestId}`);
      const attempt: admin.firestore.DocumentData = await db.runTransaction(async tx => {
        const existing = (await tx.get(attemptRef)).data();
        if (existing) {
          if (existing.fingerprint !== fingerprint || existing.userId !== user.uid) throw Error("Checkout reference has different purchase details.");
          return existing;
        }
        const value = { userId: user.uid, fingerprint, plan, style, purchasedRules, legalAcceptance, customerEmail: user.email, createdAt: Date.now() };
        tx.create(attemptRef, value); return value;
      });
      if (!attempt.sessionId && Date.now() - attempt.createdAt > 23 * 60 * 60 * 1000) throw Error("Checkout attempt expired; contact support before retrying.");
      const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: "2023-10-16" });
      const session = attempt.sessionId ? await stripe.checkout.sessions.retrieve(attempt.sessionId) : await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: user.email,
        client_reference_id: user.uid,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: plan.amountCents, product_data: { name: plan.label } } }],
        metadata: { checkout_attempt: attemptRef.id, legal_version: legalAcceptance.releaseVersion, userId: user.uid, accountSize: String(plan.accountSize), phase: plan.phase, style, currency: "USD", rule_policy_version: purchasedRules.document.policy_version, rule_document_sha256: purchasedRules.document_sha256 },
        payment_method_types: ["card"],
        success_url: "https://www.fynxfunded.com/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://www.fynxfunded.com/checkout",
      }, { idempotencyKey: `funded-web-${attemptRef.id}` });
      await db.runTransaction(async tx => {
        const orderRef = db.doc(`orders/${session.id}`);
        const prior = await tx.get(orderRef);
        tx.set(attemptRef, { sessionId: session.id }, { merge: true });
        if (!prior.exists) tx.create(orderRef, {
        userId: user.uid,
        purchasedRules: attempt.purchasedRules,
        legalAcceptance: attempt.legalAcceptance,
        amountCents: plan.amountCents,
        checkoutAttempt: attemptRef.id,
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
        });
      });
      if (session.status !== "open" || !session.url) { res.status(409).json({ code: "CHECKOUT_NOT_OPEN", error: "This checkout is completed or expired. Check Billing before starting another purchase.", sessionId: session.id }); return; }
      res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (error) {
      console.error("[Stripe] createCheckoutSession failed", { code: "CHECKOUT_FAILED" });
      res.status(500).json({ error: "Unable to start secure checkout" });
    }
  },
);

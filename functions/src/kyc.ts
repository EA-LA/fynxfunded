import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key || "";
const stripeIdentityWebhookSecret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET || functions.config().stripe?.identity_webhook_secret || "";
const appBaseUrl = process.env.APP_BASE_URL || functions.config().app?.base_url || "https://fynxfunded.com";

const stripe = new Stripe(stripeSecretKey || "sk_missing", {
  apiVersion: "2023-10-16" as any,
});

type SupportedProvider = "stripe_identity" | "sumsub" | "persona" | "veriff" | "onfido";

type KycSessionRequest = {
  provider?: SupportedProvider;
  legalFullName: string;
  dateOfBirth: string;
  countryOfResidence: string;
  address: string;
  documentType: "passport" | "drivers_license" | "national_id";
};

function assertStripeConfigured() {
  if (!stripeSecretKey) {
    throw new HttpsError("failed-precondition", "Stripe Identity is not configured. Set STRIPE_SECRET_KEY before creating KYC sessions.");
  }
}

function validateKycPayload(data: Partial<KycSessionRequest>) {
  const required: Array<keyof KycSessionRequest> = ["legalFullName", "dateOfBirth", "countryOfResidence", "address", "documentType"];
  for (const key of required) {
    if (!data[key]) throw new HttpsError("invalid-argument", `Missing required KYC field: ${key}`);
  }
}

export const createKycSession = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Auth required");

  const data = request.data as KycSessionRequest;
  validateKycPayload(data);
  const userId = request.auth.uid;
  const email = typeof request.auth.token.email === "string" ? request.auth.token.email : "";

  const provider = data.provider || "stripe_identity";
  if (provider !== "stripe_identity") {
    throw new HttpsError("unimplemented", `${provider} KYC adapter is not enabled yet.`);
  }

  assertStripeConfigured();

  const profileRef = admin.firestore().collection("kyc_profiles").doc(userId);
  const existing = await profileRef.get();
  const existingSessionId = existing.data()?.kycSessionId as string | undefined;
  if (existingSessionId) {
    const previous = await stripe.identity.verificationSessions.retrieve(existingSessionId);
    if (previous.status === "verified") {
      await syncVerificationSession(previous, "identity.verification_session.verified");
      return { sessionId: previous.id, provider, status: "verified" };
    }
    if (previous.status === "requires_input" && previous.url) {
      return { sessionId: previous.id, provider, redirectUrl: previous.url, status: previous.status };
    }
  }

  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    provided_details: {
      email,
    },
    metadata: {
      userId,
      countryOfResidence: data.countryOfResidence,
      documentType: data.documentType,
    },
    return_url: `${appBaseUrl}/verification?verification-return=1`,
  } as any, { idempotencyKey: `identity-${userId}-${new Date().toISOString().slice(0, 10)}` });

  const now = admin.firestore.FieldValue.serverTimestamp();
  const profilePayload = {
    userId,
    email,
    countryOfResidence: data.countryOfResidence,
    documentType: data.documentType,
    kycStatus: "pending",
    kycProvider: provider,
    kycSessionId: session.id,
    kycSubmittedAt: now,
    kycVerifiedAt: null,
    kycRejectionReason: null,
    updatedAt: now,
    createdAt: now,
  };

  await profileRef.set(profilePayload, { merge: true });
  await admin.firestore().collection("users").doc(userId).set({
    kycStatus: "pending",
    kycProvider: provider,
    kycSessionId: session.id,
    kycSubmittedAt: now,
    kycVerifiedAt: null,
    kycRejectionReason: null,
    updatedAt: now,
  }, { merge: true });

  return {
    sessionId: session.id,
    provider,
    redirectUrl: (session as any).url,
    clientSecret: session.client_secret,
  };
});

export const refreshKycStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Auth required");
  assertStripeConfigured();

  const userId = request.auth.uid;
  const profile = await admin.firestore().collection("kyc_profiles").doc(userId).get();
  const sessionId = profile.data()?.kycSessionId as string | undefined;
  if (!sessionId) return { status: "not_started" };

  const session = await stripe.identity.verificationSessions.retrieve(sessionId);
  const eventType = session.status === "verified"
    ? "identity.verification_session.verified"
    : session.status === "requires_input"
      ? "identity.verification_session.requires_input"
      : "identity.verification_session.processing";
  await syncVerificationSession(session, eventType);
  return { status: session.status, reason: session.last_error?.reason || null };
});

export const stripeIdentityWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  if (!stripeIdentityWebhookSecret) { res.status(500).send("Stripe Identity webhook secret is not configured"); return; }

  const signature = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeIdentityWebhookSecret);
  } catch (err: any) {
    console.error("[Stripe Identity Webhook] Signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type.startsWith("identity.verification_session.")) {
    const session = event.data.object as Stripe.Identity.VerificationSession;
    await syncVerificationSession(session, event.type);
  }

  res.status(200).json({ received: true });
});

async function syncVerificationSession(session: Stripe.Identity.VerificationSession, eventType: string) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.warn(`[Stripe Identity Webhook] Missing userId metadata for session ${session.id}`);
    return;
  }

  const payload: Record<string, unknown> = {
    kycProvider: "stripe_identity",
    kycSessionId: session.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (eventType === "identity.verification_session.verified" || session.status === "verified") {
    payload.kycStatus = "verified";
    payload.kycVerifiedAt = admin.firestore.FieldValue.serverTimestamp();
    payload.kycRejectionReason = null;
  } else if (eventType === "identity.verification_session.requires_input") {
    payload.kycStatus = "rejected";
    payload.kycVerifiedAt = null;
    payload.kycRejectionReason = session.last_error?.reason || "Verification requires additional input";
  } else {
    payload.kycStatus = "pending";
  }

  await admin.firestore().collection("users").doc(userId).set(payload, { merge: true });
  await admin.firestore().collection("kyc_profiles").doc(userId).set(payload, { merge: true });
}

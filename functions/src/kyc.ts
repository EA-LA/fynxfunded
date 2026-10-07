import { nativeCustomer } from "./nativeCustomer";
import { requireFundedMfa } from "./fundedMfa";
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

const identityKey = defineSecret("STRIPE_IDENTITY_SECRET_KEY");
const webhookKey = defineSecret("STRIPE_IDENTITY_WEBHOOK_SECRET");
const options = { region: "us-central1", invoker: "public" as const, secrets: [identityKey], maxInstances: 10 };
const documentTypes = ["passport", "driving_license", "id_card"] as const;
const documentMap = { passport: "passport", drivers_license: "driving_license", national_id: "id_card" } as const;

function stripeClient() {
  const key = identityKey.value();
  if (!/^(sk|rk)_live_/.test(key) && process.env.FUNCTIONS_EMULATOR !== "true") {
    throw new HttpsError("failed-precondition", "Identity verification is awaiting live Stripe activation. Please contact support.");
  }
  if (!key) throw new HttpsError("failed-precondition", "Stripe Identity is not configured.");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

function validateInput(data: unknown) {
  if (!data || typeof data !== "object") throw new HttpsError("invalid-argument", "Choose your country and document type.");
  const input = data as Record<string, unknown>;
  if (input.provider && input.provider !== "stripe_identity") throw new HttpsError("invalid-argument", "Unsupported identity provider.");
  if (typeof input.countryOfResidence !== "string" || !input.countryOfResidence.trim() || input.countryOfResidence.length > 100) {
    throw new HttpsError("invalid-argument", "Choose your country of residence.");
  }
  if (typeof input.documentType !== "string" || !Object.hasOwnProperty.call(documentMap, input.documentType)) {
    throw new HttpsError("invalid-argument", "Choose a supported document type.");
  }
  return { countryOfResidence: input.countryOfResidence.trim(), documentType: input.documentType as keyof typeof documentMap };
}

function assertOwner(session: Stripe.Identity.VerificationSession, uid: string) {
  if (session.metadata?.userId !== uid || session.metadata?.platform !== "fynx_funded") {
    throw new HttpsError("failed-precondition", "This verification session cannot be used. Please contact support.");
  }
}

function sessionResult(session: Stripe.Identity.VerificationSession) {
  return { sessionId: session.id, provider: "stripe_identity", status: session.status, redirectUrl: session.url || undefined };
}

async function createKyc(request: import("firebase-functions/v2/https").CallableRequest) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to verify your identity.");
  await requireFundedMfa(request);
  const input = validateInput(request.data);
  const stripe = stripeClient();
  const uid = request.auth.uid;
  const db = admin.firestore();
  const profileRef = db.doc(`kyc_profiles/${uid}`);
  const existing = await profileRef.get();
  const previousId = existing.data()?.kycSessionId as string | undefined;
  if (previousId) {
    const previous = await stripe.identity.verificationSessions.retrieve(previousId);
    assertOwner(previous, uid);
    if (previous.status !== "canceled") {
      await syncVerificationSession(previous);
      if (previous.status === "requires_input" && !previous.url) throw new HttpsError("unavailable", "The verification link is unavailable. Please try again.");
      return sessionResult(previous);
    }
  }

  // Reserve one stable attempt, including its parameters, before contacting Stripe.
  // Retries and concurrent clicks reuse it, including after an interrupted write.
  const attempt = await db.runTransaction(async tx => {
    const snap = await tx.get(profileRef);
    const profile = snap.data() || {};
    if (profile.kycSessionId && profile.kycSessionId !== previousId) throw new HttpsError("aborted", "Verification has changed. Please retry.");
    if (profile.creationAttempt?.previousId === (previousId || "")) return profile.creationAttempt;
    const reserved = { id: randomUUID(), previousId: previousId || "", ...input, email: request.auth!.token.email || "" };
    tx.set(profileRef, { userId: uid, creationAttempt: reserved }, { merge: true });
    return reserved;
  });
  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    provided_details: attempt.email ? { email: attempt.email } : undefined,
    options: { document: {
      allowed_types: [documentMap[attempt.documentType as keyof typeof documentMap]] as typeof documentTypes[number][],
      require_matching_selfie: true,
      require_live_capture: true,
    } },
    metadata: { userId: uid, platform: "fynx_funded", countryOfResidence: attempt.countryOfResidence, documentType: attempt.documentType },
    return_url: "https://www.fynxfunded.com/verification?verification-return=1",
  }, { idempotencyKey: `funded-identity-${uid}-${attempt.id}` });

  await db.runTransaction(async tx => {
    const snap = await tx.get(profileRef);
    if (snap.data()?.kycSessionId === session.id) return;
    if (snap.data()?.creationAttempt?.id !== attempt.id) throw new HttpsError("aborted", "Verification has changed. Please retry.");
    const now = admin.firestore.FieldValue.serverTimestamp();
    const payload = { kycStatus: "pending", kycProvider: "stripe_identity", kycSessionId: session.id,
      kycSubmittedAt: now, kycVerifiedAt: null, kycRejectionReason: null, updatedAt: now };
    tx.set(profileRef, { ...payload, userId: uid, countryOfResidence: attempt.countryOfResidence,
      documentType: attempt.documentType, ...(snap.data()?.createdAt ? {} : { createdAt: now }) }, { merge: true });
    tx.set(db.doc(`users/${uid}`), payload, { merge: true });
  });
  if (!session.url) throw new HttpsError("unavailable", "The verification link is unavailable. Please try again.");
  return sessionResult(session);
}
export const createKycSession = onCall(options, createKyc);

export const fundedMobileIdentity = onCall(options, async request => {
  await nativeCustomer(request);
  const result = await createKyc(request);
  if (result.status !== "requires_input") return { sessionId: result.sessionId, status: result.status };
  const key = await stripeClient().ephemeralKeys.create({ verification_session: result.sessionId }, { apiVersion: "2022-11-15" });
  if (!key.secret) throw new HttpsError("unavailable", "Verification is unavailable. Please retry.");
  return { sessionId: result.sessionId, status: result.status, ephemeralKeySecret: key.secret };
});

export const refreshKycStatus = onCall(options, async request => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to check verification.");
  await requireFundedMfa(request);
  const stripe = stripeClient();
  const profile = await admin.firestore().doc(`kyc_profiles/${request.auth.uid}`).get();
  const sessionId = profile.data()?.kycSessionId;
  if (!sessionId) return { status: "not_started", reason: null };
  const session = await stripe.identity.verificationSessions.retrieve(sessionId);
  assertOwner(session, request.auth.uid);
  await syncVerificationSession(session);
  return { status: session.status, reason: session.last_error?.reason || null };
});

export const stripeIdentityWebhook = onRequest({ ...options, secrets: [identityKey, webhookKey] }, async (req, res) => {
  if (req.method !== "POST") { res.set("Allow", "POST"); res.status(405).send("Method not allowed"); return; }
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") { res.status(400).send("Missing Stripe signature"); return; }
  // Signature verification does not make an API request or require a live API key.
  const verifier = new Stripe(identityKey.value(), { apiVersion: "2023-10-16" });
  let event: Stripe.Event;
  try { event = verifier.webhooks.constructEvent(req.rawBody, signature, webhookKey.value()); }
  catch { res.status(400).send("Invalid Stripe signature"); return; }
  // Sandbox events must never verify production accounts.
  if (!event.livemode || !event.type.startsWith("identity.verification_session.")) {
    res.status(200).json({ received: true, ignored: true }); return;
  }
  try {
    const object = event.data.object as Stripe.Identity.VerificationSession;
    if (object.metadata?.platform !== "fynx_funded" || !object.metadata?.userId) {
      res.status(200).json({ received: true, ignored: true }); return;
    }
    // Fetch current state so delayed/replayed events cannot roll back a decision.
    const current = await stripeClient().identity.verificationSessions.retrieve(object.id);
    await syncVerificationSession(current);
    res.status(200).json({ received: true });
  } catch {
    console.error("Stripe Identity synchronization failed", { eventId: event.id });
    res.status(500).send("Unable to synchronize verification; retry delivery");
  }
});

async function syncVerificationSession(session: Stripe.Identity.VerificationSession) {
  const uid = session.metadata?.userId;
  if (!uid || session.metadata?.platform !== "fynx_funded" || (!session.livemode && process.env.FUNCTIONS_EMULATOR !== "true")) return;
  const db = admin.firestore();
  await db.runTransaction(async tx => {
    const ref = db.doc(`kyc_profiles/${uid}`);
    const snap = await tx.get(ref);
    const profile = snap.data();
    // A shared Stripe account or old session cannot overwrite another active attempt.
    if (!profile || profile.kycSessionId !== session.id) return;
    const redacted = session.redaction?.status === "redacted";
    if (profile.kycStatus === "verified" && !redacted) return;
    const status = redacted || session.status === "canceled" ? "not_started"
      : session.status === "verified" ? "verified"
      : session.status === "requires_input" && session.last_error ? "rejected" : "pending";
    const now = admin.firestore.FieldValue.serverTimestamp();
    const payload = { kycProvider: "stripe_identity", kycSessionId: session.id, kycStatus: status,
      kycVerifiedAt: status === "verified" ? (profile.kycVerifiedAt || now) : null,
      kycRejectionReason: status === "rejected" ? session.last_error?.reason || "Please retry verification." : null,
      updatedAt: now };
    tx.set(ref, payload, { merge: true });
    tx.set(db.doc(`users/${uid}`), payload, { merge: true });
  });
}

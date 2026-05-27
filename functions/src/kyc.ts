import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const createKycSession = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Auth required");
  const { userId, provider } = request.data as { userId: string; provider: string };
  if (request.auth.uid !== userId) throw new HttpsError("permission-denied", "Invalid user");
  const sessionId = `stripe_identity_placeholder_${Date.now()}`;
  await admin.firestore().collection("users").doc(userId).set({
    kycStatus: "pending",
    kycProvider: provider || "stripe_identity",
    kycSessionId: sessionId,
    kycSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { sessionId, provider: provider || "stripe_identity" };
});

export const stripeIdentityWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  // TODO: verify Stripe signature and parse event
  const { userId, status, rejectionReason } = req.body || {};
  if (!userId) { res.status(400).send("Missing userId"); return; }

  const payload: Record<string, unknown> = {
    kycStatus: status === "verified" ? "verified" : status === "rejected" ? "rejected" : "pending",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (status === "verified") payload.kycVerifiedAt = admin.firestore.FieldValue.serverTimestamp();
  if (status === "rejected") payload.kycRejectionReason = rejectionReason || "Rejected by provider";

  await admin.firestore().collection("users").doc(userId).set(payload, { merge: true });
  await admin.firestore().collection("kyc_profiles").doc(userId).set(payload, { merge: true });

  res.status(200).json({ ok: true });
});

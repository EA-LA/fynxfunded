import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { nativeCustomer } from "./nativeCustomer";
import { exportFundedData } from "./fundedDataExport";

export const fundedPrivacy = onCall({ region: "us-central1", maxInstances: 5, timeoutSeconds: 120 }, async request => {
  const uid = await nativeCustomer(request);
  const db = admin.firestore();
  if (request.data?.action === "export") {
    const authTime = Number(request.auth?.token.auth_time);
    if (!Number.isFinite(authTime) || authTime > Date.now() / 1000 + 30 || Date.now() / 1000 - authTime > 300) throw new HttpsError("unauthenticated", "Sign in again before downloading account data.");
    try { return await exportFundedData(db, uid); }
    catch (error) { throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Export requires Support review."); }
  }
  const ref = db.doc(`funded_privacy_requests/${uid}`);
  if (request.data?.action === "status") {
    const row = (await ref.get()).data();
    return { status: row?.status ?? "none", requestedAt: row?.requestedAt ?? null, scope: "FYNX Funded only" };
  }
  if (request.data?.action !== "request_deletion" || request.data?.confirmScope !== "FYNX Funded only") throw new HttpsError("invalid-argument", "Confirm the Funded-only deletion request.");
  return db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    if (previous) return { status: previous.status, requestedAt: previous.requestedAt, scope: "FYNX Funded only" };
    const requestedAt = new Date().toISOString();
    tx.create(ref, { userId: uid, status: "pending_review", requestedAt, scope: "FYNX Funded only", retentionReviewRequired: true });
    tx.create(db.collection("audit_logs").doc(), { userId: uid, action: "funded_deletion_requested", createdAt: requestedAt });
    return { status: "pending_review", requestedAt, scope: "FYNX Funded only" };
  });
});

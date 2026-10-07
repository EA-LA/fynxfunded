import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { requireFundedMfa } from "./fundedMfa";
import { text, requestId, documentId, cents, payoutAllowed } from "./nativeCustomerPolicy";

export async function nativeCustomer(request: CallableRequest): Promise<string> {
  if (!request.auth || request.auth.token.email_verified !== true) throw new HttpsError("unauthenticated", "Sign in with a verified email to continue.");
  const uid = request.auth.uid;
  const user = await admin.auth().getUser(uid);
  if (user.disabled || !Number.isFinite(Number(request.auth.token.auth_time)) || Number(request.auth.token.auth_time) < Date.parse(user.tokensValidAfterTime ?? "") / 1000) throw new HttpsError("unauthenticated", "Sign in again to continue.");
  const db = admin.firestore();
  const rollout = await db.doc("funded_mfa_rollout/current").get();
  if (rollout.data()?.ready !== true) {
    const [profile, security] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`users/${uid}/security/settings`).get()]);
    if (profile.data()?.twoFactorEnabled === true || security.data()?.twoFactorEnabled === true) throw new HttpsError("failed-precondition", "Server two-factor verification must be activated before continuing.");
  }
  await requireFundedMfa(request);
  return uid;
}

export const fundedCustomerAction = onCall({ region: "us-central1", maxInstances: 10 }, async request => {
  const uid = await nativeCustomer(request);
  const db = admin.firestore(); const data = request.data ?? {}; const action = data.action;
  if (action === "profile") {
    const name = text(data.displayName, "Display name", 2, 80);
    const nickname = text(data.nickname ?? "", "Nickname", 0, 40);
    const country = text(data.country, "Country", 2, 100);

    await db.runTransaction(async tx => {
      const ref = db.doc(`users/${uid}`); const snapshot = await tx.get(ref); const old = snapshot.data() ?? {};
      if (country !== old.country && !/^[A-Z]{2}$/.test(country)) throw new HttpsError("invalid-argument", "Select a country.");
      if (old.nickname && old.nickname !== nickname) throw new HttpsError("failed-precondition", "Your nickname is already set. Contact support to change it.");
      if (["verified", "pending"].includes(old.kycStatus) && old.country && old.country !== country) throw new HttpsError("failed-precondition", "Contact support to change your verified country.");
      tx.set(ref, { displayName: name, nickname, country, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    return { saved: true };
  }
  const id = requestId(data.requestId);
  if (action === "payout") {
    const accountID = documentId(data.accountId); const amountCents = cents(data.amount);
    const method = text(data.method, "Payout method", 1, 30);
    if (!["Bank Card", "Crypto (USDT)", "Crypto (BTC)", "Crypto (ETH)"].includes(method)) throw new HttpsError("invalid-argument", "Unsupported payout method.");
    const fingerprint = createHash("sha256").update(JSON.stringify([accountID, amountCents, method])).digest("hex");
    const ref = db.doc(`payouts/${uid}_${id}`);
    await db.runTransaction(async tx => {
      const prior = await tx.get(ref);
      if (prior.exists) {
        if (prior.data()?.userId !== uid || prior.data()?.requestFingerprint !== fingerprint) throw new HttpsError("already-exists", "This request reference has different details. Refresh and try again.");
        return;
      }
      const account = (await tx.get(db.doc(`accounts/${accountID}`))).data();
      if (!account || account.userId !== uid) throw new HttpsError("permission-denied", "Account unavailable.");
      const challengeID = documentId(account.challengeId);
      const [profile, challenge, existing] = await Promise.all([
        tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`challenges/${challengeID}`)),
        tx.get(db.collection("payouts").where("userId", "==", uid).where("accountId", "==", accountID))
      ]);
      payoutAllowed(uid, profile.data() ?? {}, account, challenge.data() ?? {}, amountCents, Date.now());
      if (existing.docs.some(p => ["requested", "approved", "processing"].includes(p.data().status))) throw new HttpsError("failed-precondition", "An active payout request already exists for this account.");
      const currency = String(account.currency ?? challenge.data()?.currency ?? "USD").toUpperCase();
      tx.create(ref, { userId: uid, accountId: accountID, challengeId: challengeID, amount: amountCents / 100, amountCents, currency, method, status: "requested", reviewRequired: true, requestFingerprint: fingerprint, requestedAt: new Date().toISOString(), createdAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { requestId: ref.id, status: "requested" };
  }
  if (action === "ticketCreate") {
    const subject = text(data.subject, "Subject", 3, 160); const message = text(data.message, "Message", 1, 5000);
    const category = text(data.category, "Category", 1, 60);
    const ref = db.doc(`tickets/${uid}_${id}`);
    await db.runTransaction(async tx => {
      const prior = await tx.get(ref);
      if (prior.exists) {
        if (prior.data()?.subject !== subject || prior.data()?.messages?.[0]?.content !== message || prior.data()?.category !== category) throw new HttpsError("already-exists", "Request reference already used with different details.");
        return;
      }
      tx.create(ref, { userId: uid, subject, category, priority: "medium", status: "open", createdAt: new Date().toISOString(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), messages: [{ id, sender: "user", content: message, timestamp: new Date().toISOString() }] });
    });
    return { ticketId: ref.id };
  }
  if (action === "ticketReply" || action === "ticketClose") {
    const ticketID = documentId(data.ticketId);
    const message = action === "ticketReply" ? text(data.message, "Message", 1, 5000) : "";
    const ref = db.doc(`tickets/${ticketID}`);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref); const ticket = snap.data();
      if (!ticket || ticket.userId !== uid) throw new HttpsError("permission-denied", "Conversation unavailable.");
      const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
      const previous = messages.find(m => m.id === id);
      if (previous) {
        if (previous.content !== message) throw new HttpsError("already-exists", "Reply reference already used. Refresh the conversation.");
        return;
      }
      if (action === "ticketReply") {
        if (JSON.stringify(messages).length + message.length > 500000) throw new HttpsError("resource-exhausted", "This conversation is full. Open a new support request.");
        messages.push({ id, sender: "user", content: message, timestamp: new Date().toISOString() });
      }
      tx.update(ref, { ...(action === "ticketReply" ? { messages } : {}), status: action === "ticketClose" ? "closed" : "open", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { saved: true };
  }
  throw new HttpsError("invalid-argument", "Unknown customer action.");
});

import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { nativeCustomer } from "./nativeCustomer";
import { documentId } from "./nativeCustomerPolicy";
import { changedNotice, eventKey, pushMessage } from "./fundedNotificationPolicy";

export const fundedNotifications = onCall({ region: "us-central1", maxInstances: 10 }, async request => {
  const db = admin.firestore(), data = request.data ?? {};
  // Removing one's own delivery token must also work after an MFA proof expires.
  if (data.action === "unregister" && !request.auth) throw new HttpsError("unauthenticated", "Sign in again.");
  const uid = data.action === "unregister" ? request.auth!.uid : await nativeCustomer(request);
  const inbox = db.collection(`funded_notice_inboxes/${uid}/items`);
  if (data.action === "inbox") {
    const [items, config] = await Promise.all([inbox.orderBy("createdAt", "desc").limit(100).get(), db.doc("funded_notifications_config/current").get()]);
    return { pushAvailable: config.data()?.enabled === true, items: items.docs.map(d => { const n = d.data(); return { id: d.id, accountID: n.accountID, kind: n.kind, titleKey: n.titleKey, createdAt: n.createdAt.toMillis(), read: n.read === true }; }) };
  }
  if (data.action === "read") {
    if (!Array.isArray(data.ids) || data.ids.length > 100) throw new HttpsError("invalid-argument", "Choose up to 100 updates.");
    const refs = data.ids.map((id: unknown) => inbox.doc(documentId(id)));
    if (refs.length) await db.runTransaction(async tx => { const snapshots = await Promise.all(refs.map((ref: any) => tx.get(ref))); for (const snapshot of snapshots) if (snapshot.exists) tx.update(snapshot.ref, { read: true }); });
    return { saved: true };
  }
  if (!["register", "unregister"].includes(data.action) || typeof data.token !== "string" || !/^[A-Za-z0-9_:-]{20,4096}$/.test(data.token)) throw new HttpsError("invalid-argument", "A valid device token is required.");
  const ref = db.doc(`funded_push_devices/${eventKey(data.token)}`);
  if (data.action === "unregister") {
    await db.runTransaction(async tx => { const prior = await tx.get(ref); if (prior.data()?.userId === uid) tx.delete(ref); });
  } else {
    if (data.enabled !== true) throw new HttpsError("invalid-argument", "Enable account notifications first.");
    await ref.set({ userId: uid, token: data.token, enabled: true, authTime: request.auth!.token.auth_time, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  return { saved: true };
});

export async function recordAccountUpdate(collection: string, event: any) {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  const notice = changedNotice(collection, event.params.id, before, after);
  if (!notice) return;
  const db = admin.firestore(), id = eventKey(event.id), ref = db.doc(`funded_notice_inboxes/${notice.userId}/items/${id}`);
  const createdAt = admin.firestore.Timestamp.fromDate(new Date(event.time));
  const shouldSend = await db.runTransaction(async tx => {
    const [prior, latest, config] = await Promise.all([tx.get(ref), tx.get(event.data.after.ref as FirebaseFirestore.DocumentReference), tx.get(db.doc("funded_notifications_config/current"))]);
    if (prior.exists) return false;
    // Discard a delayed trigger if a newer source update already superseded it.
    const current = changedNotice(collection, event.params.id, before, latest.data());
    if (!current || current.userId !== notice.userId || current.fingerprint !== notice.fingerprint) return false;
    const enabled = config.data()?.enabled === true && Date.now() - createdAt.toMillis() < 3600000;
    tx.create(ref, { ...notice, createdAt, read: false, pushStatus: enabled ? "claimed" : "disabled" });
    return enabled;
  });
  if (!shouldSend) return;
  // At-most-once attempt per event. A crash after claim remains visible as unconfirmed;
  // we never claim exactly-once APNs delivery or retry an ambiguous successful send.
  const registrations = await db.collection("funded_push_devices").where("userId", "==", notice.userId).limit(100).get();
  const user = await admin.auth().getUser(notice.userId);
  const validAfter = Date.parse(user.tokensValidAfterTime || "") / 1000;
  const devices = registrations.docs.filter(d => { const r = d.data(); return !user.disabled && r.enabled === true && typeof r.token === "string" && r.updatedAt?.toMillis() > Date.now() - 30 * 86400000 && Number.isFinite(r.authTime) && (!Number.isFinite(validAfter) || r.authTime >= validAfter); });
  if (!devices.length) { await ref.update({ pushStatus: "no_devices" }); return; }
  try {
    const result = await admin.messaging().sendEach(devices.map(d => pushMessage(d.data().token, id)));
    await Promise.all(result.responses.map(async (response, index) => {
      if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(response.error?.code || "")) {
        const device = devices[index];
        await db.runTransaction(async tx => { const current = await tx.get(device.ref); if (current.data()?.userId === notice.userId && current.data()?.token === device.data().token) tx.delete(device.ref); });
      }
    }));
    await ref.update({ pushStatus: result.failureCount ? "partially_accepted" : "accepted", accepted: result.successCount, failed: result.failureCount });
  } catch { await ref.update({ pushStatus: "unconfirmed" }); }
}
export const fundedAccountUpdated = onDocumentWritten({ document: "accounts/{id}", region: "us-central1", maxInstances: 10 }, event => recordAccountUpdate("accounts", event));
export const fundedChallengeUpdated = onDocumentWritten({ document: "challenges/{id}", region: "us-central1", maxInstances: 10 }, event => recordAccountUpdate("challenges", event));
export const fundedPayoutUpdated = onDocumentWritten({ document: "payouts/{id}", region: "us-central1", maxInstances: 10 }, event => recordAccountUpdate("payouts", event));

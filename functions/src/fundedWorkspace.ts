import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { nativeCustomer } from "./nativeCustomer";
import { documentId, text } from "./nativeCustomerPolicy";
import { published, verifiedDestination, millis, assertBookable, safeDestination } from "./fundedWorkspacePolicy";

const clean = (value: any): any => value == null ? null : typeof value?.toMillis === "function" ? value.toMillis() : Array.isArray(value) ? value.map(clean) : typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, clean(v)])) : value;
const pick = (data: any, keys: string[]) => Object.fromEntries(keys.filter(k => data[k] !== undefined).map(k => [k,clean(data[k])]));
const certKeys = ["type", "traderName", "challengeType", "accountSize", "issuedAt", "passedDate", "fundedDate", "profitSplit", "payoutAmount", "milestoneName", "status", "publicVerificationId"];
export const fundedWorkspace = onCall({ region: "us-central1", maxInstances: 10 }, async request => {
  const uid = await nativeCustomer(request); const data = request.data ?? {}; const db = admin.firestore();
  const ownList = async (collection: string) => (await db.collection(collection).where("userId", "==", uid).limit(200).get()).docs;
  const catalog = async (collection: string) => (await db.collection(collection).where("status", "==", "published").limit(200).get()).docs.filter(d => published(d.data()));
  if (data.action === "documents") {
    const [contracts, orders] = await Promise.all([ownList("contracts"), ownList("orders")]);
    return { items: [
      ...contracts.filter(d => ["issued", "signed"].includes(d.data().status)).map(d => ({ id: d.id, kind: "contract", ...pick(d.data(), ["title", "version", "issuedAt", "status", "orderId"]) })),
      ...orders.filter(d => d.data().purchasedRules?.document).map(d => ({ id: d.id, kind: "rules", title: "Purchased numerical rules", version: d.data().purchasedRules.document.policy_version, issuedAt: d.data().purchasedRules.accepted_at, status: "recorded" }))
    ], limit: 200 };
  }
  if (data.action === "document") {
    const id = documentId(data.id);
    if (data.kind === "rules") {
      const doc = (await db.doc(`orders/${id}`).get()).data(); const rules = doc?.purchasedRules;
      if (!doc || doc.userId !== uid || !rules?.document || rules.uid !== uid) throw new HttpsError("not-found", "Document unavailable.");
      if (createHash("sha256").update(JSON.stringify(rules.document)).digest("hex") !== rules.document_sha256) throw new HttpsError("failed-precondition", "This document needs review. Please contact Support.");
      return { title: "Purchased numerical rules", scope: "Numerical rules", reference: id, acceptedAt: rules.accepted_at, sha256: rules.document_sha256, document: clean(rules.document) };
    }
    const contract = (await db.doc(`contracts/${id}`).get()).data();
    if (!contract || contract.userId !== uid || !["issued", "signed"].includes(contract.status)) throw new HttpsError("not-found", "Contract unavailable.");
    const path = contract.storagePath;
    if (typeof path !== "string" || !path.startsWith(`contracts/${uid}/`) || path.includes("..") || typeof contract.sha256 !== "string") throw new HttpsError("failed-precondition", "The contract file needs review. Contact Support.");
    const file = admin.storage().bucket().file(path); const [metadata] = await file.getMetadata();
    if (!Number.isFinite(Number(metadata.size)) || Number(metadata.size) > 4 * 1024 * 1024 || Number(metadata.size) < 5) throw new HttpsError("failed-precondition", "This document cannot be opened in the app. Contact Support.");
    const [bytes] = await file.download({ validation: "crc32c" });
    if (bytes.length > 4 * 1024 * 1024 || bytes.subarray(0,5).toString() !== "%PDF-" || createHash("sha256").update(bytes).digest("hex") !== contract.sha256) throw new HttpsError("data-loss", "The document couldn't be verified. Contact Support.");
    return { title: contract.title || "Contract", reference: id, pdf: bytes.toString("base64") };
  }
  if (data.action === "certificates") return { items: (await ownList("certificates")).map(d => ({ id: d.id, ...pick(d.data(), certKeys) })) };
  if (data.action === "verifyCertificate") {
    const id = documentId(data.id); const own = (await db.doc(`certificates/${id}`).get()).data();
    if (!own || own.userId !== uid) throw new HttpsError("not-found", "Certificate unavailable.");
    const publicID = documentId(own.publicVerificationId || id); const publicRecord = (await db.doc(`public_certificates/${publicID}`).get()).data();
    const valid = own.status === "issued" && publicRecord?.status === "issued" && publicRecord.type === own.type && publicRecord.publicVerificationId === publicID;
    return { valid, checkedAt: Date.now(), id, ...pick(own, certKeys), verificationURL: `https://fynxfunded.com/certificates/verify/${encodeURIComponent(publicID)}` };
  }
  if (data.action === "leaderboard") {
    const settings = (await db.doc(`funded_leaderboard_consent/${uid}`).get()).data();
    // Published snapshots contain no account IDs, emails or private performance fields.
    const snapshot = (await db.doc("funded_leaderboard/current").get()).data();
    const consent = await db.collection("funded_leaderboard_consent").where("enabled", "==", true).limit(1000).get();
    const allowed = new Map(consent.docs.map(d => [d.id, d.data().displayName]));
    const fresh = snapshot?.status === "published" && Number.isFinite(millis(snapshot.verifiedAt)) && millis(snapshot.verifiedAt) <= Date.now() && Date.now() - millis(snapshot.verifiedAt) <= 7 * 86400000 && snapshot.verifiedBy;
    const entries = fresh && Array.isArray(snapshot.entries) ? snapshot.entries.filter((e:any) => allowed.has(e.userId) && Number.isFinite(e.value)).slice(0,100).map((e:any, index:number) => ({ id: String(index + 1), rank: index + 1, name: allowed.get(e.userId), value: e.value, isYou: e.userId === uid })) : [];
    return { entries, title: fresh ? snapshot.title : "Leaderboard", metric: fresh ? snapshot.metric : "", period: fresh ? snapshot.period : "", verifiedAt: fresh ? clean(snapshot.verifiedAt) : null, enabled: settings?.enabled === true, displayName: settings?.displayName || "" };
  }
  if (data.action === "leaderboardConsent") {
    if (typeof data.enabled !== "boolean") throw new HttpsError("invalid-argument", "Choose your visibility.");
    const name = data.enabled ? text(data.displayName, "Public display name", 2, 40) : "";
    if (name.includes("@")) throw new HttpsError("invalid-argument", "Use a public nickname rather than an email address.");
    await db.doc(`funded_leaderboard_consent/${uid}`).set({ enabled: data.enabled, displayName: name, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { saved: true };
  }
  if (data.action === "premium") {
    const member = (await db.doc(`funded_memberships/${uid}`).get()).data();
    if (member?.status === "active" && member.expiresAt && (!Number.isFinite(millis(member.expiresAt)) || millis(member.expiresAt) <= Date.now())) member.status = "expired";
    const application = (await db.doc(`funded_membership_requests/${uid}`).get()).data();
    return { request: application ? pick(application, ["planId", "status", "createdAt"]) : null, items: (await catalog("funded_premium_plans")).map(d => ({ id: d.id, ...pick(d.data(), ["title", "description", "benefits", "terms", "enrollmentMode"]) })), membership: member ? pick(member, ["planId", "status", "startsAt", "expiresAt"]) : null };
  }
  if (data.action === "premiumRequest") {
    const id = documentId(data.id); const ref = db.doc(`funded_membership_requests/${uid}`);
    await db.runTransaction(async tx => {
      const [plan, member, existing] = await Promise.all([tx.get(db.doc(`funded_premium_plans/${id}`)), tx.get(db.doc(`funded_memberships/${uid}`)), tx.get(ref)]);
      if (!published(plan.data()) || plan.data()?.enrollmentMode !== "request" || data.acceptTerms !== true || data.terms !== plan.data()?.terms) throw new HttpsError("failed-precondition", "Review the current membership terms before requesting access.");
      if (member.data()?.status === "active" && (!member.data()?.expiresAt || millis(member.data()?.expiresAt) > Date.now())) throw new HttpsError("already-exists", "You already have an active membership.");
      if (existing.data()?.status === "requested") { if (existing.data()?.planId !== id) throw new HttpsError("already-exists", "A membership request is already in review."); return; }
      tx.set(ref, { userId: uid, planId: id, status: "requested", acceptedTerms: data.terms, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }); return { status: "requested" };
  }
  if (data.action === "coaching") return {
    items: (await catalog("funded_coaching_slots")).filter(d => millis(d.data().startAt) > Date.now() && d.data().priceCents === 0).map(d => ({ id: d.id, ...pick(d.data(), ["title", "coach", "description", "startAt", "endAt", "capacity", "booked", "premiumOnly", "cancellationMinutes"]) })),
    bookings: (await ownList("funded_coaching_bookings")).map(d => ({ id: d.id, ...pick(d.data(), ["slotId", "title", "coach", "startAt", "endAt", "status"]) }))
  };
  if (data.action === "book" || data.action === "cancelBooking") {
    const id = documentId(data.id); const slotRef = db.doc(`funded_coaching_slots/${id}`); const bookingRef = db.doc(`funded_coaching_bookings/${uid}_${id}`);
    await db.runTransaction(async tx => {
      const [slotSnap, booking, membership] = await Promise.all([tx.get(slotRef), tx.get(bookingRef), tx.get(db.doc(`funded_memberships/${uid}`)), tx.get(db.doc(`funded_booking_locks/${uid}`))]); const slot = slotSnap.data();
      if (!slot) throw new HttpsError("not-found", "Session unavailable.");
      if (data.action === "cancelBooking") {
        if (!booking.exists || booking.data()?.userId !== uid) throw new HttpsError("not-found", "Booking unavailable.");
        if (booking.data()?.status === "canceled") return;
        if (booking.data()?.status !== "confirmed" || millis(slot.startAt) - Date.now() <= Math.max(0, Number(slot.cancellationMinutes ?? 60)) * 60000) throw new HttpsError("failed-precondition", "The cancellation window has closed. Contact Support.");
        tx.update(bookingRef, { status: "canceled", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(slotRef, { booked: Math.max(0, Number(slot.booked || 0) - 1) }); return;
      }
      if (booking.data()?.status === "confirmed") return;
      assertBookable(slot);
      const member = membership.data();
      if (slot.premiumOnly === true && (member?.status !== "active" || (member.expiresAt && (!Number.isFinite(millis(member.expiresAt)) || millis(member.expiresAt) <= Date.now())) || (member?.startsAt && (!Number.isFinite(millis(member.startsAt)) || millis(member.startsAt) > Date.now())))) throw new HttpsError("permission-denied", "This session requires an active Funded Premium membership.");
      const conflicts = await tx.get(db.collection("funded_coaching_bookings").where("userId", "==", uid).where("status", "==", "confirmed"));
      if (conflicts.docs.some(d => millis(d.data().startAt) < millis(slot.endAt) && millis(d.data().endAt) > millis(slot.startAt))) throw new HttpsError("already-exists", "You already have a booking at this time.");
      tx.set(bookingRef, { userId: uid, slotId: id, status: "confirmed", ...pick(slot, ["title", "coach", "startAt", "endAt"]), createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(slotRef, { booked: Number(slot.booked || 0) + 1 });
      // Serialize concurrent requests for different overlapping slots for this customer.
      tx.set(db.doc(`funded_booking_locks/${uid}`), { updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }); return { status: data.action === "book" ? "confirmed" : "canceled" };
  }
  if (data.action === "joinBooking") {
    const id = documentId(data.id);
    const [booking, slot] = await Promise.all([db.doc(`funded_coaching_bookings/${uid}_${id}`).get(), db.doc(`funded_coaching_slots/${id}`).get()]);
    const b = booking.data(); const s = slot.data();
    if (!b || b.userId !== uid || b.status !== "confirmed" || !s || s.status !== "published") throw new HttpsError("not-found", "Confirmed session unavailable.");
    const now = Date.now();
    if (!Number.isFinite(millis(s.startAt)) || !Number.isFinite(millis(s.endAt)) || now < millis(s.startAt) - 15 * 60000 || now > millis(s.endAt) + 30 * 60000) throw new HttpsError("failed-precondition", "You can join from 15 minutes before your appointment until 30 minutes after it ends.");
    const url = safeDestination(s.meetingURL);
    if (!url) throw new HttpsError("failed-precondition", "The coach has not published a meeting link yet. Contact Support.");
    return { url };
  }
  if (data.action === "offers" || data.action === "socials") {
    const social = data.action === "socials";
    return { items: (await catalog(social ? "funded_social_destinations" : "funded_partner_offers")).flatMap(d => {
      const value = d.data(); const url = verifiedDestination(value, social);
      return url ? [{ id: d.id, ...pick(value, ["title", "description", "terms", "code", "endsAt", "verifiedAt"]), url }] : [];
    }) };
  }
  throw new HttpsError("invalid-argument", "Unknown workspace action.");
});

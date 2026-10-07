import type { Firestore, DocumentSnapshot } from "firebase-admin/firestore";

const privateField = /password|secret|token|credential|recovery|backupcode|digest|apikey|privatekey|clientsecret|signedurl/i;
export function portableValue(value: any): any {
  if (value == null) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(portableValue);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !privateField.test(key)).map(([key, child]) => [key, portableValue(child)]));
  return value;
}

/** Explicit Funded scope: never traverse the shared Tools/API workspace or MFA stores. */
export async function exportFundedData(db: Firestore, uid: string, limit = 2000) {
  if (!/^[^/\s]{1,128}$/.test(uid) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error("Invalid export scope or limit.");
  const documents: { path: string; data: any }[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  const add = (snapshot: DocumentSnapshot, fields?: string[]) => {
    if (!snapshot.exists || seen.has(snapshot.ref.path)) return;
    const raw = snapshot.data()!;
    if (raw.userId != null && raw.userId !== uid) throw Error("Conflicting export ownership; operator review required.");
    const data = portableValue(fields ? Object.fromEntries(fields.filter(key => raw[key] !== undefined).map(key => [key, raw[key]])) : raw);
    bytes += Buffer.byteLength(JSON.stringify(data));
    if (documents.length >= limit || bytes > 4 * 1024 * 1024) throw Error("Export exceeds the online limit. Contact Support for an operator export; no partial file was returned.");
    seen.add(snapshot.ref.path); documents.push({ path: snapshot.ref.path, data });
  };
  add(await db.doc(`users/${uid}`).get(), ["displayName", "fullName", "email", "nickname", "country", "createdAt", "kycStatus", "kycProvider", "kycSubmittedAt", "kycVerifiedAt", "twoFactorEnabled", "loginAlertsEnabled"]);
  for (const name of ["funded_memberships", "funded_membership_requests", "funded_leaderboard_consent", "funded_privacy_requests"]) add(await db.doc(`${name}/${uid}`).get());
  const challenges: string[] = [];
  for (const name of ["orders", "challenges", "accounts", "trades", "payouts", "tickets", "certificates", "contracts", "funded_coaching_bookings"]) {
    const rows = await db.collection(name).where("userId", "==", uid).limit(limit + 1).get();
    for (const row of rows.docs) { add(row); if (name === "challenges") challenges.push(row.id); }
  }
  for (const challengeId of challenges) {
    for (const name of ["rule_events", "rule_evaluations", "audit_logs"]) {
      const rows = await db.collection(name).where("challengeId", "==", challengeId).limit(limit + 1).get();
      for (const row of rows.docs) add(row);
    }
  }
  return { schemaVersion: 1, scope: "FYNX Funded records", uid, exportedAt: new Date().toISOString(), documents,
    consistency: "Best-effort read of current records; not a point-in-time backup.",
    excluded: ["Passwords, security secrets and session credentials", "Shared Tools and API product data", "Firebase Authentication, Stripe-held records and identity documents", "Contract PDF file bytes (available separately in Documents)"] };
}

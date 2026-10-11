import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

const collections = new Set(["web_checkout_attempts", "orders", "challenges", "accounts", "trades", "payouts", "tickets", "certificates", "contracts", "funded_memberships", "funded_membership_requests", "funded_leaderboard_consent", "funded_coaching_bookings"]);
const openStates = new Set(["pending", "active", "requested", "approved", "processing", "open", "disputed"]);
export type RetentionDecision = { path: string; updateTime: string; action: "delete" | "retain"; reason: string };
export type DeletionPlan = { schemaVersion: 1; uid: string; requestPath: string; scope: "FYNX Funded only"; policyReference: string; reviewedBy: string; reviewedAt: string; records: RetentionDecision[] };
export type DeletionLedger = {
  // Must be durable outside the database being deleted/restored. Create-only writes, never overwrite a prior entry.
  create: (name: string, value: unknown) => Promise<void>;
};
export const planHash = (plan: DeletionPlan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");
export function validatePlan(plan: DeletionPlan) {
  if (plan.schemaVersion !== 1 || !/^[^/\s]{1,128}$/.test(plan.uid) || plan.requestPath !== `funded_privacy_requests/${plan.uid}` || plan.scope !== "FYNX Funded only"
    || !plan.policyReference?.trim() || !plan.reviewedBy?.trim() || !Number.isFinite(Date.parse(plan.reviewedAt)) || Date.parse(plan.reviewedAt) > Date.now()
    || !Array.isArray(plan.records) || !plan.records.length || plan.records.length > 400) throw Error("A reviewed, bounded Funded-only deletion plan is required.");
  const seen = new Set<string>();
  for (const row of plan.records) {
    const segments = row.path.split("/");
    if (segments.length !== 2 || !collections.has(segments[0]) || !segments[1] || seen.has(row.path) || !["delete", "retain"].includes(row.action)
      || !row.reason?.trim() || !/^\d+:\d{1,9}$/.test(row.updateTime)) throw Error("Invalid, duplicate or out-of-scope retention decision.");
    seen.add(row.path);
  }
  if (!plan.records.some(row => row.action === "delete")) throw Error("This plan has no approved deletions.");
}

/** Only exact reviewed records are eligible. The shared Firebase identity and users document are excluded. */
export async function executeDeletion(db: Firestore, ledger: DeletionLedger, plan: DeletionPlan, approvedHash: string) {
  validatePlan(plan);
  const hash = planHash(plan);
  if (approvedHash !== hash) throw Error("The approved plan hash does not match this plan.");
  for (const row of plan.records) {
    if (row.action === "delete" && (await db.doc(row.path).listCollections()).length) throw Error("Nested records require an expanded retention review; recursive deletion is not permitted.");
  }
  // If the following transaction fails, this unresolved entry blocks restoration release until reconciled.
  await ledger.create(`${hash}.prepared`, { schemaVersion: 1, hash, plan, preparedAt: new Date().toISOString() });
  const result = await db.runTransaction(async tx => {
    const requestRef = db.doc(plan.requestPath);
    const request = (await tx.get(requestRef)).data();
    if (request?.status !== "pending_review" || request.userId !== plan.uid || request.scope !== plan.scope) throw Error("Deletion request is not pending for this customer.");
    const snapshots = await Promise.all(plan.records.map(row => tx.get(db.doc(row.path))));
    for (let index = 0; index < plan.records.length; index++) {
      const row = plan.records[index], snapshot = snapshots[index], data = snapshot.data();
      if (!snapshot.exists || data?.userId !== plan.uid || `${snapshot.updateTime?.seconds}:${snapshot.updateTime?.nanoseconds}` !== row.updateTime) throw Error("A record changed or its ownership is not confirmed. Review a new plan.");
      if (row.action === "delete" && (data?.legalHold === true || data?.retentionHold === true || openStates.has(String(data?.status).toLowerCase()))) throw Error("Open records and retention holds cannot be deleted.");
    }
    // Unknown nested data requires a separate reviewed workflow, never recursive deletion by assumption.
    for (const row of plan.records) if (row.action === "delete") tx.delete(db.doc(row.path));
    const completedAt = new Date().toISOString();
    const summary = { hash, uid: plan.uid, deleted: plan.records.filter(r => r.action === "delete").length, retained: plan.records.filter(r => r.action === "retain").length, completedAt };
    tx.update(requestRef, { status: "completed", completedAt, deletionPlanHash: hash, retainedRecords: summary.retained, scope: plan.scope });
    return summary;
  });
  await ledger.create(`${hash}.completed`, { ...result, schemaVersion: 1 });
  return result;
}

export type RestoreLedger = { prepared: { hash: string; plan: DeletionPlan }; completed?: { hash: string; uid: string; deleted: number; completedAt: string } };
/** Apply current deletions to an isolated restoration before it can serve clients. */
export async function suppressRestoredDeletions(db: Firestore, entries: RestoreLedger[], target: { isolated: boolean; databaseId: string }) {
  if (db.databaseId !== target.databaseId || target.isolated !== true || !/^funded-restore-[a-z0-9-]+$/.test(target.databaseId)) throw Error("Restoration requires an isolated funded-restore-* database with clients/triggers disabled.");
  for (const entry of entries) {
    validatePlan(entry.prepared.plan);
    const hash = planHash(entry.prepared.plan);
    if (!entry.completed || entry.prepared.hash !== hash || entry.completed.hash !== hash || entry.completed.uid !== entry.prepared.plan.uid
      || entry.completed.deleted !== entry.prepared.plan.records.filter(r => r.action === "delete").length || !Number.isFinite(Date.parse(entry.completed.completedAt))) throw Error("Deletion ledger is incomplete or altered; restoration release is blocked.");
  }
  let suppressed = 0;
  for (const entry of entries) {
    const plan = entry.prepared.plan;
    suppressed += await db.runTransaction(async tx => {
      const deletes = plan.records.filter(r => r.action === "delete");
      const snapshots = await Promise.all(deletes.map(row => tx.get(db.doc(row.path))));
      for (const snapshot of snapshots) if (snapshot.exists && snapshot.data()?.userId !== plan.uid) throw Error("Restored record ownership conflict; stop recovery.");
      snapshots.forEach(snapshot => { if (snapshot.exists) tx.delete(snapshot.ref); });
      return snapshots.filter(snapshot => snapshot.exists).length;
    });
  }
  return { suppressed, ledgerEntries: entries.length, releaseApproved: false };
}

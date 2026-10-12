import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { evaluate, ruleSnapshot, validateBinding } from "./fundedPolicy";
import { bind } from "./purchasedAgreement";

const canonical = (value: any): any => value === null || typeof value !== "object" ? value : Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
export const evidenceHash = (value: any) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const version = (snapshot: any) => `${snapshot.updateTime?.seconds}:${snapshot.updateTime?.nanoseconds}`;
const id = (value: string) => { if (!/^[A-Za-z0-9_-]{1,220}$/.test(value)) throw Error("Invalid record reference."); return value; };
export type TransitionPlan = { challengeId: string; nextAccountId: string; sourceVersion: string; nextAccountVersion: string; fromPhase: number; toPhase: number; userId: string; sourceHash: string; nextPolicy: any; nextBrokerAccountId: string; eventCount: number };

/** Build the same exact plan both for human review and inside the committing transaction. */
async function readPlan(db: Firestore, tx: Transaction, challengeId: string, nextAccountId: string) {
  id(challengeId); id(nextAccountId);
  const challengeRef = db.doc(`challenges/${challengeId}`), nextRef = db.doc(`accounts/${nextAccountId}`);
  const [snapshot, nextSnapshot, history] = await Promise.all([tx.get(challengeRef), tx.get(nextRef), tx.get(db.collection("rule_events").where("challengeId", "==", challengeId).limit(201))]);
  const current = snapshot.data(), next = nextSnapshot.data();
  if (!current || !next || !current.userId || !Number.isInteger(current.currentPhase) || !["2-phase", "3-phase"].includes(current.phase)
    || current.currentPhase >= Number(current.phase[0])) throw Error("Only an existing evaluation can advance to its next purchased evaluation phase. Funding needs a separate approved workflow.");
  if (current.status === "failed" || current.ruleStatus === "failed" || current.breachRecorded || current.recordedBreach || current.rulePolicyEvaluation?.state?.breach) throw Error("A recorded breach cannot be cleared by progression.");
  const policy = current.rulePolicy, toPhase = current.currentPhase + 1;
  if (!policy || policy.policy_version !== current.rulePolicyVersion || policy.phase !== current.currentPhase || policy.program !== current.phase
    || policy.currency !== current.currency || policy.starting_balance !== String(current.accountSize) || policy.coverage?.account_id !== current.brokerAccountId) throw Error("Purchased policy binding mismatch.");
  if (!history.size || history.size > 200) throw Error("Atomic transition supports 1–200 events. Larger histories require a separately reviewed staged-archive workflow.");
  const rows = history.docs.sort((a,b)=>a.data().sequence-b.data().sequence);
  if (rows.some(row=>row.data().userId !== current.userId)) throw Error("Conflicting event ownership.");
  const events = rows.map(row=>row.data());
  const result = evaluate(policy, events);
  if (result.state.status !== "eligible" || result.state.breach || result.state.open_positions !== 0) throw Error("Reconciled complete history must be eligible and flat before phase advancement.");
  if (next.userId !== current.userId || next.challengeId !== challengeId || next.phase !== toPhase || !next.brokerAccountId
    || next.brokerAccountId === current.brokerAccountId || next.currency !== current.currency || String(next.startingBalance) !== String(current.accountSize)
    || next.provisioningStatus !== "verified" || !next.integrationReference || typeof next.activatedAt !== "string"
    || !Number.isFinite(Date.parse(next.activatedAt)) || Date.parse(next.activatedAt) < Date.parse(policy.coverage.through) || Date.parse(next.activatedAt) > Date.now()) throw Error("A distinct verified next-phase broker account and its actual activation time are required.");
  const purchase = (await tx.get(db.doc(`orders/${id(current.orderId)}`))).data();
  if (!purchase || purchase.userId !== current.userId || purchase.status !== "paid") throw Error("A paid owned purchase and its original rules are required.");
  const original = bind(purchase.purchasedRules, {uid:current.userId,order_id:current.orderId,program:current.phase,starting_balance:String(current.accountSize),start_timestamp:next.activatedAt,expected_hash:policy.agreement.document_sha256});
  const nextPolicy = {...original,phase:toPhase,agreement:{...original.agreement,rule_snapshot:ruleSnapshot({...original,phase:toPhase})},coverage:null};
  validateBinding(nextPolicy);
  const archived = {userId:current.userId,challengeId,currentPhase:current.currentPhase,phase:current.phase,accountSize:current.accountSize,currency:current.currency,brokerAccountId:current.brokerAccountId,rulePolicyVersion:current.rulePolicyVersion,rulePolicy:policy};
  const sourceHash = evidenceHash({archive:archived,events:rows.map(row=>({id:row.id,data:row.data()}))});
  const plan:TransitionPlan={challengeId,nextAccountId,sourceVersion:version(snapshot),nextAccountVersion:version(nextSnapshot),fromPhase:current.currentPhase,toPhase,userId:current.userId,sourceHash,nextPolicy,nextBrokerAccountId:next.brokerAccountId,eventCount:events.length};
  return {plan,rows,archived,result,next};
}
export async function previewPhaseTransition(db: Firestore, challengeId: string, nextAccountId: string) {
  return db.runTransaction(async tx=>{const {plan}=await readPlan(db,tx,challengeId,nextAccountId);return {plan,hash:evidenceHash(plan),authorizesTransition:false};});
}

/** Operator-only library; no client callable and no automatic trigger. Never grants funded status or a payout. */
export async function executePhaseTransition(db: Firestore, reviewedPlan: TransitionPlan, approvedHash: string, actor: string) {
  if (!actor?.trim() || approvedHash !== evidenceHash(reviewedPlan)) throw Error("An exact reviewed plan and operator identity are required.");
  return db.runTransaction(async tx=>{
    const {plan,rows,archived,result,next}=await readPlan(db,tx,reviewedPlan.challengeId,reviewedPlan.nextAccountId);
    if (evidenceHash(plan) !== approvedHash) throw Error("Evidence or account changed after review. Review a new plan.");
    const release=(await tx.get(db.doc("funded_release/current"))).data();
    const proof=release?.parallelProof;
    if (release?.progressionApproved !== true || !release.reviewedBy || !release.integrationReference || release.integrationReference !== next.integrationReference
      || proof?.sealed !== true || proof.reconciled !== true || !proof.evidenceReference || !/^[a-f0-9]{64}$/.test(proof.sha256??"")
      || !Number.isFinite(Date.parse(proof.startedAt)) || !Number.isFinite(Date.parse(proof.completedAt))
      || Date.parse(proof.completedAt)-Date.parse(proof.startedAt)<7*86400000 || Date.parse(proof.completedAt)>Date.now()) throw Error("Approved integration and reviewed seven-elapsed-day parallel evidence are required.");
    const archiveRef=db.doc(`funded_phase_archives/${plan.challengeId}/phases/${plan.fromPhase}`);
    const archive=await tx.get(archiveRef);
    if (archive.exists) throw Error("This phase is already archived. Never overwrite a sealed phase.");
    const sealedAt=new Date().toISOString();
    tx.create(archiveRef,{...archived,sealed:true,archiveSchemaVersion:1,evidenceSha256:plan.sourceHash,eventCount:rows.length,sealedAt,reviewedBy:actor,transitionPlanHash:approvedHash,evaluation:result});
    for(const row of rows){tx.create(archiveRef.collection("events").doc(row.id),row.data());tx.delete(row.ref);}
    tx.update(db.doc(`challenges/${plan.challengeId}`),{currentPhase:plan.toPhase,brokerAccountId:plan.nextBrokerAccountId,rulePolicy:plan.nextPolicy,ruleStatus:"awaiting_history",rulePolicyEvaluation:null,ruleMetrics:null,requiresHumanReview:true,status:"active",progressionMode:"manual",lastTransitionHash:approvedHash,updatedAt:sealedAt});
    tx.create(db.doc(`funded_phase_transitions/${plan.challengeId}_${plan.fromPhase}`),{...plan,approvedHash,actor,createdAt:sealedAt,authorizesPayout:false,authorizesFunding:false});
    return {advanced:true,phase:plan.toPhase,archive:archiveRef.path,authorizesPayout:false,authorizesFunding:false};
  });
}

export function verifyPhaseArchive(archive: any, rows: {id: string; data: any}[]) {
  const fields=["userId","challengeId","currentPhase","phase","accountSize","currency","brokerAccountId","rulePolicyVersion","rulePolicy"];
  const snapshot=Object.fromEntries(fields.map(key=>[key,archive[key]]));
  const events=[...rows].sort((a,b)=>a.data.sequence-b.data.sequence);
  return archive.sealed===true && archive.archiveSchemaVersion===1 && archive.eventCount===events.length
    && archive.evidenceSha256===evidenceHash({archive:snapshot,events});
}

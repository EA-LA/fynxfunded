import * as admin from "firebase-admin";
import { evaluate as evaluateVersionedPolicy } from "./fundedPolicy";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireFundedMfa } from "./fundedMfa";

const OWNER_ADMIN_EMAILS = ["ha6876122@gmail.com", "fynxteam5@gmail.com"];
type ProgressionAction = "evaluate" | "set_automatic" | "set_manual" | "pass" | "fail" | "fund";

async function evaluatePolicyChallenge(challengeId: string, challenge: FirebaseFirestore.DocumentData, source: string) {
  const db = admin.firestore(), ref = db.collection("challenges").doc(challengeId);
  const policy = challenge.rulePolicy;
  if (!policy || policy.policy_version !== challenge.rulePolicyVersion || policy.program !== challenge.phase || policy.phase !== (challenge.currentPhase ?? 1) || policy.starting_balance !== String(challenge.accountSize) || policy.currency !== challenge.currency) throw new HttpsError("failed-precondition", "Challenge and purchased policy binding do not match.");
  if (!challenge.brokerAccountId || policy.coverage?.account_id !== challenge.brokerAccountId) throw new HttpsError("failed-precondition", "History coverage does not match the connected broker account.");
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), current = snapshot.data() || {};
    if (!snapshot.exists || JSON.stringify(current.rulePolicy) !== JSON.stringify(policy) || current.rulePolicyVersion !== challenge.rulePolicyVersion || current.phase !== challenge.phase || current.currentPhase !== challenge.currentPhase || current.accountSize !== challenge.accountSize || current.currency !== challenge.currency) throw new HttpsError("aborted", "Purchased policy changed during evaluation; retry.");
    if (current.brokerAccountId !== challenge.brokerAccountId) throw new HttpsError("aborted", "Broker account changed during evaluation; retry.");
    const history = await tx.get(db.collection("rule_events").where("challengeId", "==", challengeId));
    const events = history.docs.map(doc => doc.data()).sort((a, b) => a.sequence - b.sequence);
    const recordedBreach = current.rulePolicyEvaluation?.state?.breach || current.recordedBreach;
    if ((current.status === "failed" || current.ruleStatus === "failed" || current.breachRecorded) && !recordedBreach) throw new HttpsError("failed-precondition", "Existing failure requires its original breach evidence; it cannot be cleared by migration.");
    let result;
    try { result = evaluateVersionedPolicy({ ...policy, recorded_breach: recordedBreach }, events); }
    catch (error) { throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Invalid policy history."); }
    const status = result.state.status === "breached" ? "failed" : result.state.status === "eligible" ? "passed" : "active";
    const now = admin.firestore.FieldValue.serverTimestamp();
    // This is an evaluation for human review, never a phase transition or payout.
    tx.set(ref, { ruleStatus: status, rulePolicyEvaluation: result, breachRecorded: result.state.status === "breached", requiresHumanReview: true, lastRuleEvaluationAt: now, lastRuleEvaluationSource: source }, { merge: true });
    tx.set(db.collection("rule_evaluations").doc(), { challengeId, source, status, policyVersion: result.policy_version, evaluation: result, createdAt: now });
    tx.set(db.collection("audit_logs").doc(), { challengeId, source, action: "versioned_rules_evaluation", result: status, policyVersion: result.policy_version, agreementReference: result.agreement_reference, createdAt: now });
    return { status, metrics: result.state.metrics, evaluation: result };
  });
}

async function evaluateChallenge(challengeId: string, source: string, enableAutomatic = false) {
  const db = admin.firestore();
  const ref = db.collection("challenges").doc(challengeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Challenge not found.");
  const challenge = snapshot.data() || {};
  if (challenge.rulePolicyVersion !== undefined || challenge.rulePolicy !== undefined) {
    if (enableAutomatic) throw new HttpsError("failed-precondition", "Automatic progression remains paused pending production integration approval.");
    return evaluatePolicyChallenge(challengeId, challenge, source);
  }
  throw new HttpsError("failed-precondition", "Verify the original purchased rule agreement and complete broker equity history before evaluation. Closed trades alone cannot establish phase eligibility or loss compliance.");
}

export const adminChallengeProgression = onCall(async (request) => {
  const email = String(request.auth?.token.email || "").toLowerCase();
  if (!request.auth || request.auth.token.email_verified !== true || !OWNER_ADMIN_EMAILS.includes(email)) throw new HttpsError("permission-denied", "Only verified FYNX owner admins can control challenge progression.");
  await requireFundedMfa(request);
  const challengeId = String(request.data?.challengeId || "");
  const action = String(request.data?.action || "") as ProgressionAction;
  if (!challengeId || !["evaluate", "set_automatic", "set_manual", "pass", "fail", "fund"].includes(action)) throw new HttpsError("invalid-argument", "A valid challenge and action are required.");

  const db = admin.firestore();
  const ref = db.collection("challenges").doc(challengeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Challenge not found.");
  if (action === "evaluate" || action === "set_automatic") {
    const challenge = snapshot.data() || {};
    if (!challenge.brokerAccountId && !challenge.accountId) throw new HttpsError("failed-precondition", "Connect a broker account before enabling automatic progression.");
    return { ok: true, mode: action === "set_automatic" ? "automatic" : challenge.progressionMode || "manual", ...(await evaluateChallenge(challengeId, `admin_${action}`, action === "set_automatic")) };
  }

  // A manual button must not bypass the same launch/evidence gate as automation.
  if (action === "pass" || action === "fund") throw new HttpsError("failed-precondition", "Phase progression and funding remain paused pending verified broker history and the approved phase-transition workflow. Evaluate for review instead.");
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (action === "fail" && (reason.length < 10 || reason.length > 2000)) throw new HttpsError("invalid-argument", "Record a review reason between 10 and 2000 characters.");
  const status = action === "fail" ? "failed" : undefined;
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.exists) throw new HttpsError("not-found", "Challenge not found.");
    const current = latest.data() || {};
    const now = admin.firestore.FieldValue.serverTimestamp();
    const update = action === "set_manual"
      ? { progressionMode: "manual", updatedAt: now }
      : { status, ruleStatus: "failed", breachRecorded: true, requiresHumanReview: true, progressionMode: "manual", reviewedAt: now, reviewedBy: email,
          recordedBreach: current.rulePolicyEvaluation?.state?.breach || current.recordedBreach || { reasons: ["manual_review"], timestamp: new Date().toISOString() }, reviewReason: reason };
    tx.set(ref, update, { merge: true });
    tx.set(db.collection("audit_logs").doc(), { challengeId, accountId: current.brokerAccountId || current.accountId || challengeId, action: `admin_${action}`, result: status || "manual", actor: email, actorUid: request.auth!.uid, reason, source: "owner_admin", createdAt: now });
  });
  return { ok: true, status, mode: "manual" };
});

export const evaluateAutomaticProgressionOnTrade = onDocumentWritten("trades/{tradeId}", async (event) => {
  const trade = event.data?.after.exists ? event.data.after.data() : event.data?.before.data();
  if (!trade) return;
  let challengeId = String(trade.challengeId || "");
  if (!challengeId && trade.accountId) {
    const match = await admin.firestore().collection("challenges").where("brokerAccountId", "==", String(trade.accountId)).limit(1).get();
    challengeId = match.docs[0]?.id || "";
  }
  if (!challengeId) return;
  const challenge = await admin.firestore().collection("challenges").doc(challengeId).get();
  if (!challenge.exists || challenge.data()?.progressionMode !== "automatic") return;
  // Fail closed until the complete equity-event integration and policy migration are approved.
  throw new HttpsError("failed-precondition", "Automatic progression is paused pending verified history and approved integration.");
});

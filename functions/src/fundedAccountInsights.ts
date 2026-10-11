import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { nativeCustomer } from "./nativeCustomer";
import { documentId } from "./nativeCustomerPolicy";
import { accountInsights, payoutSnapshot } from "./fundedInsightsPolicy";

export const fundedAccountInsights = onCall({ region: "us-central1", maxInstances: 10, timeoutSeconds: 30 }, async request => {
  const uid = await nativeCustomer(request);
  const id = documentId(request.data?.challengeId);
  const phase = request.data?.phase;
  if (!Number.isInteger(phase) || phase < 1 || phase > 4) throw new HttpsError("invalid-argument", "Choose a valid phase.");
  const db = admin.firestore();
  return db.runTransaction(async tx => {
    const current = (await tx.get(db.doc(`challenges/${id}`))).data();
    if (!current || current.userId !== uid) throw new HttpsError("not-found", "Account unavailable.");
    let challenge = current;
    let history: FirebaseFirestore.Query = db.collection("rule_events").where("challengeId", "==", id);
    if (phase !== (current.currentPhase ?? 1)) {
      const archive = (await tx.get(db.doc(`funded_phase_archives/${id}/phases/${phase}`))).data();
      if (!archive) return { ...accountInsights({ currency: current.currency, currentPhase: phase }, [], Date.now()), archived: true, payout: null };
      if (archive.userId !== uid || archive.challengeId !== id || archive.currentPhase !== phase || archive.sealed !== true) throw new HttpsError("failed-precondition", "Historical account evidence needs review.");
      challenge = archive;
      history = db.collection(`funded_phase_archives/${id}/phases/${phase}/events`);
    }
    const events = (await tx.get(history.limit(5001))).docs.map(d => d.data());
    // Never guess among multiple accounts or expose a record with conflicting ownership/binding.
    const candidates = (await tx.get(db.collection("accounts").where("challengeId", "==", id).limit(100))).docs;
    const matches = candidates.filter(d => { const a = d.data(); return a.userId === uid &&
      [d.id, a.brokerAccountId, a.accountId, a.login].includes(challenge.brokerAccountId); });
    const account = matches.length === 1 ? matches[0].data() : undefined;
    return { ...accountInsights(challenge, events, Date.now()), archived: phase !== (current.currentPhase ?? 1),
      payout: phase === (current.currentPhase ?? 1) ? payoutSnapshot(account, current, Date.now()) : null };
  });
});

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

const OWNER_ADMIN_EMAILS = ["ha6876122@gmail.com", "fynxteam5@gmail.com"];

type CertificateType =
  | "challenge_passed"
  | "verification_passed"
  | "funded_trader"
  | "first_payout"
  | "milestone"
  | "consistency"
  | "top_trader"
  | "scaling_plan"
  | "profit_split"
  | "account_completion";

const challengeRules: Record<number, Record<string, { profitTargets: string[]; dailyLoss: string; maxLoss: string; minDays: number; profitSplit: string }>> = {
  5000: { "1-phase": { profitTargets: ["10%"], dailyLoss: "4%", maxLoss: "8%", minDays: 3, profitSplit: "75%" }, "2-phase": { profitTargets: ["8%", "5%"], dailyLoss: "5%", maxLoss: "10%", minDays: 5, profitSplit: "80%" }, "3-phase": { profitTargets: ["6%", "5%", "4%"], dailyLoss: "5%", maxLoss: "12%", minDays: 5, profitSplit: "80%" } },
  10000: { "1-phase": { profitTargets: ["10%"], dailyLoss: "4%", maxLoss: "8%", minDays: 3, profitSplit: "75%" }, "2-phase": { profitTargets: ["8%", "5%"], dailyLoss: "5%", maxLoss: "10%", minDays: 5, profitSplit: "80%" }, "3-phase": { profitTargets: ["6%", "5%", "4%"], dailyLoss: "5%", maxLoss: "12%", minDays: 5, profitSplit: "80%" } },
  25000: { "1-phase": { profitTargets: ["10%"], dailyLoss: "4%", maxLoss: "8%", minDays: 3, profitSplit: "80%" }, "2-phase": { profitTargets: ["8%", "5%"], dailyLoss: "5%", maxLoss: "10%", minDays: 5, profitSplit: "80%" }, "3-phase": { profitTargets: ["6%", "5%", "4%"], dailyLoss: "5%", maxLoss: "12%", minDays: 5, profitSplit: "85%" } },
  50000: { "1-phase": { profitTargets: ["10%"], dailyLoss: "4%", maxLoss: "8%", minDays: 3, profitSplit: "80%" }, "2-phase": { profitTargets: ["8%", "5%"], dailyLoss: "5%", maxLoss: "10%", minDays: 5, profitSplit: "85%" }, "3-phase": { profitTargets: ["6%", "5%", "4%"], dailyLoss: "5%", maxLoss: "12%", minDays: 5, profitSplit: "85%" } },
  100000: { "1-phase": { profitTargets: ["10%"], dailyLoss: "4%", maxLoss: "8%", minDays: 3, profitSplit: "85%" }, "2-phase": { profitTargets: ["8%", "5%"], dailyLoss: "5%", maxLoss: "10%", minDays: 5, profitSplit: "90%" }, "3-phase": { profitTargets: ["6%", "5%", "4%"], dailyLoss: "5%", maxLoss: "12%", minDays: 5, profitSplit: "90%" } },
  200000: { "1-phase": { profitTargets: ["10%"], dailyLoss: "4%", maxLoss: "8%", minDays: 3, profitSplit: "85%" }, "2-phase": { profitTargets: ["8%", "5%"], dailyLoss: "5%", maxLoss: "10%", minDays: 5, profitSplit: "90%" }, "3-phase": { profitTargets: ["6%", "5%", "4%"], dailyLoss: "5%", maxLoss: "12%", minDays: 5, profitSplit: "90%" } },
};

export const generateCertificatesOnChallengeWrite = functions.firestore.document("challenges/{challengeId}").onWrite(async (change, context) => {
  if (!change.after.exists) return;
  const challenge = { id: context.params.challengeId, ...change.after.data() };
  await generateChallengeCertificates(challenge, "backend_trigger");
});


export const generateCertificatesOnAccountWrite = functions.firestore.document("accounts/{accountId}").onWrite(async (change, context) => {
  if (!change.after.exists) return;
  const account: FirebaseFirestore.DocumentData = { id: context.params.accountId, ...(change.after.data() || {}) };
  const status = String(account.status || account.accountType || "").toLowerCase();
  if (status !== "funded" && account.accountType !== "funded") return;
  const challengeId = account.challengeId || account.challengeRef;
  if (!challengeId) return;
  const snap = await admin.firestore().collection("challenges").doc(String(challengeId)).get();
  if (!snap.exists) return;
  await generateChallengeCertificates({ id: snap.id, ...snap.data(), status: "funded", brokerAccountId: account.id, fundedAt: account.fundedAt || account.updatedAt }, "backend_trigger");
});

export const generateCertificatesOnPayoutWrite = functions.firestore.document("payouts/{payoutId}").onWrite(async (change, context) => {
  if (!change.after.exists) return;
  const after = change.after.data() || {};
  const before = change.before.exists ? change.before.data() : null;
  if (after.status !== "paid" || before?.status === "paid") return;
  await generatePayoutCertificates({ id: context.params.payoutId, ...after }, "backend_trigger");
});

export const adminRegenerateCertificate = functions.https.onCall(async (data, context) => {
  const email = context.auth?.token.email?.toLowerCase() || "";
  if (!context.auth || !OWNER_ADMIN_EMAILS.includes(email)) {
    throw new functions.https.HttpsError("permission-denied", "Only FYNX owner admins can regenerate certificates.");
  }

  if (data.challengeId) {
    const snap = await admin.firestore().collection("challenges").doc(String(data.challengeId)).get();
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Challenge not found.");
    await generateChallengeCertificates({ id: snap.id, ...snap.data() }, "admin_regeneration");
  }
  if (data.payoutId) {
    const snap = await admin.firestore().collection("payouts").doc(String(data.payoutId)).get();
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Payout not found.");
    await generatePayoutCertificates({ id: snap.id, ...snap.data() }, "admin_regeneration");
  }
  return { ok: true };
});

async function generateChallengeCertificates(challenge: FirebaseFirestore.DocumentData, source: "backend_trigger" | "admin_regeneration") {
  const status = String(challenge.status || "").toLowerCase();
  const phaseStatus = String(challenge.phaseStatus || challenge.currentPhaseStatus || "").toLowerCase();
  const passedPhase = Number(challenge.passedPhase || challenge.currentPhase || 0);
  const user = await getUser(challenge.userId);
  if (!user || !challenge.userId) return;

  const accountId = challenge.brokerAccountId || challenge.accountId || challenge.id;
  const rules = rulesFor(challenge.accountSize, challenge.phase);
  const base = {
    userId: challenge.userId,
    traderName: user.displayName || user.fullName || user.email || "FYNX Trader",
    accountId,
    challengeId: challenge.id,
    orderId: challenge.orderId || "",
    challengeType: challenge.name || `${challenge.phase || "FYNX"} Challenge`,
    accountSize: Number(challenge.accountSize || 0),
    phase: challenge.phase || "",
    passedDate: toIso(challenge.passedAt || challenge.phase1PassedAt || challenge.updatedAt || challenge.endDate || challenge.startDate),
    fundedDate: toIso(challenge.fundedAt || (status === "funded" ? challenge.updatedAt : null)),
    rulesSnapshot: rules,
    profitSplit: rules?.profitSplit,
    generatedFrom: { challengeStatus: status, source },
  };

  if (status === "passed" || status === "funded" || phaseStatus === "phase_1_passed" || passedPhase >= 1 || challenge.phase1PassedAt) {
    await upsertCertificate("challenge_passed", base);
  }
  if (status === "funded" || challenge.verificationPassedAt || challenge.phase2PassedAt || (String(challenge.phase).includes("2") && status === "passed") || passedPhase >= 2) {
    await upsertCertificate("verification_passed", { ...base, passedDate: toIso(challenge.verificationPassedAt || challenge.phase2PassedAt || base.passedDate) });
  }
  if (status === "funded" || challenge.fundedAt) {
    await upsertCertificate("funded_trader", base);
  }
  if (challenge.consistencyPassedAt) await upsertCertificate("consistency", base);
  if (challenge.topTraderAt || Number(challenge.leaderboardRank || 999) <= 10) await upsertCertificate("top_trader", base);
  if (challenge.scalingPlanApprovedAt || String(challenge.scalingPlanStatus || "").toLowerCase() === "approved") await upsertCertificate("scaling_plan", base);
  if (challenge.completedAt || status === "completed") await upsertCertificate("account_completion", { ...base, issuedAt: toIso(challenge.completedAt) });

  const milestones = Array.isArray(challenge.milestones) ? challenge.milestones : [];
  await Promise.all(milestones.filter((item) => item?.reachedAt).map((item) => upsertCertificate("milestone", { ...base, milestoneName: item.name || "Trading Milestone", issuedAt: toIso(item.reachedAt) })));
}

async function generatePayoutCertificates(payout: FirebaseFirestore.DocumentData, source: "backend_trigger" | "admin_regeneration") {
  if (payout.status !== "paid" || !payout.userId) return;
  const user = await getUser(payout.userId);
  if (!user) return;
  const challenge = await findChallengeForPayout(payout);
  const rules = rulesFor(challenge?.accountSize, challenge?.phase);
  const base = {
    userId: payout.userId,
    traderName: user.displayName || user.fullName || user.email || "FYNX Trader",
    accountId: payout.accountId,
    payoutId: payout.id,
    challengeId: challenge?.id || "",
    challengeType: challenge?.name || "Funded Account",
    accountSize: Number(challenge?.accountSize || 0),
    phase: challenge?.phase || "funded",
    passedDate: toIso(challenge?.passedAt || challenge?.endDate || payout.requestedAt),
    fundedDate: toIso(challenge?.fundedAt),
    issuedAt: toIso(payout.processedAt || payout.requestedAt),
    payoutAmount: Number(payout.amount || 0),
    rulesSnapshot: rules,
    profitSplit: payout.profitSplit || rules?.profitSplit,
    generatedFrom: { payoutStatus: payout.status, source },
  };
  await upsertCertificate("first_payout", base);
  await upsertCertificate("profit_split", base);
}

async function upsertCertificate(type: CertificateType, base: FirebaseFirestore.DocumentData) {
  const seed = `${type}:${base.userId}:${base.challengeId || base.accountId}:${base.payoutId || base.milestoneName || "primary"}`;
  const certificateId = stableId(seed);
  const verificationUrl = `https://fynxfunded.com/certificates/verify/${certificateId}`;
  const ref = admin.firestore().collection("certificates").doc(certificateId);
  const existing = await ref.get();
  const existingStatus = existing.exists ? existing.data()?.status : null;
  const source = base.generatedFrom?.source;

  if (existingStatus === "revoked" && source !== "admin_regeneration") return;

  await ref.set({
    ...base,
    type,
    certificateId,
    publicVerificationId: certificateId,
    status: source === "admin_regeneration" ? "issued" : existingStatus || "issued",
    issuedAt: base.issuedAt || base.passedDate || admin.firestore.FieldValue.serverTimestamp(),
    verificationUrl,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function getUser(userId: string) {
  const snap = await admin.firestore().collection("users").doc(String(userId)).get();
  return snap.exists ? snap.data() : null;
}

async function findChallengeForPayout(payout: FirebaseFirestore.DocumentData): Promise<FirebaseFirestore.DocumentData | null> {
  if (!payout.accountId) return null;
  const accountSnap = await admin.firestore().collection("accounts").doc(String(payout.accountId)).get();
  const account = accountSnap.exists ? accountSnap.data() : null;
  const challengeId = account?.challengeId || payout.challengeId;
  if (challengeId) {
    const challengeSnap = await admin.firestore().collection("challenges").doc(String(challengeId)).get();
    if (challengeSnap.exists) return { id: challengeSnap.id, ...challengeSnap.data() };
  }
  const byBroker = await admin.firestore().collection("challenges").where("brokerAccountId", "==", payout.accountId).limit(1).get();
  return byBroker.empty ? null : { id: byBroker.docs[0].id, ...byBroker.docs[0].data() };
}

function phaseKey(phase: unknown): "1-phase" | "2-phase" | "3-phase" {
  const text = String(phase || "2-phase").toLowerCase();
  if (text.includes("1")) return "1-phase";
  if (text.includes("3")) return "3-phase";
  return "2-phase";
}

function rulesFor(accountSize: unknown, phase: unknown) {
  return challengeRules[Number(accountSize || 0)]?.[phaseKey(phase)] || null;
}

function stableId(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `FYNX-CERT-${hash.toString(36).toUpperCase().padStart(7, "0")}`;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value) return (value as { toDate: () => Date }).toDate().toISOString();
  return null;
}

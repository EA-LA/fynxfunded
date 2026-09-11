import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const OWNER_ADMIN_EMAILS = ["ha6876122@gmail.com", "fynxteam5@gmail.com"];
const RULES: Record<string, { targets: number[]; dailyLoss: number; maxLoss: number; minDays: number }> = {
  "1-phase": { targets: [10], dailyLoss: 4, maxLoss: 8, minDays: 3 },
  "2-phase": { targets: [8, 5], dailyLoss: 5, maxLoss: 10, minDays: 5 },
  "3-phase": { targets: [6, 5, 4], dailyLoss: 5, maxLoss: 12, minDays: 5 },
};

type ProgressionAction = "evaluate" | "set_automatic" | "set_manual" | "pass" | "fail" | "fund";

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function tradePnl(trade: FirebaseFirestore.DocumentData): number {
  return number(trade.pnl ?? trade.profit ?? trade.netProfit ?? trade.realizedPnl);
}

function tradeTime(trade: FirebaseFirestore.DocumentData): string | null {
  return iso(trade.closeTime ?? trade.closedAt ?? trade.exitTime ?? trade.updatedAt ?? trade.openTime ?? trade.openedAt);
}

async function tradesFor(challengeId: string, challenge: FirebaseFirestore.DocumentData) {
  const db = admin.firestore();
  const byChallenge = await db.collection("trades").where("challengeId", "==", challengeId).get();
  if (!byChallenge.empty) return byChallenge.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const accountId = challenge.brokerAccountId || challenge.accountId;
  if (!accountId) return [];
  const byAccount = await db.collection("trades").where("accountId", "==", String(accountId)).get();
  return byAccount.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function evaluateChallenge(challengeId: string, source: string, requireData = true) {
  const db = admin.firestore();
  const ref = db.collection("challenges").doc(challengeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Challenge not found.");
  const challenge = snapshot.data() || {};
  const phase = String(challenge.phase || "").toLowerCase();
  const rules = RULES[phase];
  const accountSize = number(challenge.accountSize);
  if (!rules || accountSize <= 0) throw new HttpsError("failed-precondition", "This challenge is missing a valid account size or phase configuration.");

  const trades = await tradesFor(challengeId, challenge);
  if (!trades.length && requireData) throw new HttpsError("failed-precondition", "No verified broker trades are available for this challenge yet.");

  const ordered = trades
    .map((trade) => ({ ...trade, normalizedTime: tradeTime(trade), normalizedPnl: tradePnl(trade) }))
    .filter((trade) => trade.normalizedTime)
    .sort((a, b) => String(a.normalizedTime).localeCompare(String(b.normalizedTime)));
  if (!ordered.length && requireData) throw new HttpsError("failed-precondition", "Broker trades were found, but none contain a valid close time.");

  const daily = new Map<string, number>();
  let totalPnl = 0;
  let equity = accountSize;
  let peak = accountSize;
  let maxDrawdownPct = 0;
  for (const trade of ordered) {
    totalPnl += trade.normalizedPnl;
    equity += trade.normalizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / accountSize) * 100);
    const day = String(trade.normalizedTime).slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + trade.normalizedPnl);
  }
  const dailyDrawdownPct = Math.max(0, ...Array.from(daily.values(), (pnl) => Math.abs(Math.min(0, pnl)) / accountSize * 100));
  const profitPct = totalPnl / accountSize * 100;
  const currentPhase = Math.max(1, Math.min(rules.targets.length, number(challenge.currentPhase) || 1));
  const targetPct = rules.targets[currentPhase - 1];
  const breached = dailyDrawdownPct > rules.dailyLoss || maxDrawdownPct > rules.maxLoss;
  const passed = !breached && daily.size >= rules.minDays && profitPct >= targetPct;
  const status = breached ? "failed" : passed ? "passed" : "active";
  const metrics = { tradeCount: ordered.length, tradingDays: daily.size, totalPnl, profitPct, dailyDrawdownPct, maxDrawdownPct, targetPct };
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(ref, { status, ruleStatus: status, ruleMetrics: metrics, lastRuleEvaluationAt: now, lastRuleEvaluationSource: source }, { merge: true });
  batch.set(db.collection("rule_evaluations").doc(), { challengeId, accountId: challenge.brokerAccountId || challenge.accountId || challengeId, status, source, metrics, createdAt: now });
  batch.set(db.collection("audit_logs").doc(), { challengeId, accountId: challenge.brokerAccountId || challenge.accountId || challengeId, action: "rules_evaluation", result: status, source, details: metrics, createdAt: now });
  await batch.commit();
  return { status, metrics };
}

export const adminChallengeProgression = onCall(async (request) => {
  const email = String(request.auth?.token.email || "").toLowerCase();
  if (!request.auth || !OWNER_ADMIN_EMAILS.includes(email)) throw new HttpsError("permission-denied", "Only FYNX owner admins can control challenge progression.");
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
    if (action === "set_automatic") await ref.set({ progressionMode: "automatic", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, mode: action === "set_automatic" ? "automatic" : challenge.progressionMode || "manual", ...(await evaluateChallenge(challengeId, `admin_${action}`)) };
  }

  const status = action === "pass" ? "passed" : action === "fail" ? "failed" : action === "fund" ? "funded" : undefined;
  const update = action === "set_manual"
    ? { progressionMode: "manual", updatedAt: admin.firestore.FieldValue.serverTimestamp() }
    : { status, progressionMode: "manual", reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: email };
  const batch = db.batch();
  batch.set(ref, update, { merge: true });
  batch.set(db.collection("audit_logs").doc(), { challengeId, accountId: snapshot.data()?.brokerAccountId || snapshot.data()?.accountId || challengeId, action: `admin_${action}`, result: status || "manual", actor: email, source: "owner_admin", createdAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
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
  await evaluateChallenge(challengeId, "broker_trade_trigger", false);
});

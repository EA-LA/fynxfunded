import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { millis } from "./fundedWorkspacePolicy";

export function payoutRanking(records: any[], now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const totals = new Map<string, number>();
  for (const payout of records) {
    const date = millis(payout.paidAt ?? payout.processedAt);
    const amount = Number(payout.amount);
    if (payout.status !== "paid" || payout.currency !== "USD" || typeof payout.userId !== "string" || !payout.userId || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(date) || date < start || date > now.getTime()) continue;
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents) || !Number.isSafeInteger((totals.get(payout.userId) ?? 0) + cents)) continue;
    totals.set(payout.userId, (totals.get(payout.userId) ?? 0) + cents);
  }
  return [...totals].map(([userId, cents]) => ({ userId, value: cents / 100 })).sort((a,b) => b.value - a.value || a.userId.localeCompare(b.userId));
}
export const refreshFundedLeaderboard = onSchedule({ schedule: "every 24 hours", region: "us-central1", timeZone: "Etc/UTC", maxInstances: 1 }, async () => {
  const db = admin.firestore();
  const records = await db.collection("payouts").where("status", "==", "paid").limit(10000).get();
  // Refuse a partial ranking instead of silently omitting customers after a query cap.
  if (records.size >= 10000) { await db.doc("funded_leaderboard/current").set({ status: "unavailable", reason: "aggregation_capacity" }, { merge: true }); return; }
  const now = new Date();
  await db.doc("funded_leaderboard/current").set({ status: "published", title: "Monthly payout leaderboard", metric: "Recorded paid payouts · USD", period: now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), verifiedAt: admin.firestore.FieldValue.serverTimestamp(), verifiedBy: "server-paid-payout-aggregation-v1", entries: payoutRanking(records.docs.map(d=>d.data()), now).slice(0,1000) });
});

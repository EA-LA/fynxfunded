import { createHash } from "node:crypto";

export const eventKey = (id: string) => createHash("sha256").update(id).digest("hex");
export function changedNotice(collection: string, id: string, before: any, after: any) {
  if (!after || typeof after.userId !== "string" || !after.userId || !before || before.userId !== after.userId) return null;
  const keys = collection === "payouts" ? ["status"] : ["status", "currentPhase", "nextEligiblePayoutAt", "nextPayoutAt"];
  const canonical = (data: any) => JSON.stringify(keys.map(k => typeof data[k]?.toMillis === "function" ? data[k].toMillis() : data[k] ?? null));
  if (canonical(before) === canonical(after)) return null;
  return { userId: after.userId, accountID: collection === "challenges" ? id : after.challengeId || (collection === "accounts" ? "account-" + id : ""),
    kind: collection === "payouts" ? "payout" : "account", fingerprint: canonical(after), titleKey: collection === "payouts" ? "Payout updated" : "Account updated" };
}
export function pushMessage(token: string, noticeID: string) {
  // Lock-screen payloads deliberately contain no account ID, balance, status, email or credentials.
  return { token, notification: { title: "FYNX Funded", body: "Open FYNX to review an account update." },
    data: { type: "funded", deepLink: "fynx://funded", noticeID },
    apns: { headers: { "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600), "apns-collapse-id": noticeID },
      payload: { aps: { sound: "default", "thread-id": "funded-accounts" } } } };
}

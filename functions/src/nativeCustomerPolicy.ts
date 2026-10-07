import { HttpsError } from "firebase-functions/v2/https";
export function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${name} is required.`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw new HttpsError("invalid-argument", `${name} must be ${min}–${max} characters.`);
  return result;
}
export function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new HttpsError("invalid-argument", "A request reference is required.");
  return value.toLowerCase();
}
export function documentId(value: unknown): string {
  const id = text(value, "Account reference", 1, 256);
  if (id.includes("/") || id === "." || id === "..") throw new HttpsError("invalid-argument", "Invalid account reference.");
  return id;
}
export function cents(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new HttpsError("invalid-argument", "Enter a positive amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpsError("invalid-argument", "Amount must be greater than zero.");
  return amount;
}
export function payoutAllowed(uid: string, profile: Record<string, any>, account: Record<string, any>, challenge: Record<string, any>, amount: number, now: number) {
  if (profile.kycStatus !== "verified") throw new HttpsError("failed-precondition", "Complete identity verification before requesting a payout.");
  if (account.userId !== uid || challenge.userId !== uid) throw new HttpsError("permission-denied", "This account is not available.");
  if (challenge.status !== "funded" || ["closed", "suspended", "breached", "failed", "disabled", "archived"].includes(account.status)) throw new HttpsError("failed-precondition", "Payout requests require an active funded account.");
  const date = account.nextEligiblePayoutAt ?? challenge.nextEligiblePayoutAt ?? account.nextPayoutAt ?? challenge.nextPayoutAt ?? account.nextEligiblePayoutDate ?? challenge.nextEligiblePayoutDate;
  if (date) {
    const time = typeof date.toMillis === "function" ? date.toMillis() : Date.parse(String(date));
    if (!Number.isFinite(time) || time > now) throw new HttpsError("failed-precondition", "The next eligible payout date has not been reached.");
  }
  const available = account.availablePayoutAmount ?? account.withdrawableAmount;
  if (available != null && (!Number.isFinite(Number(available)) || amount > Math.round(Number(available) * 100))) throw new HttpsError("failed-precondition", "The request exceeds the server-recorded available amount.");
  // A request is submitted for human review. Missing allowance data never authorizes a transfer.
}

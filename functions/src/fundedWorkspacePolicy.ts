import { HttpsError } from "firebase-functions/v2/https";
export function millis(value: any): number { return typeof value?.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : Date.parse(String(value)); }
export function published(value: any, now = Date.now()): boolean {
  return value?.status === "published" && (!value.startsAt || millis(value.startsAt) <= now) && (!value.endsAt || millis(value.endsAt) > now);
}
export function safeDestination(value: any, social = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    const socialHosts = ["www.instagram.com", "instagram.com", "www.youtube.com", "youtube.com", "youtu.be", "x.com", "www.x.com", "twitter.com", "www.tiktok.com", "tiktok.com", "discord.gg", "discord.com", "t.me", "www.linkedin.com", "www.facebook.com", "facebook.com"];
    if (social && (!socialHosts.includes(url.hostname) || url.pathname === "/")) return null;
    if (!social && (url.hostname === "localhost" || /^\d+\./.test(url.hostname) || !url.hostname.includes("."))) return null;
    return url.href;
  } catch { return null; }
}
export function verifiedDestination(value: any, social = false, now = Date.now()): string | null {
  if (!published(value, now) || value.verified !== true || typeof value.verifiedBy !== "string" || !value.verifiedBy || !Number.isFinite(millis(value.verifiedAt)) || millis(value.verifiedAt) > now || now - millis(value.verifiedAt) > 90 * 86400000) return null;
  return safeDestination(value.url, social);
}
export function assertBookable(slot: any, now = Date.now()) {
  if (!published(slot, now) || !Number.isFinite(millis(slot.startAt)) || millis(slot.startAt) <= now || !Number.isFinite(millis(slot.endAt)) || millis(slot.endAt) <= millis(slot.startAt)) throw new HttpsError("failed-precondition", "This session is no longer bookable.");
  if (!Number.isInteger(slot.capacity) || slot.capacity < 1 || !Number.isInteger(slot.booked ?? 0) || (slot.booked ?? 0) < 0 || (slot.booked ?? 0) >= slot.capacity) throw new HttpsError("failed-precondition", "This session is full.");
  if (slot.priceCents !== 0) throw new HttpsError("failed-precondition", "This session cannot be booked in the app yet.");
}

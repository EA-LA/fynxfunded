/** Private Funded authorization is separate from Tools authentication. */
export const FUNDED_OWNER_EMAIL = "fynxteam5@gmail.com";
/** Owner accounts that may hold private Funded access (each still needs the operator-set claim and a pinned UID). */
export const FUNDED_OWNER_EMAILS: readonly string[] = Object.freeze([FUNDED_OWNER_EMAIL, "ha6876122@gmail.com"]);
const MAX_PRIVATE_OWNERS = 5;
export interface PrivateOwnerConfig { enabled?: boolean; ownerUID?: string; ownerUIDs?: unknown }
/** UIDs pinned in funded_private_access/current: the original ownerUID plus an optional short ownerUIDs list. */
export function configuredOwnerUIDs(config: PrivateOwnerConfig | undefined): string[] {
  if (!config || config.enabled !== true) return [];
  const extra = Array.isArray(config.ownerUIDs) && config.ownerUIDs.length <= MAX_PRIVATE_OWNERS ? config.ownerUIDs : [];
  return [config.ownerUID, ...extra].filter((uid): uid is string => typeof uid === "string" && uid.trim().length > 0 && uid === uid.trim());
}
export interface PrivateIdentity { uid: string; token: Record<string, any> }
export interface PrivateUser { uid: string; email?: string; emailVerified: boolean; disabled: boolean; customClaims?: Record<string, any>; tokensValidAfterTime?: string; providerData: Array<{ providerId: string }> }
export function privateOwnerAllowed(identity: PrivateIdentity | undefined, config: PrivateOwnerConfig | undefined, user: PrivateUser | undefined): boolean {
  if (!identity || !config || !user || !configuredOwnerUIDs(config).includes(identity.uid) || user.uid !== identity.uid) return false;
  const email = String(user.email ?? "").toLowerCase();
  const provider = identity.token.firebase?.sign_in_provider;
  const passwordSession = provider === "password" || (provider === "custom" && typeof identity.token.funded_mfa === "string" && /^[a-f0-9]{64}$/.test(identity.token.funded_mfa));
  const authTime = Number(identity.token.auth_time), validAfter = Date.parse(user.tokensValidAfterTime ?? "") / 1000;
  return passwordSession && user.providerData.some(p => p.providerId === "password") && !user.disabled && user.emailVerified === true &&
    identity.token.email_verified === true && FUNDED_OWNER_EMAILS.includes(email) &&
    String(identity.token.email ?? "").toLowerCase() === email && identity.token.fundedOwner === true && user.customClaims?.fundedOwner === true &&
    Number.isFinite(authTime) && authTime > 0 && (!Number.isFinite(validAfter) || authTime >= validAfter);
}
export interface WaitlistInput { email: string; name: string; source: "ios" | "web"; consentVersion: string }
export function waitlistInput(data: unknown): WaitlistInput {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Enter your email and consent to Funded launch updates.");
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some(key => !["email", "name", "source", "consent"].includes(key)) || value.consent !== true || !["ios", "web"].includes(String(value.source))) throw Error("Consent is required for Funded launch updates.");
  if (typeof value.email !== "string" || value.email.length > 254 || (value.name !== undefined && typeof value.name !== "string")) throw Error("Enter a valid email address.");
  const email = value.email.trim().toLowerCase(), name = String(value.name ?? "").trim();
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(email) || email.split("@")[0].length > 64 || name.length > 80 || Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw Error("Enter a valid email and a name of up to 80 characters.");
  return { email, name, source: value.source as "ios" | "web", consentVersion: "funded-launch-2026-10-30" };
}
export function waitlistRateAllowed(shortCount: number, dailyCount: number): boolean { return shortCount < 5 && dailyCount < 20; }

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth as firebaseAuth, db as firebaseDb, functions as firebaseFunctions, isFirebaseConfigured } from "@/lib/firebase";
import type { LoginSession } from "@/services/session-tracker";

export interface UserSecuritySettings {
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  loginAlertsEnabled: boolean;
  backupCodesGeneratedAt: string;
  activeSessions: number;
  lastSecurityUpdate: string;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeUrl: string;
}

const LOCAL_SETTINGS_KEY = "fynx_security_settings";
const DEFAULT_SETTINGS: UserSecuritySettings = {
  twoFactorEnabled: false,
  twoFactorSecret: "",
  loginAlertsEnabled: false,
  backupCodesGeneratedAt: "",
  activeSessions: 0,
  lastSecurityUpdate: "",
};

function assertAuthed(userId: string) {
  const current = firebaseAuth?.currentUser;
  if (isFirebaseConfigured && (!current || current.uid !== userId)) {
    throw new Error("You must be signed in to change security settings.");
  }
}

function settingsRef(userId: string) {
  if (!firebaseDb) throw new Error("Firebase is not configured.");
  return doc(firebaseDb, "users", userId, "security", "settings");
}

async function mirrorUserSecurityFields(userId: string, data: Record<string, unknown>) {
  if (!firebaseDb) return;
  await setDoc(doc(firebaseDb, "users", userId), { ...data, lastSecurityUpdate: serverTimestamp() }, { merge: true });
}

function toIso(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

function fromDoc(data: Record<string, any> | undefined): UserSecuritySettings {
  return {
    ...DEFAULT_SETTINGS,
    twoFactorEnabled: !!data?.twoFactorEnabled,
    twoFactorSecret: data?.twoFactorSecret || "",
    loginAlertsEnabled: !!data?.loginAlertsEnabled,
    backupCodesGeneratedAt: toIso(data?.backupCodesGeneratedAt),
    activeSessions: Number(data?.activeSessions || 0),
    lastSecurityUpdate: toIso(data?.lastSecurityUpdate),
  };
}

function getLocal(userId: string): UserSecuritySettings {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...(all[userId] || {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function setLocal(userId: string, data: Partial<UserSecuritySettings>) {
  const all = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || "{}");
  all[userId] = { ...DEFAULT_SETTINGS, ...(all[userId] || {}), ...data, lastSecurityUpdate: new Date().toISOString() };
  localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(all));
}

async function ensureSettingsDoc(userId: string): Promise<UserSecuritySettings> {
  assertAuthed(userId);
  if (!isFirebaseConfigured || !firebaseDb) return getLocal(userId);

  const ref = settingsRef(userId);
  const snap = await getDoc(ref);
  if (snap.exists()) return fromDoc(snap.data());

  await setDoc(ref, {
    twoFactorEnabled: false,
    twoFactorSecret: "",
    loginAlertsEnabled: false,
    backupCodesGeneratedAt: null,
    activeSessions: 0,
    lastSecurityUpdate: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  return DEFAULT_SETTINGS;
}

export async function getSecuritySettings(userId: string): Promise<UserSecuritySettings> {
  return ensureSettingsDoc(userId);
}

export function watchSecuritySettings(userId: string, cb: (settings: UserSecuritySettings) => void): Unsubscribe {
  if (!isFirebaseConfigured || !firebaseDb) {
    cb(getLocal(userId));
    return () => undefined;
  }
  return onSnapshot(settingsRef(userId), async (snap) => {
    if (!snap.exists()) cb(await ensureSettingsDoc(userId));
    else cb(fromDoc(snap.data()));
  });
}

export async function setLoginAlertsEnabled(userId: string, enabled: boolean): Promise<void> {
  assertAuthed(userId);
  if (!isFirebaseConfigured || !firebaseDb) {
    setLocal(userId, { loginAlertsEnabled: enabled });
    return;
  }
  await setDoc(settingsRef(userId), { loginAlertsEnabled: enabled, lastSecurityUpdate: serverTimestamp() }, { merge: true });
  await mirrorUserSecurityFields(userId, { loginAlertsEnabled: enabled });
}

export async function setActiveSessionCount(userId: string): Promise<number> {
  let count = 0;
  if (isFirebaseConfigured && firebaseDb) {
    const snap = await getDocs(collection(firebaseDb, "users", userId, "sessions"));
    count = snap.size;
  }
  if (!isFirebaseConfigured || !firebaseDb) {
    setLocal(userId, { activeSessions: count });
    return count;
  }
  await setDoc(settingsRef(userId), { activeSessions: count, lastSecurityUpdate: serverTimestamp() }, { merge: true });
  await mirrorUserSecurityFields(userId, { activeSessions: count });
  return count;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => BASE32_ALPHABET[b % BASE32_ALPHABET.length]).join("");
}

function base32ToBytes(secret: string): Uint8Array {
  const clean = secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function hmacSha1(keyBytes: Uint8Array, message: ArrayBuffer): Promise<ArrayBuffer> {
  const keyMaterial = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, message);
}

export async function generateTotp(secret: string, timestamp = Date.now()): Promise<string> {
  const counter = Math.floor(timestamp / 30000);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter, false);
  const hash = new Uint8Array(await hmacSha1(base32ToBytes(secret), buffer));
  const offset = hash[hash.length - 1] & 0xf;
  const binary = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  const windows = [-30000, 0, 30000];
  const expected = await Promise.all(windows.map((drift) => generateTotp(secret, now + drift)));
  return expected.includes(normalized);
}

export function createTwoFactorSetup(email: string): TwoFactorSetup {
  const secret = generateBase32Secret();
  const label = encodeURIComponent(`FYNX Funded:${email}`);
  const issuer = encodeURIComponent("FYNX Funded");
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUrl)}`;
  return { secret, otpauthUrl, qrCodeUrl };
}

export async function enableTwoFactor(userId: string, secret: string, code: string): Promise<void> {
  assertAuthed(userId);
  const valid = await verifyTotp(secret, code);
  if (!valid) throw new Error("Invalid 6-digit authenticator code.");
  if (!isFirebaseConfigured || !firebaseDb) {
    setLocal(userId, { twoFactorEnabled: true, twoFactorSecret: secret });
    return;
  }
  await setDoc(settingsRef(userId), { twoFactorEnabled: true, twoFactorSecret: secret, lastSecurityUpdate: serverTimestamp() }, { merge: true });
  await mirrorUserSecurityFields(userId, { twoFactorEnabled: true });
}

export async function confirmPassword(password: string): Promise<void> {
  const current = firebaseAuth?.currentUser;
  if (!isFirebaseConfigured) return;
  if (!current?.email) throw new Error("Password confirmation requires an email/password account.");
  await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
}

export async function disableTwoFactor(userId: string, password: string): Promise<void> {
  assertAuthed(userId);
  await confirmPassword(password);
  if (!isFirebaseConfigured || !firebaseDb) {
    setLocal(userId, { twoFactorEnabled: false, twoFactorSecret: "" });
    return;
  }
  await setDoc(settingsRef(userId), { twoFactorEnabled: false, twoFactorSecret: "", lastSecurityUpdate: serverTimestamp() }, { merge: true });
  await mirrorUserSecurityFields(userId, { twoFactorEnabled: false });
}

function randomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36).toUpperCase()).join("").replace(/(.{4})/g, "$1-").slice(0, -1);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateRecoveryCodes(userId: string, password?: string): Promise<string[]> {
  assertAuthed(userId);
  const existing = await getSecuritySettings(userId);
  if (existing.backupCodesGeneratedAt) {
    if (!password) throw new Error("Password confirmation is required to regenerate recovery codes.");
    await confirmPassword(password);
  }
  const codes = Array.from({ length: 10 }, randomCode);
  const backupCodeHashes = await Promise.all(codes.map(sha256));
  if (!isFirebaseConfigured || !firebaseDb) {
    setLocal(userId, { backupCodesGeneratedAt: new Date().toISOString() });
    localStorage.setItem(`fynx_backup_hashes_${userId}`, JSON.stringify(backupCodeHashes));
    return codes;
  }
  await setDoc(settingsRef(userId), { backupCodeHashes, backupCodesGeneratedAt: serverTimestamp(), lastSecurityUpdate: serverTimestamp() }, { merge: true });
  await mirrorUserSecurityFields(userId, { backupCodesGeneratedAt: serverTimestamp() });
  return codes;
}

export async function verifySignInTwoFactor(userId: string, code: string): Promise<void> {
  const settings = await getSecuritySettings(userId);
  if (!settings.twoFactorEnabled) return;
  if (!settings.twoFactorSecret) throw new Error("2FA is enabled but no authenticator secret is configured.");
  const valid = await verifyTotp(settings.twoFactorSecret, code);
  if (!valid) throw new Error("Invalid two-factor authentication code.");
}

export async function maybeSendLoginAlert(userId: string, session: LoginSession): Promise<void> {
  const settings = await getSecuritySettings(userId);
  if (!settings.loginAlertsEnabled) return;
  if (firebaseFunctions) {
    await httpsCallable(firebaseFunctions, "sendLoginAlert")({ session });
  } else {
    console.info("[Security] Login alert", { userId, session });
  }
}

import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { EmailAuthProvider, reauthenticateWithCredential, signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth as firebaseAuth, db as firebaseDb, functions as firebaseFunctions, isFirebaseConfigured } from "@/lib/firebase";
import type { LoginSession } from "@/services/session-tracker";

export interface UserSecuritySettings {
  twoFactorEnabled: boolean;
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

  await mfaStatus();
  const ref = settingsRef(userId);
  const snap = await getDoc(ref);
  if (snap.exists()) return fromDoc(snap.data());

  await setDoc(ref, {
    loginAlertsEnabled: false,
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

export async function mfaCall(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (!firebaseFunctions || !firebaseAuth?.currentUser) throw new Error("Sign in to manage account security.");
  const uid = firebaseAuth.currentUser.uid;
  const result = await httpsCallable(firebaseFunctions, "fundedMfa")({ action, ...extra });
  if (firebaseAuth.currentUser?.uid !== uid) throw new Error("Your account changed. Sign in again.");
  const data = result.data as any;
  if (typeof data?.customToken === "string" && data.customToken) await signInWithCustomToken(firebaseAuth, data.customToken);
  return data;
}
export async function mfaStatus(): Promise<{ required: boolean; verified: boolean; expiresAt: number | null }> {
  let status;
  try { status = await mfaCall("status"); }
  catch (error) {
    const code = (error as { code?: string })?.code;
    const uid = firebaseAuth?.currentUser?.uid;
    // Firebase 13 appends the HTTP status to callable messages. Match only this
    // known rollout error; unrelated precondition failures must remain closed.
    const rolloutPending = code === "functions/not-found" || (code === "functions/failed-precondition" && /^Server verification is awaiting activation\.(?: \[400\])?$/.test((error as Error).message));
    if (!rolloutPending || !uid || !firebaseDb) throw error;
    // Migration-compatible for non-MFA users only. Never trust a cached factor flag.
    const [profile, security] = await Promise.all([getDocFromServer(doc(firebaseDb, "users", uid)), getDocFromServer(settingsRef(uid))]);
    if (firebaseAuth?.currentUser?.uid !== uid || profile.data()?.twoFactorEnabled === true || security.data()?.twoFactorEnabled === true) throw error;
    return { required: false, verified: true, expiresAt: null };
  }
  if (typeof status?.required !== "boolean" || typeof status?.verified !== "boolean" ||
      (status.required && status.verified && (!Number.isFinite(status.expiresAt) || status.expiresAt <= Date.now()))) {
    throw new Error("Could not confirm your secure session. Sign in again.");
  }
  return status;
}
export async function verifySignInTwoFactor(userId: string, code: string): Promise<void> {
  assertAuthed(userId);
  await mfaCall("verify", { code });
}
export async function createTwoFactorSetup(_email: string): Promise<TwoFactorSetup> {
  const setup = await mfaCall("enrollStart");
  // Authenticator secrets are never sent to a third-party QR image service.
  return { secret: setup.secret, otpauthUrl: setup.otpauthUrl, qrCodeUrl: "" };
}
export async function enableTwoFactor(userId: string, _secret: string, code: string): Promise<void> {
  assertAuthed(userId);
  await mfaCall("enrollConfirm", { code });
}
export async function confirmPassword(password: string): Promise<void> {
  const current = firebaseAuth?.currentUser;
  if (!current?.email) throw new Error("Sign in again to confirm this security change.");
  await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
}
export async function disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
  assertAuthed(userId);
  await confirmPassword(password);
  await verifySignInTwoFactor(userId, code);
  await mfaCall("disable");
}
export async function generateRecoveryCodes(userId: string, password?: string, code?: string): Promise<string[]> {
  assertAuthed(userId);
  if (password) {
    await confirmPassword(password);
    await verifySignInTwoFactor(userId, code ?? "");
  }
  return (await mfaCall("recovery")).codes;
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

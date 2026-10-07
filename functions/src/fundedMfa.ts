import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { randomBytes, randomUUID } from "node:crypto";
import { FactorState, SessionProof, verifyFactor, sessionValid, codeHash } from "./mfaPolicy";

const lifetime = 60 * 60 * 1000;
const freshWindow = 5 * 60;
function auth(request: Pick<CallableRequest, "auth">) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in again to continue.");
  if (request.auth.token.email_verified !== true) throw new HttpsError("permission-denied", "Verify your email before continuing.");
  return request.auth;
}
async function assertActiveUser(identity: NonNullable<CallableRequest["auth"]>) {
  const firebaseUser = await admin.auth().getUser(identity.uid);
  const validAfter = Date.parse(firebaseUser.tokensValidAfterTime ?? "") / 1000;
  if (firebaseUser.disabled || (Number.isFinite(validAfter) && Number(identity.token.auth_time) < validAfter)) {
    throw new HttpsError("unauthenticated", "Sign in again to continue.");
  }
}
function cleanState(state: FactorState): FactorState {
  return JSON.parse(JSON.stringify(state)) as FactorState;
}
async function stateFor(uid: string): Promise<FactorState> {
  const db = admin.firestore();
  return db.runTransaction(async tx => {
    const ref = db.doc(`funded_mfa_private/${uid}`);
    const legacyRef = db.doc(`users/${uid}/security/settings`);
    const userRef = db.doc(`users/${uid}`);
    const [current, legacy, user] = await Promise.all([tx.get(ref), tx.get(legacyRef), tx.get(userRef)]);
    if (current.exists) return current.data() as FactorState;
    const raw = legacy.data() ?? {};
    const enabled = raw.twoFactorEnabled === true || user.data()?.twoFactorEnabled === true;
    const state: FactorState = { enabled, version: randomUUID(), secret: enabled ? String(raw.twoFactorSecret ?? "") : "", recoveryHashes: Array.isArray(raw.backupCodeHashes) ? raw.backupCodeHashes.filter((h: unknown) => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)) : [], lastCounter: -1 };
    tx.set(ref, state);
    tx.set(legacyRef, { twoFactorEnabled: enabled, mfaVersion: state.version, twoFactorSecret: admin.firestore.FieldValue.delete(), backupCodeHashes: admin.firestore.FieldValue.delete() }, { merge: true });
    tx.set(userRef, { twoFactorEnabled: enabled }, { merge: true });
    return state;
  });
}
async function validSession(request: Pick<CallableRequest, "auth">, state: FactorState): Promise<boolean> {
  const identity = auth(request);
  const id = identity.token.funded_mfa;
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return false;
  const record = await admin.firestore().doc(`funded_mfa_sessions/${id}`).get();
  return sessionValid(record.data() as SessionProof | undefined, identity.uid, state.version, Date.now());
}
/** Call before protected Admin-SDK customer operations: Admin SDK bypasses Firestore rules. */
export async function requireFundedMfa(request: Pick<CallableRequest, "auth">): Promise<void> {
  const identity = auth(request);
  const rollout = await admin.firestore().doc("funded_mfa_rollout/current").get();
  if (rollout.data()?.ready !== true) return; // Existing behavior until coordinated activation.

  await assertActiveUser(identity);
  const state = await stateFor(identity.uid);
  if (state.enabled && !await validSession(request, state)) throw new HttpsError("permission-denied", "Two-factor verification is required.");
}
async function assertRecent(request: CallableRequest) {
  const identity = auth(request);
  const issued = Number(identity.token.auth_time);
  if (!Number.isFinite(issued) || Date.now() / 1000 - issued > freshWindow || issued > Date.now() / 1000 + 30) {
    throw new HttpsError("unauthenticated", "Sign in again, then enter your verification code.");
  }
}
async function issueSession(uid: string, state: FactorState): Promise<{ customToken: string; expiresAt: number }> {
  const id = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + lifetime;
  await admin.firestore().doc(`funded_mfa_sessions/${id}`).set({ uid, version: state.version, expiresAt, deleteAfter: admin.firestore.Timestamp.fromMillis(expiresAt) });
  try {
    // Session-local claim; never use setCustomUserClaims, which would authorize other sessions.
    const customToken = await admin.auth().createCustomToken(uid, { funded_mfa: id });
    return { customToken, expiresAt };
  } catch {
    await admin.firestore().doc(`funded_mfa_sessions/${id}`).delete();
    throw new HttpsError("unavailable", "Could not create a verified session. Try again with a new code.");
  }
}

export const fundedMfa = onCall({ region: "us-central1", maxInstances: 10 }, async request => {
  const identity = auth(request);
  await assertActiveUser(identity);
  // Enable only after the coordinated rules + web release. No permissive fallback.
  const rollout = await admin.firestore().doc("funded_mfa_rollout/current").get();
  if (rollout.data()?.ready !== true) throw new HttpsError("failed-precondition", "Server verification is awaiting activation.");
  const state = await stateFor(identity.uid);
  const action = request.data?.action;
  if (action === "status") {
    const verified = !state.enabled || await validSession(request, state);
    let expiresAt: number | null = null;
    if (state.enabled && verified) {
      const grant = await admin.firestore().doc(`funded_mfa_sessions/${identity.token.funded_mfa}`).get();
      expiresAt = Number(grant.data()?.expiresAt) || null;
    }
    return { required: state.enabled, verified, version: state.version, expiresAt };
  }
  if (action === "verify") {
    await assertRecent(request);
    if (!state.enabled) throw new HttpsError("failed-precondition", "Two-factor authentication is not enabled.");
    const code = request.data?.code;
    if (typeof code !== "string" || code.length > 32) throw new HttpsError("invalid-argument", "Enter your authenticator or recovery code.");
    const result = await admin.firestore().runTransaction(async tx => {
      const ref = admin.firestore().doc(`funded_mfa_private/${identity.uid}`);
      const snap = await tx.get(ref);
      const latest = snap.data() as FactorState;
      if (!latest.enabled) throw new HttpsError("failed-precondition", "Security settings changed. Try again.");
      let result;
      try { result = verifyFactor(latest, code, Date.now()); }
      catch { throw new HttpsError("failed-precondition", "Authenticator setup needs account recovery."); }
      // Commit failed-attempt state too; throwing here would roll back the rate limit.
      tx.set(ref, cleanState(result.state), { merge: true });
      return result;
    });
    if (!result.ok) throw new HttpsError(result.locked ? "resource-exhausted" : "permission-denied", result.locked ? "Too many attempts. Wait 15 minutes before trying again." : "Code not accepted. Try a new authenticator code or an unused recovery code.");
    return issueSession(identity.uid, result.state);
  }
  await assertRecent(request);
  if (state.enabled && !await validSession(request, state)) throw new HttpsError("permission-denied", "Verify two-factor authentication before changing security settings.");
  const db = admin.firestore();
  const privateRef = db.doc(`funded_mfa_private/${identity.uid}`);
  const publicRef = db.doc(`users/${identity.uid}/security/settings`);
  const userRef = db.doc(`users/${identity.uid}`);
  if (action === "enrollStart") {
    if (state.enabled) throw new HttpsError("failed-precondition", "Two-factor authentication is already enabled.");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const secret = Array.from(randomBytes(32), b => alphabet[b & 31]).join("");
    await db.runTransaction(async tx => {
      const current = await tx.get(privateRef);
      if (current.data()?.enabled) throw new HttpsError("failed-precondition", "Security settings changed.");
      tx.update(privateRef, { pendingSecret: secret, pendingExpiresAt: Date.now() + 600_000 });
    });
    const label = encodeURIComponent(`FYNX Funded:${identity.token.email ?? identity.uid}`);
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=FYNX%20Funded&algorithm=SHA1&digits=6&period=30` };
  }
  if (action === "enrollConfirm") {
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(privateRef);
      const current = snap.data()!;
      if (current.enabled || !current.pendingSecret || current.pendingExpiresAt < Date.now()) throw new HttpsError("failed-precondition", "Start authenticator setup again.");
      const verified = verifyFactor({ ...current, secret: current.pendingSecret } as FactorState, String(request.data?.code ?? "").slice(0, 32), Date.now());
      if (!verified.ok) { tx.update(privateRef, { failures: verified.state.failures ?? 0, windowStarted: verified.state.windowStarted ?? Date.now(), blockedUntil: verified.state.blockedUntil ?? 0 }); return verified; }
      const next = { ...verified.state, enabled: true, version: randomUUID(), secret: current.pendingSecret, recoveryHashes: [] };
      tx.set(privateRef, { enabled: true, version: next.version, secret: next.secret, recoveryHashes: [], lastCounter: next.lastCounter ?? -1, failures: 0, blockedUntil: 0, windowStarted: Date.now() });
      tx.set(publicRef, { twoFactorEnabled: true, mfaVersion: next.version, lastSecurityUpdate: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(userRef, { twoFactorEnabled: true }, { merge: true });
      return { ...verified, state: next };
    });
    if (!result.ok) throw new HttpsError(result.locked ? "resource-exhausted" : "permission-denied", "Setup code was not accepted. Wait for a new code and retry.");
    return issueSession(identity.uid, result.state);
  }
  if (action === "disable") {
    await db.runTransaction(async tx => {
      const current = await tx.get(privateRef);
      if (current.data()?.version !== state.version) throw new HttpsError("aborted", "Security settings changed. Verify again.");
      const next = { enabled: false, version: randomUUID(), secret: "", recoveryHashes: [], lastCounter: -1 };
      tx.set(privateRef, next);
      tx.set(publicRef, { twoFactorEnabled: false, mfaVersion: next.version, lastSecurityUpdate: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(userRef, { twoFactorEnabled: false }, { merge: true });
    });
    return { disabled: true };
  }
  if (action === "recovery") {
    if (!state.enabled) throw new HttpsError("failed-precondition", "Enable two-factor authentication first.");
    const codes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex").toUpperCase().match(/.{4}/g)!.join("-"));
    await db.runTransaction(async tx => {
      const current = await tx.get(privateRef);
      if (current.data()?.version !== state.version) throw new HttpsError("aborted", "Security settings changed. Verify again.");
      tx.update(privateRef, { recoveryHashes: codes.map(codeHash) });
      tx.set(publicRef, { backupCodesGeneratedAt: admin.firestore.FieldValue.serverTimestamp(), lastSecurityUpdate: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    return { codes };
  }
  throw new HttpsError("invalid-argument", "Unsupported security action.");
});

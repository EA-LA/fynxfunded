#!/usr/bin/env node
// Default: print the plan only. --run tests one disposable example.invalid identity.
// OOB links are returned by the authenticated admin API; no verification/reset emails are sent.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const evidence = path.resolve(root, '../evidence');
const project = 'fynx-c7a28';
const args = process.argv.slice(2);
const origin = 'https://www.fynxfunded.com';
const plannedChecks = ['signup', 'unverified_mfa_denied', 'verification_link_no_email', 'verified_password_login', 'customer_mfa_status', 'private_funded_denied', 'logout', 'password_reset_link_no_email', 'password_reset', 'old_password_denied', 'new_password_login', 'cleanup'];
const safeFailure = message => Object.assign(Error(message), { safe: true });

async function main() {
  if (args.some(arg => arg !== '--run')) throw safeFailure('Unsupported argument. Use no arguments for a dry run, or --run.');
  if (!args.includes('--run')) {
    console.log(JSON.stringify({ mode: 'dry-run', project, changesMade: false, requiresExplicitRun: true, plannedChecks, sendsEmail: false, financialRecords: false, ownerClaims: false }));
    return;
  }
  const admin = require('../functions/node_modules/firebase-admin');
  const oauth = require('/Users/h/.npm-global/lib/node_modules/firebase-tools/lib/auth');
  const account = oauth.getGlobalDefaultAccount();
  if (!account) throw safeFailure('Firebase CLI authentication is unavailable.');
  const access = await oauth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const app = admin.initializeApp({ projectId: project, credential: { getAccessToken: async () => ({ access_token: access.access_token, expires_in: 3600 }) } }, 'auth-repair-smoke-' + crypto.randomBytes(4).toString('hex'));
  const auth = app.auth(), db = app.firestore();
  const nonce = crypto.randomBytes(12).toString('hex');
  const email = `fynx-auth-repair-${nonce}@example.invalid`;
  const password = crypto.randomBytes(32).toString('base64url') + '!Aa1';
  const newPassword = crypto.randomBytes(32).toString('base64url') + '!Aa2';
  const startedAt = Date.now();
  const report = { startedAt: new Date(startedAt).toISOString(), project, mode: 'live-disposable-identity', emailSent: false, created: false, passed: false, cleanedUp: false, checks: [] };
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const output = path.join(evidence, `auth-repair-live-smoke-${nonce}.json`);
  let uid, signupAttempted = false, absentBefore = false, apiKey;
  function save() { fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
  function check(name, passed, details = {}) {
    report.checks.push({ name, passed: !!passed, ...details });
    save();
    if (!passed) throw safeFailure(`Authentication acceptance check failed: ${name}.`);
  }
  async function jsonRequest(url, options) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45_000) });
    let body; try { body = await response.json(); } catch { body = {}; }
    return { ok: response.ok, status: response.status, body };
  }
  async function authCall(method, body) {
    return jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Referer: origin + '/' }, body: JSON.stringify(body),
    });
  }
  async function callable(name, token, data = { action: 'status' }) {
    return jsonRequest(`https://us-central1-${project}.cloudfunctions.net/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: origin }, body: JSON.stringify({ data }),
    });
  }
  async function oobCode(requestType) {
    const result = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:sendOobCode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.access_token}` },
      body: JSON.stringify({ requestType, email, returnOobLink: true }),
    });
    const code = typeof result.body.oobLink === 'string' ? new URL(result.body.oobLink).searchParams.get('oobCode') : null;
    check(requestType === 'VERIFY_EMAIL' ? 'verification_link_no_email' : 'password_reset_link_no_email', result.ok && !!code, { status: result.status, returnedLinkWithoutSendingEmail: true });
    return code;
  }
  async function assertOwnedUser(user) {
    if (!user || user.email !== email || !user.uid || (uid && user.uid !== uid) ||
        Date.parse(user.metadata.creationTime) < startedAt - 60_000 ||
        user.customClaims?.fundedOwner || user.customClaims?.admin) {
      throw safeFailure('Disposable account ownership check failed; no unrelated identity will be changed.');
    }
    return user;
  }
  async function cleanup() {
    // A timed-out signup may have succeeded. The preflight absence, unique address,
    // creation time and role checks establish ownership before removing anything.
    if (!signupAttempted || !absentBefore) return;
    let user;
    try { user = uid ? await auth.getUser(uid) : await auth.getUserByEmail(email); }
    catch (error) { if (error.code === 'auth/user-not-found') { report.cleanedUp = true; return; } throw error; }
    await assertOwnedUser(user);
    uid = user.uid;
    report.qaUID = uid;
    const sessions = await db.collection('funded_mfa_sessions').where('uid', '==', uid).get();
    for (const session of sessions.docs) {
      const data = session.data();
      if (data.uid !== uid || !/^[a-f0-9]{64}$/.test(session.id) || !Number.isFinite(data.expiresAt) || data.expiresAt < startedAt || data.expiresAt > Date.now() + 3_600_000) {
        throw safeFailure('Unexpected disposable MFA session; cleanup requires review.');
      }
    }
    const references = [db.doc(`users/${uid}/security/settings`), db.doc(`users/${uid}`), db.doc(`funded_mfa_private/${uid}`), ...sessions.docs.map(doc => doc.ref)];
    const batch = db.batch();
    references.forEach(ref => batch.delete(ref));
    await batch.commit();
    await auth.deleteUser(uid);
    let absent = false;
    try { await auth.getUser(uid); } catch (error) { if (error.code === 'auth/user-not-found') absent = true; else throw error; }
    const remaining = await Promise.all(references.map(ref => ref.get()));
    report.cleanedUp = absent && remaining.every(snapshot => !snapshot.exists);
    report.cleanupDeletedTaskDocuments = references.length;
    if (!report.cleanedUp) throw safeFailure('Disposable identity cleanup could not be verified.');
  }
  try {
    // Use the site's public Firebase configuration; credentials/tokens stay in memory.
    const source = fs.readFileSync(path.join(root, 'src/lib/firebase.ts'), 'utf8');
    apiKey = process.env.VITE_FIREBASE_API_KEY || source.match(/apiKey:.*?\|\|\s*"([^"]+)"/)?.[1];
    if (!apiKey) throw safeFailure('Public Firebase API configuration is unavailable.');
    try { await auth.getUserByEmail(email); throw safeFailure('Disposable email unexpectedly exists; no test account was created.'); }
    catch (error) { if (error.code === 'auth/user-not-found') absentBefore = true; else throw error; }
    signupAttempted = true;
    const signedUp = await authCall('signUp', { email, password, returnSecureToken: true });
    if (signedUp.ok && typeof signedUp.body.localId === 'string') { uid = signedUp.body.localId; report.created = true; report.qaUID = uid; }
    check('signup', signedUp.ok && !!uid && typeof signedUp.body.idToken === 'string', { status: signedUp.status });
    await assertOwnedUser(await auth.getUser(uid));
    const unverified = await callable('fundedMfa', signedUp.body.idToken);
    check('unverified_mfa_denied', unverified.status === 403 && unverified.body.error?.status === 'PERMISSION_DENIED', { status: unverified.status });
    const verification = await authCall('update', { oobCode: await oobCode('VERIFY_EMAIL') });
    check('email_verified', verification.ok && (await auth.getUser(uid)).emailVerified === true, { status: verification.status });
    const loggedIn = await authCall('signInWithPassword', { email, password, returnSecureToken: true });
    check('verified_password_login', loggedIn.ok && loggedIn.body.localId === uid && !!loggedIn.body.idToken, { status: loggedIn.status });
    const token = loggedIn.body.idToken;
    const status = await callable('fundedMfa', token);
    check('customer_mfa_status', status.ok && status.body.result?.required === false && status.body.result?.verified === true, { status: status.status });
    // This endpoint has the server-side owner gate without requiring an App Check
    // bypass token, so denial proves authorization rather than just App Check.
    const privateAccess = await callable('fundedTradeAccess', token);
    check('private_funded_denied', privateAccess.status === 403 && privateAccess.body.error?.status === 'PERMISSION_DENIED', { status: privateAccess.status });
    const appCheckProtected = await callable('fundedPrivateAccess', token);
    check('private_access_endpoint_denied', [401, 403].includes(appCheckProtected.status), { status: appCheckProtected.status });
    const loggedOut = await callable('fundedMfa', token, { action: 'logout' });
    check('logout', loggedOut.ok && loggedOut.body.result?.revoked === true, { status: loggedOut.status });
    const resetCode = await oobCode('PASSWORD_RESET');
    const inspectedReset = await authCall('resetPassword', { oobCode: resetCode });
    check('reset_code_valid', inspectedReset.ok && inspectedReset.body.email === email && inspectedReset.body.requestType === 'PASSWORD_RESET', { status: inspectedReset.status });
    const reset = await authCall('resetPassword', { oobCode: resetCode, newPassword });
    check('password_reset', reset.ok && reset.body.email === email, { status: reset.status });
    const oldLogin = await authCall('signInWithPassword', { email, password, returnSecureToken: true });
    check('old_password_denied', !oldLogin.ok && /^(INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS)$/.test(oldLogin.body.error?.message || ''), { status: oldLogin.status });
    const newLogin = await authCall('signInWithPassword', { email, password: newPassword, returnSecureToken: true });
    check('new_password_login', newLogin.ok && newLogin.body.localId === uid && !!newLogin.body.idToken, { status: newLogin.status });
    const finalStatus = await callable('fundedMfa', newLogin.body.idToken);
    check('new_password_mfa_status', finalStatus.ok && finalStatus.body.result?.verified === true && finalStatus.body.result?.required === false, { status: finalStatus.status });
    await assertOwnedUser(await auth.getUser(uid));
    report.passed = true;
  } catch (error) {
    report.failure = error.safe ? error.message : 'Live acceptance did not complete; credentials and response bodies were not logged.';
    throw error;
  } finally {
    try { await cleanup(); }
    catch (error) { report.cleanupFailure = error.safe ? error.message : 'Disposable identity cleanup requires review; no credentials were logged.'; report.passed = false; }
    report.completedAt = new Date().toISOString();
    save();
    await app.delete();
  }
  if (!report.cleanedUp) throw safeFailure('Live checks finished but disposable identity cleanup requires review.');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, identityDeleted: report.cleanedUp, emailSent: false, report: path.basename(output) }));
}
main().catch(error => {
  console.error(error.safe ? error.message : 'Authentication smoke test failed; inspect sanitized evidence. No credentials logged.');
  process.exitCode = 1;
});

import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { Command, devRules, execute, newAccount, TradeAccount } from './engine';
import { candles, instruments, marketQuotes, SymbolName } from './market';
import { fundedMfa } from '../fundedMfa';
export function developmentOnly() {
  if (process.env.GCLOUD_PROJECT !== 'demo-fynx-trade' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new HttpsError('failed-precondition', 'FYNX Trade is available only in the isolated development emulator.');
}
const id = (value: unknown) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new HttpsError('invalid-argument', 'Invalid request identifier.'); return value; };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function notification(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, uid: string, accountId: string, type: string, now: number) {
  const messageId = `${accountId}-${type}`;
  // Local captured outbox. This deliberately never claims SMTP delivery.
  tx.create(db.doc(`trade_dev_outbox/${messageId}`), { userId: uid, accountId, type, subject: `FYNX Trade: ${type.replace(/_/g, ' ')}`, status: 'captured_locally', link: `http://127.0.0.1:5189/trade?account=${accountId}`, createdAt: now });
}
export async function purchase(uid: string, key: string) {
  developmentOnly(); const db = admin.firestore(), orderId = `dev_${digest([uid, key]).slice(0, 24)}`, accountId = `${orderId}_p1`, now = Date.now();
  const result = await db.runTransaction(async tx => {
    const orderRef = db.doc(`orders/${orderId}`), existing = await tx.get(orderRef);
    if (existing.exists) return { accountId: existing.data()!.accountId, replayed: true };
    const owned = await tx.get(db.collection('accounts').where('userId', '==', uid));
    if (owned.size >= 20) throw new HttpsError('resource-exhausted', 'Development account limit reached.');
    const account = newAccount({ accountId, userId: uid, orderId, challengeId: orderId, phase: 1 }, now);
    tx.create(orderRef, { userId: uid, orderId, accountId, challengeId: orderId, status: 'paid', paymentMode: 'synthetic', chargedAmount: 0, amount: 0, currency: 'USD', environment: 'development', createdAt: now });
    tx.create(db.doc(`challenges/${orderId}`), { userId: uid, orderId, status: 'active', currentPhase: 1, brokerAccountId: accountId, accountSize: 25000, rulesVersion: 'dev-25k-v1', environment: 'development', createdAt: now });
    tx.create(db.doc(`accounts/${accountId}`), account);
    tx.create(db.doc(`trade_dev_events/${orderId}`), { userId: uid, accountId, type: 'simulated_purchase_provisioned', at: now, detail: 'No charge. Internal $25,000 phase-one simulation.' });
    notification(tx, db, uid, accountId, 'account_ready', now);
    return { accountId, replayed: false };
  });
  return result;
}
export async function transact(uid: string, accountId: string, command: Command, key: string, testTime?: number) {
  developmentOnly(); const db = admin.firestore(), fingerprint = digest(command), receiptId = digest([uid, accountId, key]);
  return db.runTransaction(async tx => {
    const ref = db.doc(`accounts/${accountId}`), receiptRef = db.doc(`trade_dev_requests/${receiptId}`);
    const [snapshot, receipt] = await Promise.all([tx.get(ref), tx.get(receiptRef)]);
    if (!snapshot.exists || snapshot.data()!.userId !== uid) throw new HttpsError('not-found', 'Trading account not found.');
    if (receipt.exists) {
      if (receipt.data()!.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Request identifier was already used for a different command.');
      return { replayed: true, status: receipt.data()!.status, revision: receipt.data()!.revision };
    }
    const previous = snapshot.data() as TradeAccount;
    // Recompute after the read on every retry. A worker can commit a newer
    // quote while this request is waiting for Firestore's transaction lock.
    const now = testTime ?? Date.now();
    if (command.action === 'tick' && (previous.status !== 'active' || previous.updatedAt > now)) return { replayed: false, status: previous.status, revision: previous.revision };
    if (command.action !== 'tick') {
      const limiter = await tx.get(db.doc(`trade_dev_limits/${uid}`));
      const recent = (limiter.data()?.timestamps ?? []).filter((t: number) => t > now - 60000);
      if (recent.length >= 60) throw new HttpsError('resource-exhausted', 'Too many orders. Wait a minute.');
      tx.set(db.doc(`trade_dev_limits/${uid}`), { timestamps: [...recent, now] });
    }
    const result = execute(previous, command, marketQuotes(now), now);
    if (result.account.status === 'passed' && previous.status === 'active' && result.account.phase === 1) {
      const nextId = `${previous.orderId}_p2`;
      result.account.nextAccountId = nextId;
      tx.create(db.doc(`accounts/${nextId}`), newAccount({ accountId: nextId, userId: uid, orderId: previous.orderId, challengeId: previous.challengeId, phase: 2 }, now));
      tx.update(db.doc(`challenges/${previous.challengeId}`), { currentPhase: 2, brokerAccountId: nextId });
      notification(tx, db, uid, nextId, 'phase_two_ready', now);
    }
    if (result.account.status === 'failed' || (result.account.status === 'passed' && result.account.phase === 2)) {
      tx.update(db.doc(`challenges/${previous.challengeId}`), { status: result.account.status, reviewRequired: result.account.phase === 2 });
      if (previous.status === 'active') notification(tx, db, uid, accountId, result.account.status === 'failed' ? 'challenge_failed' : 'funded_review_required', now);
    }
    tx.set(ref, result.account);
    for (const [index, event] of result.events.entries()) tx.create(db.doc(`trade_dev_events/${accountId}_${result.account.revision}_${index}`), { userId: uid, accountId, revision: result.account.revision, ...event });
    // Every customer command has a durable receipt. Background ticks need none.
    if (command.action !== 'tick') tx.create(receiptRef, { userId: uid, accountId, fingerprint, status: result.account.status, revision: result.account.revision, createdAt: now });
    return { replayed: false, status: result.account.status, revision: result.account.revision };
  });
}
async function customer(request: CallableRequest) {
  developmentOnly();
  if (!request.auth || request.auth.token.email_verified !== true) throw new HttpsError('unauthenticated', 'Sign in with a verified development account.');
  const user = await admin.auth().getUser(request.auth.uid);
  if (user.disabled || !user.emailVerified) throw new HttpsError('permission-denied', 'This account cannot trade.');
  const validAfter = Date.parse(user.tokensValidAfterTime ?? '') / 1000;
  if (Number(request.auth.token.auth_time) < validAfter) throw new HttpsError('unauthenticated', 'Sign in again.');
  const security = await fundedMfa.run({ ...request, data: { action: 'status' } }) as { verified?: boolean };
  if (security?.verified !== true) throw new HttpsError('permission-denied', 'Complete two-factor verification before trading.');
  // Production roles/claims never grant access to somebody else's dev account.
  return request.auth.uid;
}
export const fynxTradeDev = onCall({ region: 'us-central1', maxInstances: 1 }, async request => {
  const uid = await customer(request), data = request.data ?? {}, db = admin.firestore();
  try {
    if (data.action === 'purchase') return purchase(uid, id(data.requestId));
    if (data.action === 'snapshot') {
      const rows = await db.collection('accounts').where('userId', '==', uid).limit(21).get();
      if (rows.size > 20) throw new HttpsError('resource-exhausted', 'Development account limit exceeded.');
      const owned = rows.docs.map(d => d.data() as TradeAccount);
      const account = data.accountId ? owned.find(a => a.accountId === id(data.accountId)) : owned.find(a => a.status === 'active') ?? owned[0];
      if (data.accountId && !account) throw new HttpsError('not-found', 'Trading account not found.');
      const symbol = (data.symbol || 'EURUSD') as SymbolName, now = Date.now();
      const outbox = await db.collection('trade_dev_outbox').where('userId', '==', uid).limit(40).get();
      return { environment: 'development', accounts: owned.map(a => ({ accountId: a.accountId, phase: a.phase, status: a.status, balance: a.balance, equity: a.equity })), account: account ?? null, quotes: marketQuotes(now), instruments, candles: candles(symbol, Number(data.timeframe) || 60, now), rules: devRules, outbox: outbox.docs.map(d => d.data()), serverTime: now };
    }
    const accountId = id(data.accountId), requestId = id(data.requestId);
    let command: Command;
    if (data.action === 'place') {
      const input = data.order ?? {};
      // Deliberate allowlist: client balances, fills, prices and P&L are never trusted.
      command = { action: 'place', order: { id: requestId, symbol: input.symbol, side: input.side, kind: input.kind, lots: input.lots,
        ...(input.price !== undefined ? { price: input.price } : {}), ...(input.sl !== undefined ? { sl: input.sl } : {}), ...(input.tp !== undefined ? { tp: input.tp } : {}) } };
    } else if (data.action === 'close') command = { action: 'close', positionId: id(data.positionId), lots: data.lots };
    else if (data.action === 'cancel') command = { action: 'cancel', orderId: id(data.orderId) };
    else throw new HttpsError('invalid-argument', 'Unsupported trading action.');
    return await transact(uid, accountId, command, requestId);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'Trading request failed.');
  }
});

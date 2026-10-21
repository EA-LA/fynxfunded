import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { documentId } from '../nativeCustomerPolicy';
import { recipientHash } from './deliveryPolicy';

export function accessEmail(accountId: string, amount: number, activated = false) {
  documentId(accountId);
  if (!Number.isFinite(amount) || amount <= 0) throw Error('Invalid account size.');
  const url = `https://www.fynxfunded.com/trade/access?account=${encodeURIComponent(accountId)}`;
  const balance = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  const message = {
    subject: 'Your FYNX Trade account access is ready',
    text: `Your purchase is confirmed and your ${balance} simulated challenge account has been created. Account ID: ${accountId}. Open FYNX Trade: ${url}\nSign in with the same FYNX email and password, Google or Apple account you used at checkout. You do not need a second login or a trading password. Trading is not available yet. Your account access is ready for viewing. Never share your password or verification codes.`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#090b10;color:#f6f7fb;font-family:Arial,sans-serif"><div style="max-width:560px;margin:auto;padding:40px 24px"><p style="letter-spacing:3px;color:#a5b1c7">FYNX / TRADE</p><h1>Your account access is ready.</h1><p style="line-height:1.7;color:#c4cbd7">Your purchase is confirmed. Your <strong>${balance} simulated challenge account</strong> is now connected to your existing FYNX login.</p><div style="padding:20px;background:#151a25;border:1px solid #313949;border-radius:12px"><p>Account ID</p><p style="font-size:13px;overflow-wrap:anywhere">${accountId}</p><p>Phase 1 · Simulated funds · Trading not yet available</p></div><p style="margin:32px 0"><a href="${url}" style="display:inline-block;background:#b3f2ce;color:#102419;text-decoration:none;padding:16px 24px;border-radius:8px;font-weight:bold">Open FYNX Trade →</a></p><p style="line-height:1.7;color:#c4cbd7">Use the same email and password, Google or Apple account you used at checkout. No second login or trading password is needed.</p><p style="color:#9aa6b8;font-size:12px">Account access is ready for viewing. Trading is not available yet. Never share your password or verification codes.</p><a style="color:#b3f2ce" href="mailto:support@fynxfunded.com">Contact FYNX support</a></div></body></html>`,
  };
  if (activated) {
    message.subject = 'Your FYNX Trade account access is activated';
    message.text = `You activated account access for ${accountId}. Sign in to view your ${balance} simulated account: ${url}\nTrading is not available yet. Activation does not place an order, start a trading day, or enable trading. If you did not activate access, contact support@fynxfunded.com. Never share your password or verification codes.`;
    message.html = message.html
      .replace('Your account access is ready.', 'Your account access is activated.')
      .replace('Your purchase is confirmed.', 'Your account access was activated.')
      .replace('Account access is ready for viewing.', 'Activation opens account viewing. It does not place an order or start a trading day.');
  }
  return message;
}

export class MailRejected extends Error {
  constructor(public readonly retryable: boolean) { super('Email provider rejected the request.'); }
}
export type MailSender = (to: string, message: ReturnType<typeof accessEmail>, jobId: string) => Promise<{ providerId: string }>;
export function mailgunSender(key: string): MailSender {
  return async (to, message, jobId) => {
    const body = new URLSearchParams({ from: 'FYNX Trade <security@mail.fynxfunded.com>', to, ...message,
      'v:notification-id': jobId, 'o:tag': 'fynx-trade-access', 'o:tracking': 'no' });
    const r = await fetch('https://api.mailgun.net/v3/mail.fynxfunded.com/messages', { method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new MailRejected(r.status === 429 || r.status >= 500);
    const result = await r.json() as { id?: string };
    if (!result.id) throw Error('Provider acknowledgement unavailable.');
    return { providerId: result.id };
  };
}

/** Leases suppress concurrent sends. An ambiguous transport result is held for manual review. */
export async function deliverAccessEmail(db: FirebaseFirestore.Firestore, auth: admin.auth.Auth, jobId: string, send: MailSender) {
  documentId(jobId);
  const ref = db.doc(`trade_access_mail/${jobId}`), lease = randomUUID();
  const job = await db.runTransaction(async tx => {
    const m = (await tx.get(ref)).data(), now = Date.now();
    if (!m || !['pending', 'sending'].includes(m.status)) return null;
    if (m.status === 'sending') {
      if (m.leaseUntil <= now) tx.update(ref, { status: 'delivery_unknown', nextAttemptAt: null, reason: 'Expired send lease; reconcile provider logs before retry.' });
      return null;
    }
    if (m.nextAttemptAt > now) return null;
    const [a, o, c] = await Promise.all([tx.get(db.doc(`accounts/${documentId(m.accountId)}`)), tx.get(db.doc(`orders/${documentId(m.orderId)}`)), tx.get(db.doc(`challenges/${documentId(m.challengeId)}`))]);
    const account = a.data(), order = o.data(), challenge = c.data();
    if (!account || account.userId !== m.userId || account.platform !== 'FYNX Trade' || account.status !== 'active'
      || account.orderId !== m.orderId || account.challengeId !== m.challengeId || account.provisioningStatus !== 'access_ready'
      || !order || order.userId !== m.userId || order.status !== 'paid' || order.challengeId !== m.challengeId
      || !challenge || challenge.userId !== m.userId || challenge.brokerAccountId !== m.accountId || challenge.status !== 'active') {
      tx.update(ref, { status: 'cancelled', nextAttemptAt: null, reason: 'Current account or payment no longer allows account-ready email.' }); return null;
    }
    const user = await auth.getUser(m.userId);
    if (!user.emailVerified || user.disabled || !user.email) {
      tx.update(ref, { status: 'blocked', nextAttemptAt: null, reason: 'Verified enabled customer email required.' }); return null;
    }
    const hash = recipientHash(user.email);
    const suppression = await tx.get(db.doc(`trade_mail_suppressions/${hash}`));
    if (suppression.exists) {
      tx.update(ref, { status: 'blocked', nextAttemptAt: null, reason: 'Recipient delivery is suppressed; support review required.' }); return null;
    }
    if (!['account_access_ready', 'account_access_activated'].includes(m.kind)
      || (m.kind === 'account_access_activated' && account.activationStatus !== 'active')) {
      tx.update(ref, { status: 'cancelled', nextAttemptAt: null, reason: 'Notification state no longer matches the account.' }); return null;
    }
    const attempts = (m.attempts ?? 0) + 1;
    tx.update(ref, { status: 'sending', attempts, lease, recipientHash: hash, leaseUntil: now + 120000, nextAttemptAt: now + 120000, updatedAt: FieldValue.serverTimestamp() });
    return { email: user.email, size: account.startingBalance, accountId: m.accountId, attempts, activated: m.kind === 'account_access_activated' };
  });
  if (!job) return;
  let update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>;
  try {
    const result = await send(job.email, accessEmail(job.accountId, job.size, job.activated), jobId);
    update = { status: 'provider_accepted', providerId: result.providerId, acceptedAt: FieldValue.serverTimestamp(), nextAttemptAt: null };
  } catch (e) {
    const retry = e instanceof MailRejected && e.retryable && job.attempts < 8;
    update = { status: retry ? 'pending' : e instanceof MailRejected ? 'failed' : 'delivery_unknown',
      nextAttemptAt: retry ? Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts) : null,
      reason: retry ? 'Provider rejected request; retry scheduled.' : 'Review provider logs before any manual retry.' };
  }
  // If this acknowledgement fails, the expired lease becomes delivery_unknown, never an automatic duplicate.
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.lease === lease && current.status === 'sending') tx.update(ref, { ...update, leaseUntil: 0, updatedAt: FieldValue.serverTimestamp() });
  });
}

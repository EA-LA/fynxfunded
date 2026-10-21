import * as admin from 'firebase-admin';
import { documentId } from '../nativeCustomerPolicy';
import { developmentOnly } from './environment';

export type LifecycleKind = 'account_ready' | 'account_activated' | 'phase_two_ready' | 'challenge_failed' | 'funded_review_required';
export function developmentEmail(accountId: string, type: LifecycleKind) {
  documentId(accountId);
  const details: Record<LifecycleKind, [string, string]> = {
    account_ready: ['Your demo account is ready to activate', 'Your simulated purchase created a $25,000 development account. No payment was taken. Activate it using your existing development login.'],
    account_activated: ['Your demo account is activated', 'Account activation is complete. You can place simulated orders using synthetic prices in the local development terminal.'],
    phase_two_ready: ['Phase 1 passed — activate your Phase 2 demo', 'The server confirmed the Phase 1 target and rules. Your Phase 2 development account has been created. Activate it to continue.'],
    challenge_failed: ['Your demo evaluation has ended', 'The server detected a loss-limit breach. Positions were closed, pending orders cancelled, and new trading disabled. Your history remains available.'],
    funded_review_required: ['Phase 2 passed — review required', 'The server confirmed Phase 2 completion. Further eligibility and agreement review is required. No funded account or real-money payout has been approved.'],
  };
  const detail = details[type];
  if (!detail) throw Error('Unknown lifecycle event.');
  const url = `http://127.0.0.1:5189/trade?account=${encodeURIComponent(accountId)}`;
  return {
    subject: `[FYNX DEVELOPMENT] ${detail[0]}`,
    text: `${detail[1]}\nAccount: ${accountId}\nOpen FYNX Trade: ${url}\nDevelopment simulation only. Synthetic prices and virtual funds. No password is included.`,
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;background:#0b1220;color:#f8fafc;padding:32px"><main style="max-width:560px;margin:auto"><p>FYNX / TRADE · DEVELOPMENT</p><h1>${detail[0]}</h1><p style="line-height:1.7">${detail[1]}</p><p>Account: ${accountId}</p><p><a style="color:#83e3bd" href="${url}">Open FYNX Trade</a></p><p>Synthetic prices · Virtual funds · No real charge or payout</p></main></body></html>`,
  };
}

/** Atomic local mailbox delivery. No external network or real recipient is used. */
export async function deliverDevelopmentMail() {
  developmentOnly();
  const db = admin.firestore();
  const pending = await db.collection('trade_dev_outbox').where('status', 'in', ['pending', 'captured_locally']).limit(100).get();
  for (const row of pending.docs) {
    await db.runTransaction(async tx => {
      const job = (await tx.get(row.ref)).data();
      if (!job || !['pending', 'captured_locally'].includes(job.status)) return;
      const account = (await tx.get(db.doc(`accounts/${documentId(job.accountId)}`))).data();
      if (!account || account.userId !== job.userId || account.environment !== 'development') throw Error('Local mail account binding is invalid.');
      const email = developmentEmail(job.accountId, job.type);
      const mailbox = db.doc(`trade_dev_mailbox/${row.id}`);
      const existing = await tx.get(mailbox);
      if (!existing.exists) tx.create(mailbox, { ...email, userId: job.userId, accountId: job.accountId, type: job.type, deliveredAt: Date.now(), transport: 'local_mailbox' });
      tx.update(row.ref, { ...email, status: 'delivered_to_local_mailbox', deliveredAt: Date.now() });
    });
  }
}

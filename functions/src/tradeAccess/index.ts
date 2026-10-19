import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { provisionTradeAccess, tradeAccessEnabled } from './provision';
import { deliverAccessEmail, mailgunSender } from './mail';
const mailgun = defineSecret('MAILGUN_API_KEY');
export { fundedTradeAccess } from './service';

export const createPurchasedTradeAccess = onDocumentWritten({ document: 'orders/{orderId}', region: 'us-central1', retry: true }, async event => {
  if (!tradeAccessEnabled() || !event.data?.after.exists) return;
  await provisionTradeAccess(admin.firestore(), event.params.orderId);
});

export const sendTradeAccessEmail = onDocumentWritten({ document: 'trade_access_mail/{jobId}', region: 'us-central1', secrets: [mailgun], retry: true }, async event => {
  if (!tradeAccessEnabled() || !event.data?.after.exists) return;
  await deliverAccessEmail(admin.firestore(), admin.auth(), event.params.jobId, mailgunSender(mailgun.value()));
});

export const retryTradeAccessEmails = onSchedule({ schedule: 'every 5 minutes', region: 'us-central1', secrets: [mailgun], timeoutSeconds: 540, maxInstances: 1 }, async () => {
  if (!tradeAccessEnabled()) return;
  const db = admin.firestore();
  const due = await db.collection('trade_access_mail').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(20).get();
  for (const job of due.docs) {
    try { await deliverAccessEmail(db, admin.auth(), job.id, mailgunSender(mailgun.value())); }
    catch { console.error('Trade access email worker failed', { jobId: job.id }); }
  }
});

import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { verifiedDeliveryEvent } from './deliveryPolicy';
import { recordDelivery } from './delivery';
import { provisionTradeAccess, tradeAccessEnabled } from './provision';
import { deliverAccessEmail, mailgunSender } from './mail';
const mailgun = defineSecret('MAILGUN_API_KEY');
const webhookKey = defineSecret('MAILGUN_WEBHOOK_SIGNING_KEY');
export { fundedTradeAccess } from './service';

export const tradeMailDeliveryWebhook = onRequest({ region: 'us-central1', invoker: 'public', secrets: [webhookKey], maxInstances: 5 }, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).end(); return; }
  if (!request.is('application/json') || request.rawBody.length > 65536) { response.status(400).end(); return; }
  let event;
  try { event = verifiedDeliveryEvent(request.body, webhookKey.value()); }
  catch { response.status(406).send('Invalid event.'); return; }
  if (!event) { response.status(200).end(); return; }
  try { await recordDelivery(admin.firestore(), event); response.status(200).end(); }
  catch { response.status(503).send('Retry delivery confirmation.'); }
});

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

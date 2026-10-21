import { FieldValue } from 'firebase-admin/firestore';
import { DeliveryEvent, providerMessageId, shouldApplyDelivery } from './deliveryPolicy';

/** Store only correlation and delivery status; never persist webhook bodies or recipient addresses. */
export async function recordDelivery(db: FirebaseFirestore.Firestore, event: DeliveryEvent) {
  return db.runTransaction(async tx => {
    const jobRef = db.doc(`trade_access_mail/${event.jobId}`);
    const receiptRef = db.doc(`trade_mail_events/${event.id}`);
    const tokenRef = db.doc(`trade_mail_tokens/${event.tokenId}`);
    const [jobSnap, receipt, token] = await Promise.all([tx.get(jobRef), tx.get(receiptRef), tx.get(tokenRef)]);
    if (receipt.exists) return { duplicate: true };
    if (token.exists) throw Error('Webhook token already used.');
    const job = jobSnap.data();
    if (!job || !job.recipientHash || job.recipientHash !== event.recipientHash
      || (job.providerId && providerMessageId(job.providerId) !== event.providerId)
      || !['sending', 'provider_accepted', 'delivery_unknown', 'failed'].includes(job.status)) throw Error('Delivery correlation unavailable.');
    const now = FieldValue.serverTimestamp();
    tx.create(tokenRef, { eventId: event.id, createdAt: now });
    tx.create(receiptRef, { jobId: event.jobId, providerId: event.providerId, state: event.state, eventAt: event.timestamp, createdAt: now });
    if (event.state === 'bounced' || event.state === 'complained') {
      tx.set(db.doc(`trade_mail_suppressions/${event.recipientHash}`), { reason: event.state, eventId: event.id, updatedAt: now }, { merge: true });
    }
    if (shouldApplyDelivery(job, event)) {
      tx.update(jobRef, { deliveryStatus: event.state, deliveryEventAt: event.timestamp, providerId: event.providerId,
        status: ['bounced', 'complained'].includes(event.state) ? 'failed' : 'provider_accepted',
        nextAttemptAt: null, leaseUntil: 0, updatedAt: now });
    }
    return { duplicate: false };
  });
}

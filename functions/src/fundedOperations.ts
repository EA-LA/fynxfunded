import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { nativeCustomer } from './nativeCustomer';
import { operationsSnapshot } from './fundedOperationsPolicy';
import { paymentsPaused } from './stripe/paymentAvailability';

const owners = new Set(['ha6876122@gmail.com', 'fynxteam5@gmail.com']);
export const fundedOperations = onCall({ region: 'us-central1', maxInstances: 3 }, async request => {
  if (!request.auth || request.auth.token.email_verified !== true || !owners.has(String(request.auth.token.email ?? '').toLowerCase())) {
    throw new HttpsError('permission-denied', 'Only verified FYNX owner admins can view operations.');
  }
  await nativeCustomer(request); // Revoked sessions and the coordinated MFA policy still apply.
  if (request.data?.action !== 'status') throw new HttpsError('invalid-argument', 'Unknown operations action.');
  const report = (await admin.firestore().doc('funded_reconciliation/current').get()).data();
  return { ...operationsSnapshot(report), purchasesPaused: paymentsPaused(), progressionPaused: true };
});

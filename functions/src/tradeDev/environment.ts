import { HttpsError } from 'firebase-functions/v2/https';

export function developmentOnly() {
  if (process.env.GCLOUD_PROJECT !== 'demo-fynx-trade'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') {
    throw new HttpsError('failed-precondition', 'FYNX Trade is available only in the isolated development emulator.');
  }
}

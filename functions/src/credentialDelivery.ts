import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { confirmedAccount } from './fundedProvisioningPolicy';
const mailgunApiKey = defineSecret('MAILGUN_API_KEY');
export function accountReadyMessage(challengeId: string) {
  const url = `https://www.fynxfunded.com/dashboard/accounts/${encodeURIComponent(challengeId)}`;
  return { text: `Your FYNX Funded simulated trading account is ready. Sign in to view your protected platform access: ${url}. Trading passwords are never sent by email.`,
    html: `<h1>Your simulated trading account is ready</h1><p>Sign in to FYNX Funded to view your protected trading access. Trading passwords are never sent by email.</p><p><a href="${url}">Open your account</a></p>` };
}
export const sendBrokerCredentialsEmail = onDocumentWritten({ document: 'accounts/{accountId}', region: 'us-central1', secrets: [mailgunApiKey], retry: true }, async event => {
  if (!event.data?.after.exists) return;
  const db = admin.firestore(), accountId = event.params.accountId;
  // Read current state: an old delivery event must not rebind a closed or reassigned account.
  const account = (await db.doc(`accounts/${accountId}`).get()).data();
  if (!account || account.qaRun || !confirmedAccount(account) || account.status !== 'active') return;
  const challengeId = account.challengeId;
  if (typeof challengeId !== 'string' || challengeId.includes('/')) return;
  const [challenge, vault, user] = await Promise.all([db.doc(`challenges/${challengeId}`).get(), db.doc(`funded_account_secrets/${accountId}`).get(), admin.auth().getUser(account.userId)]);
  if (challenge.data()?.userId !== account.userId || challenge.data()?.brokerAccountId !== accountId || !vault.exists || !user.email || !user.emailVerified || user.disabled) return;
  const ref = db.doc(`credential_deliveries/ready_${accountId}`), now = Date.now();
  const send = await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    if (previous?.status === 'sent') return false;
    if (previous?.leaseUntil > now) throw Error('Account notification delivery in progress.');
    tx.set(ref, { userId: account.userId, accountId, challengeId, status: 'sending', leaseUntil: now + 120000, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); return true;
  });
  if (!send) return;
  try {
    const message = accountReadyMessage(challengeId);
    const body = new URLSearchParams({ from: 'FYNX Funded Accounts <security@mail.fynxfunded.com>', to: user.email, subject: 'Your FYNX Funded account is ready', ...message });
    const response = await fetch('https://api.mailgun.net/v3/mail.fynxfunded.com/messages', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`api:${mailgunApiKey.value()}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('Account notification delivery failed.');
    await ref.set({ status: 'sent', leaseUntil: 0, sentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch { await ref.set({ status: 'pending', leaseUntil: 0 }, { merge: true }); throw Error('Account notification pending; retry required.'); }
});

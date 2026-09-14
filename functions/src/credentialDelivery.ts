import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

const mailgunApiKey = defineSecret("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = "mail.fynxfunded.com";
const MAILGUN_SENDER = "FYNX Funded Accounts <security@mail.fynxfunded.com>";

type BrokerCredentials = {
  accountId: string;
  userId: string;
  challengeId: string;
  platform: string;
  server: string;
  login: string;
  password: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] || character);
}

function deliveryId(credentials: BrokerCredentials) {
  const version = createHash("sha256")
    .update(`${credentials.accountId}:${credentials.platform}:${credentials.server}:${credentials.login}:${credentials.password}`)
    .digest("hex")
    .slice(0, 20);
  return `${credentials.accountId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70)}_${version}`;
}

function completeCredentials(accountId: string, data: FirebaseFirestore.DocumentData): BrokerCredentials | null {
  const credentials = {
    accountId,
    userId: text(data.userId),
    challengeId: text(data.challengeId || data.challengeRef),
    platform: text(data.platform),
    server: text(data.server),
    login: text(data.login),
    password: text(data.password),
  };
  return credentials.userId && credentials.platform && credentials.server && credentials.login && credentials.password
    ? credentials
    : null;
}

function credentialEmailHtml(credentials: BrokerCredentials, traderName: string) {
  const name = escapeHtml(traderName || "Trader");
  const platform = escapeHtml(credentials.platform.toUpperCase());
  const server = escapeHtml(credentials.server);
  const login = escapeHtml(credentials.login);
  const password = escapeHtml(credentials.password);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050505;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#fff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your FYNX Funded trading account is ready.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;">
<tr><td align="center" style="padding:0 0 22px;"><img src="https://www.fynxfunded.com/fynx-sender-logo.png" width="80" height="80" alt="FYNX" style="display:block;width:80px;height:80px;border:1px solid #303030;border-radius:20px;"><div style="padding-top:12px;font-size:22px;font-weight:800;">FYNX <span style="color:#999;font-weight:500;">Funded</span></div></td></tr>
<tr><td style="background:#111;border:1px solid #303030;border-radius:18px;padding:36px 38px;">
<div style="display:inline-block;padding:7px 11px;border:1px solid #444;border-radius:999px;background:#1b1b1b;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Account ready</div>
<h1 style="margin:20px 0 10px;font-size:30px;line-height:1.2;">Your trading credentials.</h1>
<p style="margin:0 0 24px;color:#aaa;font-size:15px;line-height:1.7;">Hello ${name}, your broker account has been provisioned. Use the details below to connect your trading platform.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#080808;border:1px solid #303030;border-radius:13px;padding:6px 18px;">
<tr><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#999;font-size:13px;">Platform</td><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;text-align:right;font-size:14px;font-weight:700;">${platform}</td></tr>
<tr><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#999;font-size:13px;">Server</td><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;text-align:right;font-size:14px;font-weight:700;">${server}</td></tr>
<tr><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#999;font-size:13px;">Login</td><td style="padding:14px 0;border-bottom:1px solid #2d2d2d;text-align:right;font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700;">${login}</td></tr>
<tr><td style="padding:14px 0;color:#999;font-size:13px;">Password</td><td style="padding:14px 0;text-align:right;font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700;">${password}</td></tr>
</table>
<div style="margin:24px 0;padding:16px 18px;border-left:3px solid #fff;background:#1a1a1a;border-radius:8px;color:#cfcfcf;font-size:13px;line-height:1.6;"><strong style="color:#fff;">Keep these details private.</strong><br>FYNX support will never ask you to send your password by email or chat. If you did not expect this account, contact support immediately.</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#fff;"><a href="https://www.fynxfunded.com/dashboard/accounts/${encodeURIComponent(credentials.challengeId)}" style="display:inline-block;padding:14px 22px;color:#000;text-decoration:none;font-size:14px;font-weight:800;">Open account workspace&nbsp; →</a></td></tr></table>
</td></tr><tr><td align="center" style="padding:24px 20px;color:#777;font-size:12px;line-height:1.7;">FYNX Funded account access<br><a href="https://www.fynxfunded.com" style="color:#fff;text-decoration:none;">fynxfunded.com</a> &nbsp;•&nbsp; <a href="mailto:support@fynxfunded.com" style="color:#fff;text-decoration:none;">support@fynxfunded.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendCredentialEmail(email: string, traderName: string, credentials: BrokerCredentials) {
  const plainText = `Hello ${traderName || "Trader"}, your FYNX Funded trading account is ready. Platform: ${credentials.platform.toUpperCase()}. Server: ${credentials.server}. Login: ${credentials.login}. Password: ${credentials.password}. Keep these details private. FYNX support will never ask you to send your password by email or chat.`;
  const form = new URLSearchParams({
    from: MAILGUN_SENDER,
    to: email,
    subject: "Your FYNX Funded trading account is ready",
    text: plainText,
    html: credentialEmailHtml(credentials, traderName),
    "v:account-id": credentials.accountId,
  });
  const authorization = Buffer.from(`api:${mailgunApiKey.value()}`).toString("base64");
  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    console.error("Mailgun rejected credential delivery", { status: response.status, providerMessage, accountId: credentials.accountId });
    throw new Error("Credential email delivery failed");
  }
}

export const sendBrokerCredentialsEmail = onDocumentWritten(
  { document: "accounts/{accountId}", region: "us-central1", secrets: [mailgunApiKey], retry: true },
  async (event) => {
    if (!event.data?.after.exists) return;
    const account = event.data.after.data();
    if (!account) return;
    const credentials = completeCredentials(event.params.accountId, account);
    if (!credentials) return;

    const db = admin.firestore();
    const userSnapshot = await db.collection("users").doc(credentials.userId).get();
    const user = userSnapshot.data() || {};
    const email = text(user.email);
    if (!email) throw new Error(`Cannot deliver credentials for account ${credentials.accountId}: user email is missing`);

    const notificationRef = db.collection("credential_deliveries").doc(deliveryId(credentials));
    const shouldSend = await db.runTransaction(async (transaction) => {
      const notification = await transaction.get(notificationRef);
      if (notification.data()?.status === "sent") return false;
      transaction.set(notificationRef, {
        accountId: credentials.accountId,
        challengeId: credentials.challengeId,
        userId: credentials.userId,
        recipient: email,
        status: "sending",
        attempts: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!shouldSend) return;

    try {
      await sendCredentialEmail(email, text(user.fullName || user.displayName), credentials);
      const batch = db.batch();
      batch.set(notificationRef, { status: "sent", sentAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      batch.set(event.data.after.ref, { credentialEmailStatus: "sent", credentialEmailSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (credentials.challengeId) {
        batch.set(db.collection("challenges").doc(credentials.challengeId), {
          brokerAccountId: credentials.accountId,
          accountReference: credentials.login,
          credentialsProvisionedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      batch.set(db.collection("audit_logs").doc(), {
        accountId: credentials.accountId,
        challengeId: credentials.challengeId,
        userId: credentials.userId,
        action: "broker_credentials_delivered",
        result: "sent",
        recipient: email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      await notificationRef.set({ status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "Unknown delivery error", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      throw error;
    }
  },
);

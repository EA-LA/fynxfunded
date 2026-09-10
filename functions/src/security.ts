import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

const mailgunApiKey = defineSecret("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = "mail.fynxfunded.com";
const MAILGUN_SENDER = "FYNX Funded Security <security@mail.fynxfunded.com>";

interface LoginAlertSession {
  device?: string;
  browser?: string;
  ip?: string;
  location?: string;
  createdAt?: string;
  lastActive?: string;
}

function safeText(value: unknown, fallback = "Unknown"): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
}

export const sendLoginAlert = onCall({ secrets: [mailgunApiKey] }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Auth required");

  const uid = request.auth.uid;
  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  const settingsSnap = await admin.firestore().collection("users").doc(uid).collection("security").doc("settings").get();
  const settings = settingsSnap.data() || {};

  if (!settings.loginAlertsEnabled) {
    return { sent: false, reason: "login_alerts_disabled" };
  }

  const user = userSnap.data() || {};
  const email = safeText(user.email || request.auth.token.email, "");
  if (!email) throw new HttpsError("failed-precondition", "User email is unavailable");

  const session = (request.data?.session || {}) as LoginAlertSession;
  const alert = {
    userId: uid,
    to: email,
    subject: "New sign-in to your FYNX Funded account",
    device: safeText(session.device),
    browser: safeText(session.browser),
    ip: safeText(session.ip),
    location: safeText(session.location, "Location unavailable"),
    time: safeText(session.createdAt || session.lastActive, new Date().toISOString()),
    status: "queued",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const text = `New login detected for your FYNX Funded account. Device: ${alert.device}. Browser: ${alert.browser}. IP: ${alert.ip}. Location: ${alert.location}. Time: ${alert.time}. If this was not you, reset your password immediately.`;
  const form = new URLSearchParams({
    from: MAILGUN_SENDER,
    to: email,
    subject: alert.subject,
    text,
  });
  const authorization = Buffer.from(`api:${mailgunApiKey.value()}`).toString("base64");
  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    console.error("Mailgun rejected login alert", { status: response.status, providerMessage });
    throw new HttpsError("internal", "The login alert could not be delivered");
  }

  await admin.firestore().collection("users").doc(uid).collection("securityEvents").add({
    type: "login_alert_sent",
    ...alert,
    status: "sent",
  });

  return { sent: true };
});

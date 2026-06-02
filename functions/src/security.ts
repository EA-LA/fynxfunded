import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

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

export const sendLoginAlert = onCall(async (request) => {
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

  // This queue document is intentionally provider-neutral. A transactional email
  // extension or worker can deliver it without exposing mail credentials to the client.
  await admin.firestore().collection("mail").add({
    to: email,
    message: {
      subject: alert.subject,
      text: `New login detected. Device: ${alert.device}. Browser: ${alert.browser}. IP: ${alert.ip}. Location: ${alert.location}. Time: ${alert.time}.`,
      html: `<p>New login detected for your FYNX Funded account.</p><ul><li>Device: ${alert.device}</li><li>Browser: ${alert.browser}</li><li>IP: ${alert.ip}</li><li>Location: ${alert.location}</li><li>Time: ${alert.time}</li></ul>`,
    },
    metadata: alert,
  });

  await admin.firestore().collection("users").doc(uid).collection("securityEvents").add({
    type: "login_alert_queued",
    ...alert,
  });

  return { sent: true };
});

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

function loginAlertHtml(alert: { device: string; browser: string; ip: string; location: string; time: string }): string {
  const rows = [
    ["Device", alert.device],
    ["Browser", alert.browser],
    ["IP address", alert.ip],
    ["Location", alert.location],
    ["Time", alert.time],
  ].map(([label, value]) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#a3a3a3;font-size:13px;">${label}</td>
      <td style="padding:14px 0;border-bottom:1px solid #2d2d2d;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(value)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050505;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#ffffff;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">A new sign-in was detected on your FYNX Funded account.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;">
        <tr><td align="center" style="padding:0 0 22px;">
          <img src="https://www.fynxfunded.com/fynx-sender-logo.png" width="88" height="88" alt="FYNX" style="display:block;width:88px;height:88px;border:1px solid #303030;border-radius:22px;">
          <div style="padding-top:12px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-.4px;">FYNX <span style="color:#9a9a9a;font-weight:500;">Funded</span></div>
        </td></tr>
        <tr><td style="background:#111111;border:1px solid #303030;border-radius:18px;padding:36px 38px;box-shadow:0 16px 45px rgba(0,0,0,.32);">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td>
              <div style="display:inline-block;padding:7px 11px;border:1px solid #444444;border-radius:999px;background:#1b1b1b;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Security alert</div>
              <h1 style="margin:20px 0 10px;font-size:30px;line-height:1.2;letter-spacing:-.6px;color:#ffffff;">New sign-in detected</h1>
              <p style="margin:0 0 24px;color:#aaaaaa;font-size:15px;line-height:1.7;">A device signed in to your FYNX Funded account. Review the details below to confirm it was you.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#080808;border:1px solid #303030;border-radius:13px;padding:6px 18px;">${rows}</table>
              <div style="margin:24px 0;padding:16px 18px;border-left:3px solid #ffffff;background:#1a1a1a;border-radius:8px;color:#cfcfcf;font-size:13px;line-height:1.6;"><strong style="color:#ffffff;">Wasn’t you?</strong><br>Secure your account immediately by changing your password and reviewing active sessions.</div>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#ffffff;"><a href="https://www.fynxfunded.com/dashboard/settings" style="display:inline-block;padding:14px 22px;color:#000000;text-decoration:none;font-size:14px;font-weight:800;">Review account security&nbsp; →</a></td></tr></table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:24px 20px;color:#777777;font-size:12px;line-height:1.7;">
          This automated security message was sent by FYNX Funded.<br>
          <a href="https://www.fynxfunded.com" style="color:#ffffff;text-decoration:none;">fynxfunded.com</a> &nbsp;•&nbsp; <a href="mailto:support@fynxfunded.com" style="color:#ffffff;text-decoration:none;">support@fynxfunded.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
    html: loginAlertHtml(alert),
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

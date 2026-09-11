import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

const mailgunApiKey = defineSecret("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = "mail.fynxfunded.com";
const MAILGUN_SENDER = "FYNX Funded <security@mail.fynxfunded.com>";
const NOTIFIABLE_STATUSES = new Set(["passed", "failed", "funded"]);

type Outcome = "passed" | "failed" | "funded";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] || character);
}

function content(status: Outcome, challengeName: string) {
  if (status === "passed") return {
    subject: "Congratulations — you passed your FYNX challenge",
    badge: "Challenge passed",
    heading: "You earned the next step.",
    message: `Congratulations! You successfully passed ${challengeName}. Our team will verify the result and prepare your next stage or funded-account instructions.`,
    callout: "Watch your dashboard and inbox. Your next-stage details will appear as soon as account provisioning is complete.",
  };
  if (status === "funded") return {
    subject: "Congratulations — your FYNX funded account is ready",
    badge: "Funded trader",
    heading: "Welcome to the funded stage.",
    message: `Congratulations! ${challengeName} has advanced to funded status. Your achievement and account details are available in your FYNX dashboard.`,
    callout: "Review your funded-account credentials and trading rules before placing your first trade.",
  };
  return {
    subject: "Your FYNX challenge result",
    badge: "Challenge update",
    heading: "This challenge has ended.",
    message: `${challengeName} did not meet the required trading objectives. We know this is disappointing, but every evaluation provides useful information for your next attempt.`,
    callout: "Open your dashboard to review the objective results, trades, and analytics before deciding your next step.",
  };
}

function outcomeHtml(status: Outcome, name: string, challengeName: string): string {
  const copy = content(status, challengeName);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050505;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.subject)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;">
<tr><td align="center" style="padding:0 0 22px;"><img src="https://www.fynxfunded.com/fynx-sender-logo.png" width="88" height="88" alt="FYNX" style="display:block;width:88px;height:88px;border:1px solid #303030;border-radius:22px;"><div style="padding-top:12px;color:#ffffff;font-size:22px;font-weight:800;">FYNX <span style="color:#9a9a9a;font-weight:500;">Funded</span></div></td></tr>
<tr><td style="background:#111111;border:1px solid #303030;border-radius:18px;padding:36px 38px;">
<div style="display:inline-block;padding:7px 11px;border:1px solid #444444;border-radius:999px;background:#1b1b1b;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(copy.badge)}</div>
<h1 style="margin:20px 0 10px;font-size:30px;line-height:1.2;color:#ffffff;">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 12px;color:#ffffff;font-size:15px;line-height:1.7;">Hello ${escapeHtml(name)},</p>
<p style="margin:0 0 24px;color:#aaaaaa;font-size:15px;line-height:1.7;">${escapeHtml(copy.message)}</p>
<div style="margin:24px 0;padding:16px 18px;border-left:3px solid #ffffff;background:#1a1a1a;border-radius:8px;color:#cfcfcf;font-size:13px;line-height:1.6;">${escapeHtml(copy.callout)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#ffffff;"><a href="https://www.fynxfunded.com/dashboard" style="display:inline-block;padding:14px 22px;color:#000000;text-decoration:none;font-size:14px;font-weight:800;">View account details&nbsp; →</a></td></tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 20px;color:#777777;font-size:12px;line-height:1.7;">This automated account update was sent by FYNX Funded.<br><a href="https://www.fynxfunded.com" style="color:#ffffff;text-decoration:none;">fynxfunded.com</a> &nbsp;•&nbsp; <a href="mailto:support@fynxfunded.com" style="color:#ffffff;text-decoration:none;">support@fynxfunded.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendOutcomeEmail(to: string, status: Outcome, name: string, challengeName: string, eventId: string) {
  const copy = content(status, challengeName);
  const text = `Hello ${name}, ${copy.message} ${copy.callout} View your account: https://www.fynxfunded.com/dashboard`;
  const form = new URLSearchParams({
    from: MAILGUN_SENDER,
    to,
    subject: copy.subject,
    text,
    html: outcomeHtml(status, name, challengeName),
    "v:event-id": eventId,
  });
  const authorization = Buffer.from(`api:${mailgunApiKey.value()}`).toString("base64");
  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    throw new Error(`Mailgun rejected progression email (${response.status}): ${providerMessage}`);
  }
}

export const sendProgressionOutcomeEmail = onDocumentWritten(
  { document: "challenges/{challengeId}", region: "us-central1", secrets: [mailgunApiKey] },
  async (event) => {
    if (!event.data?.after.exists) return;
    const beforeStatus = String(event.data.before.exists ? event.data.before.data()?.status || "" : "").toLowerCase();
    const challenge = event.data.after.data() || {};
    const status = String(challenge.status || "").toLowerCase() as Outcome;
    if (!NOTIFIABLE_STATUSES.has(status) || beforeStatus === status) return;
    if (!challenge.userId) {
      console.error("Progression email skipped: challenge has no userId", { challengeId: event.params.challengeId, status });
      return;
    }

    const db = admin.firestore();
    const eventId = `${event.params.challengeId}_${status}_${String(challenge.currentPhase || "final")}`;
    const notificationRef = db.collection("progression_email_events").doc(eventId);
    const shouldSend = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(notificationRef);
      if (existing.exists && ["sending", "sent"].includes(String(existing.data()?.status))) return false;
      transaction.set(notificationRef, { challengeId: event.params.challengeId, userId: challenge.userId, outcome: status, status: "sending", attempts: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!shouldSend) return;

    try {
      const user = await db.collection("users").doc(String(challenge.userId)).get();
      const userData = user.data() || {};
      const email = String(userData.email || "").trim();
      if (!email) throw new Error("Trader email is unavailable");
      const name = String(userData.displayName || userData.fullName || "Trader").trim();
      const challengeName = String(challenge.name || `${Number(challenge.accountSize || 0).toLocaleString("en-US")} ${challenge.phase || "challenge"}`).trim();
      await sendOutcomeEmail(email, status, name, challengeName, eventId);
      await notificationRef.set({ status: "sent", recipient: email, sentAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (error) {
      await notificationRef.set({ status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      throw error;
    }
  },
);

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export default function FundedPrivacyControls() {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "export" | "request_deletion" | "status") {
    setBusy(true); setMessage("");
    try {
      if (!functions) throw new Error("Account services are unavailable.");
      const response = await httpsCallable(functions, "fundedPrivacy")({ action, ...(action === "request_deletion" ? { confirmScope: "FYNX Funded only" } : {}) });
      const data = response.data as { status?: string };
      if (action === "export") {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `fynx-funded-data-${new Date().toISOString().slice(0, 10)}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Your Funded data export has been downloaded. Keep it somewhere private.");
      } else setMessage(data.status === "none" ? "You have no deletion request on file." : `Deletion request: ${(data.status ?? "pending_review").replaceAll("_", " ")}. Support must review any required records before deletion; this request does not close your account immediately.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not complete the request. Please contact Support."); }
    finally { setBusy(false); }
  }
  return <section className="premium-card space-y-4">
    <h2 className="text-lg font-semibold">Your Funded data</h2>
    <p className="text-sm text-muted-foreground">Download your recorded Funded account data, orders and trading history. Sign in again before exporting. Passwords, authentication secrets and other FYNX products are excluded.</p>
    <button type="button" className="rounded-md border px-4 py-2 text-sm" disabled={busy} onClick={() => act("export")}>Download account data</button>
    <div className="border-t pt-4 space-y-3">
      <p className="text-sm text-muted-foreground">Request deletion of Funded data. Support will review open orders, payouts and any records that must be retained. Your shared FYNX sign-in and Tools data are handled separately.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I want to request deletion of my FYNX Funded data.</label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded-md border px-4 py-2 text-sm" disabled={busy || !confirmed} onClick={() => act("request_deletion")}>Submit deletion request</button>
        <button type="button" className="rounded-md border px-4 py-2 text-sm" disabled={busy} onClick={() => act("status")}>Check request status</button>
      </div>
    </div>
    {busy && <p role="status" className="text-sm">Working…</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

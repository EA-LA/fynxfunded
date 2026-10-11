import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Download, ArrowRight, FileText, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { downloadReceipt } from "@/services/payments";
import type { Order } from "@/services/types";
import { auth as firebaseAuth } from "@/lib/firebase";
import { displayDate, publicOrderReference } from "@/lib/publicReferences";

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const sessionId = params.get("session_id");
  const userId = user?.userId;
  const [verifiedUserId, setVerifiedUserId] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setOrder(null); setVerified(false); setVerifiedUserId(""); setError("");
    async function verifyPayment() {
      try {
        if (!userId || !sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw Error("Sign in to the account used at checkout and open the original payment return link.");
        const current = firebaseAuth?.currentUser;
        if (!current || current.uid !== userId) throw Error("Sign in again to check this payment.");
        const idToken = await current.getIdToken();
        const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "https://us-central1-fynx-c7a28.cloudfunctions.net";
        const response = await fetch(`${apiBase}/verifySession`, {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ sessionId }),
        });
        const data = await response.json();
        if (!response.ok || data.verified !== true || data.status !== "paid") throw Error("Payment has not been confirmed. Check Billing or try again; do not make a second payment while the result is unclear.");
        if (!active) return;
        setVerifiedUserId(userId); setVerified(true);
        // A successful charge can precede the webhook. Only fulfilled, owned orders get a receipt.
        if (data.order?.status === "paid" && data.order.userId === userId && data.order.challengeId) setOrder(data.order as Order);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "Payment could not be checked. Please try again.");
      } finally { if (active) setLoading(false); }
    }
    void verifyPayment();
    return () => { active = false; controller.abort(); };
  }, [sessionId, userId, authLoading, attempt]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!verified || verifiedUserId !== user?.userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center">
          <AlertTriangle size={32} className="mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">Payment not verified</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {error || "Sign in again to check your payment."}
          </p>
          <button onClick={() => setAttempt(value => value + 1)} className="rounded-md border px-4 py-2 text-sm">Check again</button>
          <Link to="/dashboard/billing" className="ml-4 text-sm underline">Open Billing</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-lg animate-fade-up">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{order ? "Thank you for your purchase" : "Payment received — order processing"}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {order ? "Your payment was confirmed and your challenge order has been created." : "Your payment is confirmed. Your order is still being prepared. Do not pay again."}
          </p>
        </div>

        {order && (
          <div className="premium-card space-y-3 text-sm mb-6">
            <DetailRow label="Receipt number" value={publicOrderReference(order)} mono />
            <DetailRow label="Challenge" value={order.challenge} />
            <DetailRow label="Amount" value={`$${order.amount}`} />
            <DetailRow label="Payment Method" value={order.paymentMethod} />
            <DetailRow label="Date" value={displayDate(order.paidAt || order.createdAt)} />
            <DetailRow label="Status" value={order.status.toUpperCase()} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {!order && <button onClick={() => setAttempt(value => value + 1)} className="rounded-md border px-4 py-2.5 text-sm">Check order status</button>}
          {order && (
            <button
              onClick={() => void downloadReceipt(order)}
              className="flex-1 border border-border px-4 py-2.5 rounded-md text-sm font-medium hover:bg-secondary transition-colors inline-flex items-center justify-center gap-2"
            >
              <Download size={14} /> Download Receipt
            </button>
          )}
          <Link
            to="/dashboard"
            className="flex-1 bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
          >
            Go to Dashboard <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mt-6 p-3 rounded-md border border-border bg-secondary/30">
          <div className="flex items-start gap-2">
            <FileText size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              We will email your purchase confirmation separately. Your trading account credentials will be delivered by email and shown in your dashboard as soon as your trading account is ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className={`min-w-0 text-right font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

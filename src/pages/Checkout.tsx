import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CreditCard, Wallet, Apple, Globe2, Lock, Shield } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import PaymentHold from "@/components/PaymentHold";
import type { PaymentMethodType } from "@/services/types";

const cryptoOptions = [
  { id: "btc", label: "Bitcoin (BTC)" },
  { id: "eth", label: "Ethereum (ETH)" },
  { id: "usdt", label: "Tether (USDT)" },
  { id: "usdc", label: "USD Coin (USDC)" },
];

export default function Checkout() {
  const [params] = useSearchParams();
  const [method, setMethod] = useState<PaymentMethodType>("card");
  const [holdOpen, setHoldOpen] = useState(false);
  const [cryptoCoin, setCryptoCoin] = useState("usdt");

  const sizeIdx = parseInt(params.get("size") || "1");
  const phase = (params.get("phase") || "2-phase") as "1-phase" | "2-phase" | "3-phase";
  const style = params.get("style") || "normal";
  const currency = params.get("currency") || "USD";

  const config = challengeConfigs[sizeIdx] || challengeConfigs[1];
  const phaseConfig = config.phases[phase] || config.phases["2-phase"];
  const handlePay = () => setHoldOpen(true);

  const methods: { id: PaymentMethodType; label: string; icon: React.ReactNode }[] = [
    { id: "card", label: "Credit / Debit Card", icon: <CreditCard size={18} /> },
    { id: "paypal", label: "PayPal", icon: <Globe2 size={18} /> },
    { id: "apple", label: "Apple Pay", icon: <Apple size={18} /> },
    { id: "crypto", label: "Cryptocurrency", icon: <Wallet size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PaymentHold open={holdOpen} onOpenChange={setHoldOpen} />
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold tracking-tight">
            FYNX<span className="text-muted-foreground font-light ml-1">Funded</span>
          </Link>
          <Link
            to="/challenge-builder"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={16} className="text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Secure Checkout</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-8">Explore your challenge details. Payments will open once we finish the final step.</p>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Payment form */}
          <div className="lg:col-span-3 space-y-6">
            {/* Payment method selection */}
            <div className="premium-card">
              <h3 className="text-sm font-semibold mb-4">Payment Method</h3>
              <div className="grid grid-cols-2 gap-3">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-md border text-sm font-medium transition-all ${
                      method === m.id
                        ? "border-foreground/40 bg-secondary/50 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                    }`}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Card — Stripe redirect */}
            {method === "card" && (
              <div className="premium-card animate-fade-in">
                <div className="text-center py-4">
                  <CreditCard size={32} className="mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium mb-1">Credit / Debit Card</p>
                  <p className="text-xs text-muted-foreground">Payments are temporarily on hold while we finish the final step.</p>
                </div>
              </div>
            )}

            {method === "paypal" && (
              <div className="premium-card animate-fade-in text-center py-8">
                <Globe2 size={32} className="mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium mb-1">PayPal</p>
                <p className="text-xs text-muted-foreground">Payments are temporarily on hold while we finish the final step.</p>
              </div>
            )}

            {method === "apple" && (
              <div className="premium-card animate-fade-in text-center py-8">
                <Apple size={32} className="mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium mb-1">Apple Pay</p>
                <p className="text-xs text-muted-foreground">Payments are temporarily on hold while we finish the final step.</p>
              </div>
            )}

            {method === "crypto" && (
              <div className="premium-card animate-fade-in">
                <h3 className="text-sm font-semibold mb-4">Select Cryptocurrency</h3>
                <div className="grid grid-cols-2 gap-3">
                  {cryptoOptions.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCryptoCoin(c.id)}
                      className={`px-4 py-3 rounded-md border text-sm font-medium transition-all ${
                        cryptoCoin === c.id
                          ? "border-foreground/40 bg-secondary/50 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4">Payments are temporarily on hold while we finish the final step.</p>
              </div>
            )}

            {/* Pay button */}
            <button
              onClick={handlePay}
              className="w-full bg-primary text-primary-foreground py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Lock size={14} />
              Pay ${phaseConfig.price}
            </button>

            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Shield size={12} /> Payments on hold</span>
              <span>·</span>
              <span>No payment will be taken</span>
            </div>
          </div>

          {/* Order summary */}
          <div className="lg:col-span-2">
            <div className="sticky top-6 premium-card">
              <h3 className="text-sm font-semibold mb-4">Order Summary</h3>
              <div className="space-y-2 text-sm">
                <SummaryRow label="Challenge" value={config.label} />
                <SummaryRow label="Phase" value={phase.replace("-", " ")} />
                <SummaryRow label="Style" value={style === "swing" ? "Swing" : "Normal"} />
                <SummaryRow label="Currency" value={currency} />
                <SummaryRow label="Target" value={phaseConfig.profitTargets.join(" → ")} />
                <SummaryRow label="Profit Split" value={phaseConfig.profitSplit} />
                <div className="glow-line my-3" />
                <div className="flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-bold">${phaseConfig.price}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-4">
                By completing this purchase, you agree to our Terms & Conditions, Refund Policy, and Risk Disclosure.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}

import MarketingLayout from "@/components/MarketingLayout";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import PayoutEstimator, { SplitTable } from "@/components/PayoutEstimator";
import { splitRange } from "@/lib/payoutEstimator";
import NextPayoutWindow from "@/components/NextPayoutWindow";
import PayoutReadiness from "@/components/PayoutReadiness";
import GlossaryTip from "@/components/GlossaryTip";

const timeline = [
  { step: "1", title: "Meet Profit Target", desc: "Reach the minimum profit threshold in your funded account." },
  { step: "2", title: "Request Payout", desc: "Submit a payout request through your dashboard." },
  { step: "3", title: "Review & Approval", desc: "The request is reviewed for eligibility, account status, and verification requirements." },
  { step: "4", title: "Receive Funds", desc: "Approved requests are sent using the method and estimated timeline shown during processing." },
];

const eligibility = [
  { text: "Minimum 5 trading days since last payout", term: "trading-day" },
  { text: "No active rule violations", term: "breach" },
  { text: "All positions closed at time of request" },
  { text: "KYC verification completed", term: "kyc" },
  { text: "Minimum payout amount: $50", term: "payout-window" },
];

const calendarData = [
  { period: "1st – 15th", request: "1st – 3rd", payout: "5th – 7th" },
  { period: "16th – 31st", request: "16th – 18th", payout: "20th – 22nd" },
];

export default function PayoutsPage() {
  const split = splitRange();
  return (
    <MarketingLayout>
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight animate-fade-up">Payouts</h1>
          <p className="mt-4 text-lg text-muted-foreground animate-fade-up delay-200">
            Review eligibility, submit a request, and follow its status from your dashboard.
          </p>
        </div>

        {/* Profit split */}
        <div className="premium-card mb-12 animate-fade-up delay-300">
          <h2 className="text-xl font-bold mb-4"><GlossaryTip term="profit-split">Profit Split</GlossaryTip></h2>
          <p className="text-muted-foreground text-sm mb-4">
            <GlossaryTip term="funded-stage">Funded traders</GlossaryTip> keep {split.min}% to {split.max}% of net profit. The split depends on the account size and the program you passed:
          </p>
          <SplitTable />
          <p className="mt-3 text-xs text-muted-foreground">
            Published schedule for new accounts. The split recorded with your purchase always applies.
          </p>
        </div>

        <PayoutEstimator />

        {/* Timeline */}
        <h2 className="text-2xl font-bold mb-8 animate-fade-up">Payout Timeline</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {timeline.map((t, i) => (
            <div key={t.step} className={`premium-card animate-fade-up delay-${(i + 1) * 100}`}>
              <span className="text-3xl font-bold text-muted-foreground/30">{t.step}</span>
              <h3 className="mt-3 font-semibold">{t.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t.desc}</p>
            </div>
          ))}
        </div>

        <div className="glow-line mb-16" />

        {/* Eligibility */}
        <h2 className="text-2xl font-bold mb-8 animate-fade-up">Eligibility Checklist</h2>
        <div className="premium-card mb-16 animate-fade-up delay-200">
          <div className="space-y-3">
            {eligibility.map((item) => (
              <div key={item.text} className="flex items-center gap-3 text-sm">
                <CheckCircle2 size={16} className="text-muted-foreground shrink-0" />
                <span>
                  {item.text}
                  {item.term && <GlossaryTip term={item.term} className="ml-1" />}
                </span>
              </div>
            ))}
          </div>
          <a href="#readiness" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
            Check your account against this list <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>

        <PayoutReadiness />

        {/* Calendar */}
        <section id="calendar" aria-labelledby="calendar-title" className="scroll-mt-24">
        <h2 id="calendar-title" className="text-2xl font-bold mb-8 animate-fade-up">Payout Calendar <GlossaryTip term="payout-window" /></h2>
        <NextPayoutWindow />
        <div className="overflow-x-auto animate-fade-up delay-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Period</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground"><GlossaryTip term="payout-window">Request Window</GlossaryTip></th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Payout Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {calendarData.map((row) => (
                <tr key={row.period}>
                  <td className="py-3 px-4">{row.period}</td>
                  <td className="py-3 px-4">{row.request}</td>
                  <td className="py-3 px-4">{row.payout}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </section>

        <div className="mt-16 text-center animate-fade-up">
          <Link
            to="/challenges"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Start Your Challenge <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}

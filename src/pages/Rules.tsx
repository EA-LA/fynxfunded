import RuleAvailabilityNotice from "@/components/RuleAvailabilityNotice";
import { RULE_POLICY_VERSION as VERSION } from "@/lib/challengeConfig";
import MarketingLayout from "@/components/MarketingLayout";
import {
  AlertTriangle,
  Clock,
  Globe,
  Copy,
  TrendingDown,
  ShieldAlert,
  Newspaper,
  Monitor,
} from "lucide-react";

const rules = [
  {
    icon: TrendingDown,
    title: "Daily Loss Limit",
    desc: "For new accounts under the versioned schedule: daily loss is 4% for 1-phase and 5% for 2-phase or 3-phase programs, measured from the balance at the daily reset.",
    tip: "Reset is 22:00 UTC year-round. Equity includes floating P/L. Touching the floor is allowed; falling below it records a breach.",
  },
  {
    icon: AlertTriangle,
    title: "Maximum Loss Limit",
    desc: "The static maximum loss is 8% for 1-phase, 10% for 2-phase and 12% for 3-phase programs, measured from the initial phase balance.",
    tip: "Profits do not raise this floor. A recorded breach remains after recovery and requires review.",
  },
  {
    icon: Newspaper,
    title: "News Trading",
    desc: "Trading during high-impact news events is permitted. However, we reserve the right to review trades placed within 2 minutes of major releases.",
    tip: "Check the economic calendar before placing trades near major events.",
  },
  {
    icon: Clock,
    title: "Weekend Holding",
    desc: "Overnight and weekend permissions depend on the purchased agreement and verified broker instrument schedule. New-account balances use USD. Forex pairs and trading sessions are pending broker verification.",
    tip: "No crypto or universal weekend permission is promised by this schedule. Broker specifications must be verified before trading.",
  },
  {
    icon: Copy,
    title: "Copy Trading",
    desc: "Copy trading from external signals or other FYNX accounts is not permitted. All trades must be independently executed.",
    tip: "Automated EAs are allowed if they are your own strategy.",
  },
  {
    icon: ShieldAlert,
    title: "Consistency Rule",
    desc: "The best positive trading day must represent no more than 40% of total net phase profit. A nonpositive total or a larger share delays eligibility; it is not a loss breach.",
    tip: "Aim for steady, repeatable results across multiple sessions.",
  },
  {
    icon: Globe,
    title: "Martingale / Grid / HFT",
    desc: "Martingale strategies, grid trading without stop losses, and high-frequency trading (latency arbitrage) are prohibited.",
    tip: "Standard automated strategies with proper risk management are welcome.",
  },
  {
    icon: Monitor,
    title: "IP & Device Policy",
    desc: "Your account should be accessed from a consistent IP and device. Significant changes may trigger a security review.",
    tip: "Using a VPN is allowed but keep it consistent.",
  },
];

export default function RulesPage() {
  return (
    <MarketingLayout>
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <RuleAvailabilityNotice />
        <div className="max-w-2xl mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight animate-fade-up">Trading Rules</h1>
          <p className="mt-4 text-lg text-muted-foreground animate-fade-up delay-200">
            Approved numerical schedule for new accounts once purchases open. Existing accounts retain the terms accepted at purchase; this page does not migrate them.
          </p>
        </div>

        <div className="premium-card mb-8 overflow-x-auto">
          <h2 className="text-lg font-semibold mb-3">New-account schedule · {VERSION}</h2>
          <table className="w-full text-sm text-left">
            <thead><tr><th className="p-2">Program</th><th className="p-2">Phase targets</th><th className="p-2">Daily / maximum loss</th><th className="p-2">Minimum days per phase</th></tr></thead>
            <tbody>
              <tr><td className="p-2">1-phase</td><td className="p-2">10%</td><td className="p-2">4% / 8%</td><td className="p-2">3</td></tr>
              <tr><td className="p-2">2-phase</td><td className="p-2">8% → 5%</td><td className="p-2">5% / 10%</td><td className="p-2">5</td></tr>
              <tr><td className="p-2">3-phase</td><td className="p-2">6% → 5% → 4%</td><td className="p-2">5% / 12%</td><td className="p-2">5</td></tr>
            </tbody>
          </table>
          <p className="mt-4 text-sm text-muted-foreground">Net profit includes trading charges. Eligibility also requires no recorded breach and no open positions. Evaluation is subject to human review and does not automatically advance a phase or authorize a payout. Your purchase must record this version before it applies to your account.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {rules.map((rule, i) => (
            <div key={rule.title} className={`premium-card hover-lift animate-fade-up delay-${(i + 1) * 100}`}>
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
                  <rule.icon size={18} className="text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">{rule.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{rule.desc}</p>
                  <div className="mt-3 px-3 py-2 bg-secondary/50 rounded text-xs text-muted-foreground">
                    💡 {rule.tip}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}

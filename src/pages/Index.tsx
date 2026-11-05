import { Link } from "react-router-dom";
import MarketingLayout from "@/components/MarketingLayout";
import CinematicBackground from "@/components/CinematicBackground";
import NextPayoutWindow from "@/components/NextPayoutWindow";
import { faqItems } from "@/lib/faqContent";
import { marketingPlans } from "@/lib/challengeConfig";
import { calculatorLink, getRulePlan } from "@/lib/ruleCalculator";
import {
  ArrowRight,
  Zap,
  BarChart3,
  Calendar,
  TrendingUp,
  Shield,
  Target,
  ChevronRight,
  Calculator,
  Columns3,
  Gauge,
  Wallet,
} from "lucide-react";

const proofItems = [
  "Tracked payout workflow",
  "Performance dashboard",
  "Clear rules",
  "Multiple account sizes",
];

const features = [
  { icon: BarChart3, title: "Performance Stats", desc: "P/L, equity curves, and performance metrics populate from connected account data." },
  { icon: Target, title: "Objectives Tracker", desc: "Visual progress bars for every trading objective and risk limit." },
  { icon: Calendar, title: "Payout Tracking", desc: "Review eligibility information and payout-request history in one place." },
  { icon: TrendingUp, title: "Account Options", desc: "Choose from available evaluation sizes and phase structures." },
  { icon: Shield, title: "Rules Clarity", desc: "Review evaluation targets and risk limits before purchase." },
  { icon: Zap, title: "Risk Engine", desc: "Designed to evaluate daily-loss and maximum-loss limits from connected account records." },
];

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Questions shown on the home page, each linking to its answer on /faq. */
const HOME_FAQ_IDS = ["how-evaluation-works", "daily-loss", "consistency-rule", "payout-windows", "simulated-accounts"];
const homeFaqs = HOME_FAQ_IDS.map((id) => faqItems.find((item) => item.id === id)).filter((item): item is (typeof faqItems)[number] => Boolean(item));

const tools = [
  {
    icon: Calculator,
    title: "Rules calculator",
    desc: "Enter a balance and see your profit target, today's loss floor and the 40% consistency check in dollars.",
    to: "/rules#calculator",
    cta: "Open the calculator",
  },
  {
    icon: Gauge,
    title: "Risk and pace planner",
    desc: "Pick your risk per trade to see how many losses fit inside the limits, how many winners the target takes and a steady daily pace, then turn it into a lot size.",
    to: "/rules#risk-planner",
    cta: "Plan your risk",
  },
  {
    icon: Columns3,
    title: "Compare programs",
    desc: "Put the 1-, 2- and 3-phase programs side by side for any account size: fee, targets, loss room and minimum days.",
    to: "/challenges#compare-programs",
    cta: "Compare side by side",
  },
  {
    icon: Wallet,
    title: "Payout estimator",
    desc: "Type a funded profit amount to see how it splits for your plan, with the $50 minimum checked for you.",
    to: "/payouts#estimator",
    cta: "Estimate a payout",
  },
];

const steps = [
  { num: "01", title: "Choose Your Challenge", desc: "Select an account size and evaluation type that matches your trading style." },
  { num: "02", title: "Pass the Evaluation", desc: "Hit the profit target while respecting risk limits. No time pressure." },
  { num: "03", title: "Qualify for the Funded Stage", desc: "Eligible traders may advance under the rules and profit split shown for their selected plan." },
];

export default function Index() {
  return (
    <MarketingLayout>
      <CinematicBackground />
      {/* Hero */}
      <section className="relative dot-grid overflow-hidden">
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-32 md:py-44">
          <div className="max-w-3xl">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] animate-fade-up">
              Get Funded.
              <br />
              Trade with Discipline.
            </h1>
            <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl animate-fade-up delay-200">
              Choose a simulated evaluation up to $100K, follow transparent rules, and track eligible account activity from your dashboard.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">Evaluation and funded-stage trading use simulated accounts. Account balances are virtual, not money deposited for you to withdraw. Payout eligibility depends on your accepted agreement. New purchases are currently paused.</p>
            <div className="mt-10 flex flex-wrap gap-4 animate-fade-up delay-300">
              <Link
                to="/challenge-builder"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Start Challenge <ArrowRight size={16} />
              </Link>
              <Link
                to="/challenges"
                className="inline-flex items-center gap-2 border border-border text-foreground px-6 py-3 rounded-md text-sm font-medium hover:bg-secondary transition-colors"
              >
                View Plans
              </Link>
            </div>
          </div>
        </div>
        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* Proof strip */}
      <section className="border-y border-border">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap justify-center gap-8 md:gap-16">
          {proofItems.map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
              {item}
            </div>
          ))}
        </div>
      </section>

      {/* 3-step flow */}
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-16 animate-fade-up">
          Three Steps to Funded
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div
              key={step.num}
              className={`premium-card hover-lift animate-fade-up delay-${(i + 1) * 200}`}
            >
              <span className="text-4xl font-bold text-muted-foreground/30">{step.num}</span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6"><div className="glow-line" /></div>

      {/* Plan cards preview */}
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight animate-fade-up">
            Choose Your Challenge
          </h2>
          <p className="mt-4 text-muted-foreground animate-fade-up delay-200">
            Select the account size that fits your strategy.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {marketingPlans.map((plan, i) => {
            const rules = getRulePlan(plan.accountValue, plan.phase);
            return (
            <div
              key={plan.name}
              className={`premium-card hover-lift relative animate-fade-up delay-${(i + 1) * 100} ${
                plan.popular ? "border-foreground/30" : ""
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-4 bg-foreground text-background text-xs font-semibold px-3 py-1 rounded-full">
                  Popular
                </span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <div className="mt-4">
                <span className="text-3xl font-bold">${plan.price}</span>
              </div>
              <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>Account Size</span>
                  <span className="text-foreground">${plan.accountSize}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phase Targets</span>
                  <span className="text-foreground">{plan.profitTarget}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phase 1 Target</span>
                  <span className="text-foreground tabular-nums">+{usd(rules.phases[0].targetProfit)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Daily Loss ({rules.dailyLossPercent}%)</span>
                  <span className="text-foreground tabular-nums">−{usd((plan.accountValue * rules.dailyLossPercent) / 100)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Max Loss ({rules.maxLossPercent}%)</span>
                  <span className="text-foreground tabular-nums">−{usd(rules.maxLossAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Min. Days per Phase</span>
                  <span className="text-foreground">{rules.minDays}</span>
                </div>
                <div className="flex justify-between">
                  <span>Profit Split</span>
                  <span className="text-foreground">{plan.profitSplit}</span>
                </div>
              </div>
              <Link
                to="/challenges"
                className="mt-6 w-full inline-flex items-center justify-center gap-1 border border-border text-sm font-medium py-2.5 rounded-md hover:bg-secondary transition-colors"
              >
                View Details <ChevronRight size={14} />
              </Link>
              <Link
                to={calculatorLink(plan.accountValue, plan.phase)}
                className="mt-2 w-full inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
              >
                <Calculator size={12} aria-hidden="true" /> See these rules in dollars
              </Link>
            </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Figures shown for the 2-phase program. Daily loss is measured from the balance at each 22:00 UTC reset.{" "}
          <Link to="/challenges#compare-programs" className="underline underline-offset-4 hover:text-foreground">Compare 1-, 2- and 3-phase</Link>
        </p>
      </section>

      <div className="max-w-7xl mx-auto px-6"><div className="glow-line" /></div>

      {/* Planning tools */}
      <section id="tools" aria-labelledby="tools-title" className="max-w-7xl mx-auto px-6 py-24 md:py-32 scroll-mt-24">
        <div className="text-center mb-12">
          <h2 id="tools-title" className="text-3xl md:text-4xl font-bold tracking-tight animate-fade-up">
            Know Your Numbers Before You Start
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto animate-fade-up delay-200">
            Free planning tools built from the published rule schedule. They illustrate the arithmetic only; official results come from your account review.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {tools.map((tool) => (
            <Link
              key={tool.title}
              to={tool.to}
              className="premium-card hover-lift group flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <tool.icon size={20} aria-hidden="true" className="text-muted-foreground" />
              <h3 className="mt-4 text-base font-semibold">{tool.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{tool.desc}</p>
              <span className="mt-auto pt-5 inline-flex items-center gap-1 text-sm font-medium">
                {tool.cta} <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-6 max-w-3xl mx-auto">
          <NextPayoutWindow className="" />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <Link to="/payouts#calendar" className="underline underline-offset-4 hover:text-foreground">See the full payout calendar</Link>
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6"><div className="glow-line" /></div>

      {/* Feature grid */}
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-16 animate-fade-up">
          Built for Serious Traders
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feat, i) => (
            <div key={feat.title} className={`premium-card hover-lift animate-fade-up delay-${(i + 1) * 100}`}>
              <feat.icon size={20} className="text-muted-foreground" />
              <h3 className="mt-4 text-base font-semibold">{feat.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6"><div className="glow-line" /></div>

      {/* FAQ preview */}
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-16 animate-fade-up">
          Frequently Asked Questions
        </h2>
        <div className="max-w-2xl mx-auto space-y-4">
          {homeFaqs.map((faq, i) => (
            <details
              key={faq.id}
              className={`group premium-card cursor-pointer animate-fade-up delay-${(i + 1) * 100}`}
            >
              <summary className="flex items-center justify-between text-sm font-medium list-none">
                {faq.q}
                <ChevronRight size={16} className="text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              <Link
                to={`/faq#${faq.id}`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Read in the full FAQ <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </details>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link to="/faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
            View all FAQ <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border dot-grid relative">
        <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight animate-fade-up">
            Ready to Prove Your Edge?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground animate-fade-up delay-200">
            Review the current plans, rules, and eligibility requirements before you begin.
          </p>
          <div className="mt-8 animate-fade-up delay-300">
            <Link
              to="/challenge-builder"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Start Your Challenge <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

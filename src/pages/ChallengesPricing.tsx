import RuleAvailabilityNotice from "@/components/RuleAvailabilityNotice";
import { useState } from "react";
import MarketingLayout from "@/components/MarketingLayout";
import { challengeConfigs, marketingPlans } from "@/lib/challengeConfig";
import { Link } from "react-router-dom";
import { ArrowRight, Calculator, Check, Globe2 } from "lucide-react";
import ProgramComparison from "@/components/ProgramComparison";
import ChallengeFinder from "@/components/ChallengeFinder";
import { calculatorLink } from "@/lib/ruleCalculator";
import GlossaryTip from "@/components/GlossaryTip";

type CompareView = "quick" | "full";
type PhaseType = "1-phase" | "2-phase" | "3-phase";

export default function ChallengesPricing() {
  const [compareView, setCompareView] = useState<CompareView>("quick");
  const [comparePhase, setComparePhase] = useState<PhaseType>("2-phase");

  return (
    <MarketingLayout>
      <section className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <RuleAvailabilityNotice />
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight animate-fade-up">
            Challenges & Pricing
          </h1>
          <p className="mt-4 text-lg text-muted-foreground animate-fade-up delay-200">
            Featured two-phase evaluations.{" "}
            <a href="#compare-programs" className="underline underline-offset-4 hover:text-foreground">Compare 1, 2 and 3-phase programs</a> for any account size below.
          </p>
          <p className="mt-2 text-sm text-muted-foreground animate-fade-up delay-200">
            Not sure which one?{" "}
            <a href="#finder" className="underline underline-offset-4 hover:text-foreground">Find your challenge</a> from your budget and risk per trade.
          </p>

        </div>

        {/* Plan cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {marketingPlans.map((plan, i) => (
            <div
              key={plan.name}
              className={`premium-card hover-lift relative animate-fade-up delay-${(i + 1) * 100} ${
                plan.popular ? "border-foreground/30" : ""
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-4 bg-foreground text-background text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </span>
              )}
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <div className="mt-4 mb-6">
                <span className="text-4xl font-bold">${plan.price}</span>
                <span className="text-sm text-muted-foreground ml-1">one-time</span>
              </div>
              <div className="space-y-3 text-sm">
                <PlanRow label="Account Size" term="account-size" value={`$${plan.accountSize}`} />
                <PlanRow label="Phase Targets" term="profit-target" value={plan.profitTarget} />
                <PlanRow label="Daily Loss Limit" term="daily-loss-limit" value={plan.dailyLoss} />
                <PlanRow label="Max Loss Limit" term="maximum-loss" value={plan.maxLoss} />
                <PlanRow label="Min Trading Days" term="minimum-trading-days" value={`${plan.minDays} days`} />
                <PlanRow label="Profit Split" term="profit-split" value={plan.profitSplit} />
                <PlanRow label="Fee Refund" value={plan.refund ? "Yes" : "No"} />
              </div>
              <Link
                to="/challenge-builder"
                className="mt-6 w-full inline-flex items-center justify-center gap-1 bg-primary text-primary-foreground text-sm font-medium py-2.5 rounded-md hover:bg-primary/90 transition-colors"
              >
                Start Challenge <ArrowRight size={14} />
              </Link>
              <Link
                to={calculatorLink(plan.accountValue, plan.phase)}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Calculator size={13} aria-hidden="true" /> See the rules in dollars
              </Link>
            </div>
          ))}
        </div>

        <ChallengeFinder />

        <ProgramComparison />

        <div className="glow-line mb-16" />

        {/* Compare Plans — Enhanced */}
        <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-up">
          <h2 className="text-2xl font-bold">Compare all sizes</h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Phase filter */}
            <div className="inline-flex items-center gap-1 bg-secondary rounded-md p-0.5">
              {(["1-phase", "2-phase", "3-phase"] as PhaseType[]).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  aria-pressed={comparePhase === pt}
                  onClick={() => setComparePhase(pt)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    comparePhase === pt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pt.replace("-", " ")}
                </button>
              ))}
            </div>
            {/* View toggle */}
            <div className="inline-flex items-center gap-1 bg-secondary rounded-md p-0.5">
              <button
                type="button"
                aria-pressed={compareView === "quick"}
                onClick={() => setCompareView("quick")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  compareView === "quick" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Quick
              </button>
              <button
                type="button"
                aria-pressed={compareView === "full"}
                onClick={() => setCompareView("full")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  compareView === "full" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Full
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto animate-fade-up delay-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Feature</th>
                {challengeConfigs.map((c) => (
                  <th key={c.accountSize} className="text-center py-3 px-4 font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <CompareRow
                label="Price"
                values={challengeConfigs.map((c) => `$${c.phases[comparePhase].price}`)}
              />
              <CompareRow
                label="Phase Type"
                term="phase"
                values={challengeConfigs.map(() => comparePhase.replace("-", " "))}
              />
              <CompareRow
                label="Profit Target(s)"
                term="profit-target"
                values={challengeConfigs.map((c) => c.phases[comparePhase].profitTargets.join(" → "))}
              />
              <CompareRow
                label="Daily Loss Limit"
                term="daily-loss-limit"
                values={challengeConfigs.map((c) => c.phases[comparePhase].dailyLoss)}
              />
              <CompareRow
                label="Max Loss Limit"
                term="maximum-loss"
                values={challengeConfigs.map((c) => c.phases[comparePhase].maxLoss)}
              />
              <CompareRow
                label="Min Trading Days"
                term="minimum-trading-days"
                values={challengeConfigs.map((c) => `${c.phases[comparePhase].minDays} days`)}
              />
              <CompareRow
                label="Profit Split"
                term="profit-split"
                values={challengeConfigs.map((c) => c.phases[comparePhase].profitSplit)}
              />
              {compareView === "full" && (
                <>
                  <CompareRow
                    label="Leverage (Forex)"
                    term="leverage"
                    values={challengeConfigs.map((c) => c.phases[comparePhase].leverageForex)}
                  />
                  <CompareRow
                    label="Fee Refund"
                    values={challengeConfigs.map((c) => c.phases[comparePhase].refundEligible ? "Yes" : "No")}
                    isCheck
                  />
                  <CompareRow
                    label="Normal Style"
                    values={challengeConfigs.map(() => "Available")}
                    isCheck
                  />
                  <CompareRow
                    label="Swing Style"
                    values={challengeConfigs.map(() => "Available")}
                    isCheck
                  />
                  <CompareRow
                    label="Weekend Holding"
                    values={challengeConfigs.map(() => "Pending account terms")}
                  />
                  <CompareRow
                    label="News Trading"
                    values={challengeConfigs.map(() => "Pending account terms")}
                  />
                  <CompareRow
                    label="Consistency Rule"
                    term="consistency-rule"
                    values={challengeConfigs.map(() => "40% of net phase profit")}
                  />
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Global scope statement */}
        <div className="mt-12 premium-card animate-fade-up">
          <div className="flex items-start gap-3">
            <Globe2 size={18} className="text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold mb-1">Global Market Coverage</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                New-account balances are denominated in USD. The exact Forex pair list, leverage, costs and sessions are pending broker verification.
                No production instruments are approved yet. Crypto and other asset classes are unavailable, with no announced launch date.
              </p>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

function PlanRow({ label, value, term }: { label: string; value: string; term?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 pb-2">
      <span className="text-muted-foreground">{term ? <GlossaryTip term={term}>{label}</GlossaryTip> : label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function CompareRow({ label, values, isCheck, term }: { label: string; values: string[]; isCheck?: boolean; term?: string }) {
  return (
    <tr>
      <th scope="row" className="py-3 px-4 text-left font-normal text-muted-foreground">{term ? <GlossaryTip term={term}>{label}</GlossaryTip> : label}</th>
      {values.map((v, i) => (
        <td key={i} className="py-3 px-4 text-center">
          {isCheck ? <Check size={16} className="mx-auto" /> : v}
        </td>
      ))}
    </tr>
  );
}

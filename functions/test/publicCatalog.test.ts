import { describe, expect, it } from "vitest";
import { challengeConfigs, marketingPlans } from "../../src/lib/challengeConfig";
import { getPlan } from "../src/stripe/priceMap";
import { ruleSnapshot } from "../src/fundedPolicy";

describe("public purchase catalog parity", () => {
  it("matches every public phase fee to the server checkout amount", () => {
    for (const config of challengeConfigs) for (const [program, phase] of Object.entries(config.phases)) {
      const server = getPlan(`${config.accountSize / 1000}k`, program[0]);
      expect(server, `${config.label} ${program}`).not.toBeNull();
      expect(phase.price * 100, `${config.label} ${program}`).toBe(server!.amountCents);
    }
  });
  it("matches all advertised phase objectives to the purchased server policy", () => {
    for (const config of challengeConfigs) for (const [program, phase] of Object.entries(config.phases)) {
      phase.profitTargets.forEach((target, index) => {
        const rule = ruleSnapshot({ program, phase: index + 1, starting_balance: String(config.accountSize), currency: "USD" });
        expect(target).toBe(`${rule.profit_target_percent}%`);
        expect(phase.dailyLoss).toBe(`${rule.daily_loss_percent}%`);
        expect(phase.maxLoss).toBe(`${rule.max_loss_percent}%`);
        expect(phase.minDays).toBe(rule.min_trading_days);
      });
    }
  });
  it("advertises only real two-phase checkout plans with both phase targets", () => {
    expect(marketingPlans).toHaveLength(4);
    for (const plan of marketingPlans) {
      expect(plan.phase).toBe("2-phase");
      expect(plan.name).toContain("2-phase");
      expect(plan.price * 100).toBe(getPlan(`${plan.accountValue / 1000}k`, "2")!.amountCents);
      expect(plan.profitTarget).toBe([1, 2].map(phase => ruleSnapshot({ program: plan.phase, phase, starting_balance: String(plan.accountValue), currency: "USD" }).profit_target_percent + "%").join(" / "));
    }
    expect(marketingPlans.find(plan => plan.accountValue === 10000)?.price).toBe(79);
  });
});

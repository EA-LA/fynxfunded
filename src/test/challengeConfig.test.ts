import { describe, expect, it } from "vitest";
import { challengeConfigs } from "@/lib/challengeConfig";

const percent = (value: string) => Number(value.replace("%", ""));

describe("challenge configuration", () => {
  it("defines each account size only once", () => {
    const sizes = challengeConfigs.map((config) => config.accountSize);
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("keeps every plan financially and operationally valid", () => {
    for (const config of challengeConfigs) {
      expect(config.accountSize).toBeGreaterThan(0);
      expect(config.label).toMatch(/^\$\d+K$/);

      for (const [phaseName, phase] of Object.entries(config.phases)) {
        const expectedTargets = Number(phaseName[0]);
        expect(phase.price).toBeGreaterThan(0);
        expect(phase.profitTargets).toHaveLength(expectedTargets);
        expect(phase.profitTargets.every((target) => percent(target) > 0)).toBe(true);
        expect(percent(phase.dailyLoss)).toBeGreaterThan(0);
        expect(percent(phase.maxLoss)).toBeGreaterThanOrEqual(percent(phase.dailyLoss));
        expect(phase.minDays).toBeGreaterThan(0);
        expect(percent(phase.profitSplit)).toBeGreaterThan(0);
      }
    }
  });

  it("preserves the advertised $10K two-phase offer", () => {
    const plan = challengeConfigs.find((config) => config.accountSize === 10_000)?.phases["2-phase"];
    expect(plan).toMatchObject({
      price: 79,
      profitTargets: ["8%", "5%"],
      dailyLoss: "5%",
      maxLoss: "10%",
      minDays: 5,
      profitSplit: "80%",
    });
  });
});

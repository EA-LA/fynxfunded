import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import RuleCalculator from "@/components/RuleCalculator";
import FAQ from "@/pages/FAQ";
import { filterFaq } from "@/lib/faqSearch";
import { faqItems } from "@/lib/mockData";
import { checkConsistency, dailyLossFloor, effectiveFloor, getRulePlan } from "@/lib/ruleCalculator";

afterEach(cleanup);

describe("rule calculator maths", () => {
  it("turns the published schedule into dollars", () => {
    const plan = getRulePlan(25000, "2-phase");
    expect(plan.dailyLossPercent).toBe(5);
    expect(plan.maxLossAmount).toBe(2500);
    expect(plan.maxLossFloor).toBe(22500);
    expect(plan.phases.map((p) => p.targetProfit)).toEqual([2000, 1250]);
    expect(getRulePlan(100000, "3-phase").phases.map((p) => p.targetBalance)).toEqual([106000, 105000, 104000]);
    expect(getRulePlan(5000, "1-phase")).toMatchObject({ dailyLossPercent: 4, maxLossFloor: 4600, minDays: 3 });
  });
  it("uses the reset balance for the daily floor and the higher floor overall", () => {
    expect(dailyLossFloor(26000, 5)).toEqual({ amount: 1300, floor: 24700 });
    const plan = getRulePlan(10000, "1-phase");
    expect(effectiveFloor(plan, 10000)).toMatchObject({ floor: 9600, binding: "daily" });
    expect(effectiveFloor(plan, 9300)).toMatchObject({ floor: 9200, binding: "maximum" });
  });
  it("mirrors the 40% best-day consistency rule", () => {
    expect(checkConsistency([400, 300, 300])).toMatchObject({ totalProfit: 1000, bestDay: 400, sharePercent: 40, passes: true });
    expect(checkConsistency([500, 300, 200, -100])).toMatchObject({ sharePercent: 55.56, passes: false, profitNeededForBestDay: 1250 });
    expect(checkConsistency([-50, -20])).toMatchObject({ bestDay: 0, sharePercent: null, passes: false });
    expect(() => getRulePlan(1234, "1-phase")).toThrow();
  });
});

describe("rule calculator widget", () => {
  it("updates limits and consistency as the trader types", () => {
    render(<RuleCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "$100K" }));
    fireEvent.click(screen.getByRole("button", { name: "1-phase" }));
    expect(screen.getByText("+$10,000")).toBeInTheDocument();
    expect(screen.getByText("Equity floor $92,000")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Balance at daily reset (USD)"), { target: { value: "101000" } });
    expect(screen.getByText("$96,960")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Day 1"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Day 2"), { target: { value: "1000" } });
    expect(screen.getByText(/needs to reach \$7,500/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Day 3"), { target: { value: "abc" } });
    expect(screen.getByText(/isn't a number/)).toBeInTheDocument();
  });
});

describe("faq page", () => {
  it("filters questions and publishes FAQ structured data", () => {
    expect(filterFaq(faqItems, "WEEKEND")).toHaveLength(1);
    expect(filterFaq(faqItems, "")).toHaveLength(faqItems.length);
    render(<I18nProvider><MemoryRouter><FAQ /></MemoryRouter></I18nProvider>);
    const schema = JSON.parse(document.getElementById("faq-schema")!.textContent!);
    expect(schema["@type"]).toBe("FAQPage");
    expect(schema.mainEntity).toHaveLength(faqItems.length);
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "refund" } });
    expect(screen.getByText(`1 of ${faqItems.length} questions match`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "zzzz" } });
    expect(screen.getByText(/No questions match/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Email support/ })).toHaveAttribute("href", "mailto:support@fynxfunded.com");
    cleanup();
    expect(document.getElementById("faq-schema")).toBeNull();
  });
});

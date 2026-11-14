import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import RuleCalculator from "@/components/RuleCalculator";
import FAQ from "@/pages/FAQ";
import { filterFaq } from "@/lib/faqSearch";
import { faqItems } from "@/lib/mockData";
import { calculatorLink, checkConsistency, dailyLossFloor, effectiveFloor, getRulePlan, parseCalculatorPreset, summarizeProgram } from "@/lib/ruleCalculator";
import ProgramComparison from "@/components/ProgramComparison";
import ChallengesPricing from "@/pages/ChallengesPricing";

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
    render(<MemoryRouter><RuleCalculator /></MemoryRouter>);
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

describe("calculator deep links", () => {
  it("parses presets safely and builds links", () => {
    expect(parseCalculatorPreset(new URLSearchParams("size=50000&program=3-phase&phase=3"))).toEqual({ accountSize: 50000, program: "3-phase", phase: 3 });
    expect(parseCalculatorPreset(new URLSearchParams("size=1234&program=9-phase&phase=7"))).toEqual({ accountSize: 25000, program: "2-phase", phase: 1 });
    expect(parseCalculatorPreset(new URLSearchParams("size=10000&program=1-phase&phase=2")).phase).toBe(1);
    expect(calculatorLink(100000, "2-phase")).toBe("/rules?size=100000&program=2-phase#calculator");
    expect(calculatorLink(5000, "3-phase", 2)).toBe("/rules?size=5000&program=3-phase&phase=2#calculator");
  });

  it("opens with the linked size, program and phase and tracks the chosen phase target", () => {
    render(<MemoryRouter initialEntries={["/rules?size=50000&program=3-phase&phase=2#calculator"]}><RuleCalculator /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "$50K" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3-phase" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Phase 2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Day 1"), { target: { value: "1000" } });
    expect(screen.getByText(/Phase 2 target is \$2,500/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Phase 3" }));
    expect(screen.getByText(/Phase 3 target is \$2,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1-phase" }));
    expect(screen.queryByRole("button", { name: "Phase 1" })).toBeNull();
    expect(screen.getByText(/Phase 1 target is \$5,000/)).toBeInTheDocument();
  });
});

describe("program comparison", () => {
  it("summarises each program in dollars", () => {
    expect(summarizeProgram(25000, "2-phase")).toMatchObject({ price: 199, combinedTargetProfit: 3250, minimumTotalDays: 10, startingDailyLossAmount: 1250, feePercentOfAccount: 0.8 });
    expect(summarizeProgram(100000, "3-phase")).toMatchObject({ combinedTargetProfit: 15000, minimumTotalDays: 15 });
    expect(summarizeProgram(5000, "1-phase")).toMatchObject({ combinedTargetProfit: 500, minimumTotalDays: 3, startingDailyLossAmount: 200 });
  });

  it("switches account size and links each program to the calculator", () => {
    render(<MemoryRouter><ProgramComparison /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "$100K" }));
    const three = screen.getByRole("article", { name: "3-phase program" });
    expect(three).toHaveTextContent("+$15,000");
    expect(three).toHaveTextContent("Lowest fee");
    expect(three).toHaveTextContent("Most room");
    expect(screen.getByRole("article", { name: "1-phase program" })).toHaveTextContent("Fastest minimum");
    const links = screen.getAllByRole("link", { name: /rules calculator/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/rules?size=100000&program=1-phase#calculator",
      "/rules?size=100000&program=2-phase#calculator",
      "/rules?size=100000&program=3-phase#calculator",
    ]);
  });

  it("appears on the challenges page with calculator links on plan cards", () => {
    render(<I18nProvider><MemoryRouter><ChallengesPricing /></MemoryRouter></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Which program fits you?" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /See the rules in dollars/ })[0]).toHaveAttribute("href", "/rules?size=10000&program=2-phase#calculator");
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
    expect(screen.getByText(`2 of ${faqItems.length} questions match`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "zzzz" } });
    expect(screen.getByText(/No questions match/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Email support/ })).toHaveAttribute("href", "mailto:support@fynxfunded.com");
    cleanup();
    expect(document.getElementById("faq-schema")).toBeNull();
  });
});

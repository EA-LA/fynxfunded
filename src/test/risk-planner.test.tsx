import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import RiskPlanner from "@/components/RiskPlanner";
import RulesPage from "@/pages/Rules";
import { I18nProvider } from "@/lib/i18n";
import { getRulePlan } from "@/lib/ruleCalculator";
import { consistencyMinimumDays, parseRiskPreset, planRisk, riskPlannerLink } from "@/lib/riskPlanner";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("risk planner maths", () => {
  it("fits a dollar risk into the loss allowances", () => {
    const r = planRisk({ plan: getRulePlan(25000, "2-phase"), phase: 1, riskMode: "percent", riskValue: 0.5, rewardRatio: 2, plannedDays: 10 });
    expect(r).toMatchObject({
      riskAmount: 125,
      riskPercent: 0.5,
      dailyAllowance: 1250,
      maxAllowance: 2500,
      lossesToDailyFloor: 10,
      lossesToMaxFloor: 20,
      worstDaysToMaxFloor: 2,
      exceedsDailyAllowance: false,
      targetProfit: 2000,
      rewardPerWin: 250,
      winsNeededWithoutLosses: 8,
      breakEvenWinRate: 33.33,
      minimumDays: 5,
      days: 10,
      averagePerDay: 200,
      bestDayCap: 800,
    });
  });

  it("uses the chosen phase target, raises too-few days and flags oversized risk", () => {
    const r = planRisk({ plan: getRulePlan(10000, "1-phase"), phase: 3, riskMode: "dollars", riskValue: 450, rewardRatio: 1.5, plannedDays: 1 });
    expect(r.phase).toBe(1);
    expect(r.targetProfit).toBe(1000);
    expect(r.exceedsDailyAllowance).toBe(true);
    expect(r.lossesToDailyFloor).toBe(0);
    // 1-phase needs 3 days, which is also what the 40% rule needs.
    expect(consistencyMinimumDays()).toBe(3);
    expect(r).toMatchObject({ minimumDays: 3, days: 3, plannedDaysRaised: true, averagePerDay: 333.33, winsNeededWithoutLosses: 2 });
    const third = planRisk({ plan: getRulePlan(100000, "3-phase"), phase: 3, riskMode: "dollars", riskValue: 1000, rewardRatio: 1, plannedDays: 8 });
    expect(third).toMatchObject({ targetProfit: 4000, winsNeededWithoutLosses: 4, breakEvenWinRate: 50, lossesToMaxFloor: 12 });
  });

  it("rejects nonsense input", () => {
    const plan = getRulePlan(5000, "1-phase");
    expect(() => planRisk({ plan, phase: 1, riskMode: "dollars", riskValue: 0, rewardRatio: 2, plannedDays: 5 })).toThrow();
    expect(() => planRisk({ plan, phase: 1, riskMode: "percent", riskValue: Number.NaN, rewardRatio: 2, plannedDays: 5 })).toThrow();
    expect(() => planRisk({ plan, phase: 1, riskMode: "percent", riskValue: 1, rewardRatio: 0, plannedDays: 5 })).toThrow();
  });
});

describe("risk planner widget", () => {
  it("updates the plan as the trader changes inputs", () => {
    render(<MemoryRouter initialEntries={["/rules?size=50000&program=3-phase&phase=2"]}><RiskPlanner /></MemoryRouter>);
    // Preset from the shared link: $50K 3-phase, phase 2 target 5% = $2,500.
    expect(screen.getByRole("heading", { name: /phase 2 target of \$2,500/ })).toBeInTheDocument();
    expect(screen.getByText("$250 on a $50,000 account.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dollars" }));
    expect(screen.getByLabelText("Risk per trade (USD)")).toHaveValue("250");
    fireEvent.change(screen.getByLabelText("Risk per trade (USD)"), { target: { value: "3000" } });
    expect(screen.getByText(/single losing trade could record a breach/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Risk per trade (USD)"), { target: { value: "abc" } });
    expect(screen.getByText(/Enter a dollar amount above 0/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Risk per trade (USD)"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Trading days you plan to use"), { target: { value: "2" } });
    expect(screen.getByText(/Raised to 5 days/)).toBeInTheDocument();
    const pace = screen.getByText(/Steady pace over 5 days/).closest("div")!;
    expect(within(pace).getByText("$500")).toBeInTheDocument();
  });

  it("is linked from the Rules page", () => {
    render(<I18nProvider><MemoryRouter initialEntries={["/rules"]}><RulesPage /></MemoryRouter></I18nProvider>);
    expect(screen.getByRole("link", { name: /Plan your risk per trade/ })).toHaveAttribute("href", "#risk-planner");
    expect(screen.getByRole("heading", { name: "Risk and pace planner" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
  });
});

describe("shareable planner links", () => {
  it("reads and writes the planner's own choices", () => {
    expect(parseRiskPreset(new URLSearchParams("risk=250&unit=usd&rr=1.5&days=12"))).toEqual({ riskMode: "dollars", riskInput: "250", rewardRatio: 1.5, daysInput: "12" });
    // Out-of-range or junk values fall back to the defaults.
    expect(parseRiskPreset(new URLSearchParams("risk=500&rr=7&days=0"))).toEqual({ riskMode: "percent", riskInput: "0.5", rewardRatio: 2, daysInput: "10" });
    expect(parseRiskPreset(new URLSearchParams("risk=abc&unit=usd&days=2.5"))).toMatchObject({ riskMode: "percent", riskInput: "0.5", daysInput: "10" });
    expect(riskPlannerLink({ accountSize: 50000, program: "3-phase", phase: 2, riskMode: "dollars", riskValue: 250, rewardRatio: 3, plannedDays: 8 }))
      .toBe("/rules?size=50000&program=3-phase&phase=2&risk=250&unit=usd&rr=3&days=8#risk-planner");
    expect(riskPlannerLink({ accountSize: 10000, riskValue: 1.25 })).toBe("/rules?size=10000&risk=1.25#risk-planner");
  });

  it("opens a shared plan and copies a link to the current one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<MemoryRouter initialEntries={["/rules?size=100000&program=1-phase&risk=400&unit=usd&rr=3&days=6"]}><RiskPlanner /></MemoryRouter>);
    expect(screen.getByLabelText("Risk per trade (USD)")).toHaveValue("400");
    expect(screen.getByRole("button", { name: "3× risk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Trading days you plan to use")).toHaveValue("6");

    fireEvent.click(screen.getByRole("button", { name: "1.5× risk" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy a link to this plan/ }));
    expect(await screen.findByRole("button", { name: /Link copied/ })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rules?size=100000&program=1-phase&risk=400&unit=usd&rr=1.5&days=6#risk-planner`);

    // Changing the plan makes the copied message stale.
    fireEvent.click(screen.getByRole("button", { name: "2× risk" }));
    expect(screen.getByRole("button", { name: /Copy a link to this plan/ })).toBeInTheDocument();
  });

  it("shows the address to copy by hand when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    render(<MemoryRouter initialEntries={["/rules"]}><RiskPlanner /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Copy a link to this plan/ }));
    const field = await screen.findByLabelText(/Select and copy this address/);
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}/rules?size=25000&program=2-phase&risk=0.5&rr=2&days=10#risk-planner`);
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChallengeSimulator from "@/components/ChallengeSimulator";
import RiskPlanner from "@/components/RiskPlanner";
import RulesPage from "@/pages/Rules";
import { I18nProvider } from "@/lib/i18n";
import { faqItems } from "@/lib/faqContent";
import { getRulePlan } from "@/lib/ruleCalculator";
import { mulberry32, parseSimulatorPreset, simulateChallenge, simulatorLink, type SimulationInput } from "@/lib/challengeSimulator";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = (over: Partial<SimulationInput> = {}): SimulationInput => ({
  plan: getRulePlan(25000, "2-phase"),
  phase: 1,
  riskAmount: 250,
  rewardRatio: 2,
  winRatePercent: 50,
  tradesPerDay: 1,
  dayLimit: 60,
  costPerTrade: 0,
  stopBeforeBreach: true,
  runs: 500,
  seed: 1,
  ...over,
});

describe("challenge simulator maths", () => {
  it("is repeatable for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(seqA).toEqual(Array.from({ length: 5 }, b));
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(simulateChallenge(base())).toEqual(simulateChallenge(base()));
    expect(simulateChallenge(base({ seed: 2 }))).not.toEqual(simulateChallenge(base()));
  });

  it("waits for the minimum days and the 40% rule after the target is reached", () => {
    // $25K 2-phase phase 1: target $2,000. 1% risk at 2x = $500 a win, one trade a day.
    // Four straight wins reach the target on day 4, but 5 trading days are required.
    const r = simulateChallenge(base({ riskAmount: 250 * 2, winRatePercent: 99, runs: 300 }));
    expect(r.percents.passed).toBeGreaterThan(90);
    expect(r.medianDaysToPass).toBe(5);
    expect(r.fastestPass).toBe(5);
    expect(r.passesDelayedByRules).toBeGreaterThan(250);
    const total = Object.values(r.counts).reduce((s, n) => s + n, 0);
    expect(total).toBe(300);
    expect(r.passDays.reduce((s, b) => s + b.count, 0)).toBe(r.counts.passed);
  });

  it("records daily breaches when the trader takes every planned trade", () => {
    // $500 risk, five trades a day, $1,250 daily allowance: three losses break the floor.
    const r = simulateChallenge(base({ riskAmount: 500, tradesPerDay: 5, winRatePercent: 1, stopBeforeBreach: false }));
    expect(r.percents.dailyBreach).toBeGreaterThan(95);
    expect(r.counts.passed).toBe(0);
  });

  it("stops before a breach and runs out of room above the static floor", () => {
    const r = simulateChallenge(base({ riskAmount: 500, tradesPerDay: 5, winRatePercent: 1, stopBeforeBreach: true }));
    expect(r.counts.dailyBreach + r.counts.maxBreach).toBe(0);
    expect(r.percents.outOfRoom).toBeGreaterThan(95);
  });

  it("counts runs that hit the day limit as unfinished and chains every phase", () => {
    const short = simulateChallenge(base({ dayLimit: 3, winRatePercent: 99 }));
    expect(short.percents.unfinished).toBe(100);

    const all = simulateChallenge(base({ plan: getRulePlan(25000, "3-phase"), phase: "all", riskAmount: 500, winRatePercent: 99, runs: 200 }));
    expect(all.phases).toEqual([1, 2, 3]);
    // Three phases × 5 minimum days each.
    expect(all.fastestPass).toBeGreaterThanOrEqual(15);
    const one = simulateChallenge(base({ plan: getRulePlan(25000, "3-phase"), phase: 1, riskAmount: 500, winRatePercent: 99, runs: 200 }));
    expect(one.medianDaysToPass!).toBeLessThan(all.medianDaysToPass!);
  });

  it("takes charges off every trade", () => {
    const free = simulateChallenge(base({ winRatePercent: 40, runs: 800 }));
    const costly = simulateChallenge(base({ winRatePercent: 40, runs: 800, costPerTrade: 60 }));
    expect(costly.percents.passed).toBeLessThan(free.percents.passed);
  });

  it("rejects nonsense input", () => {
    expect(() => simulateChallenge(base({ riskAmount: 0 }))).toThrow();
    expect(() => simulateChallenge(base({ winRatePercent: 100 }))).toThrow();
    expect(() => simulateChallenge(base({ costPerTrade: -1 }))).toThrow();
  });
});

describe("shareable simulator links", () => {
  it("reads and writes the simulator's choices", () => {
    expect(parseSimulatorPreset(new URLSearchParams("sphase=all&risk=300&unit=usd&rr=3&wr=52.5&tpd=3&limit=40&cost=7&stop=0"), 2)).toEqual({
      phase: "all",
      riskMode: "dollars",
      riskInput: "300",
      rewardRatio: 3,
      winRateInput: "52.5",
      tradesPerDay: 3,
      dayLimitInput: "40",
      costInput: "7",
      stopBeforeBreach: false,
    });
    // Junk falls back to defaults; the planner's "phase" is used when sphase is missing.
    expect(parseSimulatorPreset(new URLSearchParams("phase=2&wr=100&tpd=4&limit=0&cost=-3"), 2)).toMatchObject({
      phase: 2,
      winRateInput: "45",
      tradesPerDay: 2,
      dayLimitInput: "60",
      costInput: "0",
      stopBeforeBreach: true,
    });
    expect(parseSimulatorPreset(new URLSearchParams("phase=3"), 2).phase).toBe(1);
    expect(simulatorLink({ accountSize: 50000, program: "3-phase", phase: "all", riskMode: "dollars", riskValue: 250, rewardRatio: 1.5, winRate: 48, tradesPerDay: 3, dayLimit: 90, costPerTrade: 5, stopBeforeBreach: false }))
      .toBe("/rules?size=50000&program=3-phase&sphase=all&risk=250&unit=usd&rr=1.5&wr=48&tpd=3&limit=90&cost=5&stop=0#simulator");
    expect(simulatorLink({ accountSize: 10000, riskValue: 1 })).toBe("/rules?size=10000&risk=1#simulator");
  });
});

describe("challenge simulator widget", () => {
  it("runs the shared plan and reacts to changes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<MemoryRouter initialEntries={["/rules?size=25000&program=2-phase&risk=1&rr=2&wr=99&tpd=1#simulator"]}><ChallengeSimulator /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Passed phase 1" })).toBeInTheDocument();
    expect(Number(screen.getByTestId("sim-pass-rate").textContent!.replace("%", ""))).toBeGreaterThan(90);
    expect(screen.getByText(/target was reached before the minimum 5 trading days/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All phases" }));
    expect(screen.getByRole("heading", { name: "Passed all 2 phases" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Win rate (%)"), { target: { value: "20" } });
    expect(screen.getByText(/loses money on average/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Win rate (%)"), { target: { value: "120" } });
    expect(screen.getByText("Enter a win rate from 1 to 99.")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-pass-rate")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Win rate (%)"), { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: /Copy a link to this simulation/ }));
    expect(await screen.findByRole("button", { name: /Link copied/ })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rules?size=25000&program=2-phase&sphase=all&risk=1&rr=2&wr=50&tpd=1&limit=60#simulator`);
  });

  it("explains when a single loss is bigger than the daily allowance", () => {
    render(<MemoryRouter initialEntries={["/rules?size=10000&program=1-phase&risk=600&unit=usd"]}><ChallengeSimulator /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("bigger than the $400 daily allowance");
    expect(screen.getByRole("button", { name: /Run again/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Stop for the day/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const outcomes = screen.getByRole("heading", { name: /How the 2,000 runs ended/ }).parentElement!;
    expect(within(outcomes).getByText("Broke the daily loss limit")).toBeInTheDocument();
  });

  it("is linked from the Rules page, the risk planner and the FAQ", () => {
    render(<I18nProvider><MemoryRouter initialEntries={["/rules"]}><RulesPage /></MemoryRouter></I18nProvider>);
    expect(screen.getByRole("link", { name: /Simulate how often a plan passes/ })).toHaveAttribute("href", "#simulator");
    expect(screen.getByRole("heading", { name: "Challenge pass simulator" })).toBeInTheDocument();
    cleanup();
    render(<MemoryRouter initialEntries={["/rules?size=50000&program=3-phase&phase=2"]}><RiskPlanner /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Test this plan in the pass simulator/ })).toHaveAttribute(
      "href",
      "/rules?size=50000&program=3-phase&sphase=2&risk=0.5&rr=2#simulator",
    );
    expect(faqItems.find((i) => i.id === "pass-odds")?.link?.to).toBe("/rules#simulator");
  });
});

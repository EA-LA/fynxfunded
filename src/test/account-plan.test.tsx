import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountPlanFor, programFromPurchase } from "@/lib/accountPlan";
import AccountPlanCard, { TradingDayStrip } from "@/components/AccountPlanCard";

const mocks = vi.hoisted(() => ({
  challenges: [] as unknown[],
  auth: { user: { userId: "u1" } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/services/database", () => ({
  dataService: { getChallenges: async () => mocks.challenges, getAccounts: async () => [] },
}));
import DashboardOverview from "@/pages/dashboard/Overview";

afterEach(cleanup);

describe("programFromPurchase", () => {
  it("reads the program names used on purchases", () => {
    expect(programFromPurchase("2-phase")).toBe("2-phase");
    expect(programFromPurchase("3 Phase")).toBe("3-phase");
    expect(programFromPurchase("one-step")).toBe("1-phase");
    expect(programFromPurchase("")).toBeNull();
    expect(programFromPurchase("instant")).toBeNull();
    expect(programFromPurchase(undefined)).toBeNull();
  });
});

describe("accountPlanFor", () => {
  it("shows the published schedule in dollars for the recorded phase", () => {
    const v = accountPlanFor({ accountSize: 10000, phase: "2-phase", currentPhase: 2, status: "active" })!;
    expect(v.phase).toBe(2);
    expect(v.phaseAssumed).toBe(false);
    expect(v.phaseTarget.targetProfit).toBe(500);
    expect(v.startingDailyLossAmount).toBe(500);
    expect(v.plan.maxLossFloor).toBe(9000);
    expect(v.stages.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
    expect(v.links.calculator).toBe("/rules?size=10000&program=2-phase&phase=2#calculator");
    expect(v.links.riskPlanner).toBe("/rules?size=10000&program=2-phase&phase=2#risk-planner");
    expect(v.links.simulator).toBe("/rules?size=10000&program=2-phase&sphase=2#simulator");
    expect(v.links.positionSize).toContain("size=10000");
  });

  it("assumes phase 1 when the phase is missing or out of range", () => {
    expect(accountPlanFor({ accountSize: 25000, phase: "3-phase", status: "active" })).toMatchObject({ phase: 1, phaseAssumed: true });
    expect(accountPlanFor({ accountSize: 25000, phase: "3-phase", currentPhase: 7, status: "active" })).toMatchObject({ phase: 1, phaseAssumed: true });
  });

  it("marks every phase done once funded", () => {
    const v = accountPlanFor({ accountSize: 5000, phase: "1-phase", status: "funded" })!;
    expect(v.funded).toBe(true);
    expect(v.stages).toEqual([{ label: "Phase 1", state: "done" }, { label: "Funded", state: "current" }]);
  });

  it("returns null for sizes or programs outside the published schedule", () => {
    expect(accountPlanFor({ accountSize: 12345, phase: "2-phase", status: "active" })).toBeNull();
    expect(accountPlanFor({ accountSize: 10000, phase: "instant", status: "active" })).toBeNull();
  });
});

const renderCard = (challenge: Parameters<typeof AccountPlanCard>[0]["challenge"]) =>
  render(<MemoryRouter><AccountPlanCard challenge={challenge} now={new Date("2026-11-07T19:30:00Z")} /></MemoryRouter>);

describe("AccountPlanCard", () => {
  it("lists the rules, the path and tools for this account", () => {
    renderCard({ accountSize: 10000, phase: "2-phase", currentPhase: 1, status: "active" });
    const card = screen.getByTestId("account-plan-card");
    expect(within(card).getByText("+$800")).toBeInTheDocument();
    expect(within(card).getByText("$500")).toBeInTheDocument();
    expect(within(card).getByText("$9,000")).toBeInTheDocument();
    expect(screen.getByTestId("later-phases")).toHaveTextContent("Still to come: phase 2 +$500");
    expect(within(card).getByText("Phase 1").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: /How many losing trades fit/ })).toHaveAttribute("href", "/rules?size=10000&program=2-phase#risk-planner");
    expect(screen.getByRole("link", { name: /Test your plan/ })).toHaveAttribute("href", "/rules?size=10000&program=2-phase#simulator");
    expect(screen.getByTestId("trading-day-strip")).toHaveTextContent("ends in 2h 30m");
    expect(screen.queryByTestId("phase-assumed")).toBeNull();
  });

  it("says when the phase was assumed and on the last phase what comes next", () => {
    renderCard({ accountSize: 10000, phase: "2-phase", status: "active" });
    expect(screen.getByTestId("phase-assumed")).toBeInTheDocument();
    cleanup();
    renderCard({ accountSize: 10000, phase: "2-phase", currentPhase: 2, status: "active" });
    expect(screen.getByTestId("later-phases")).toHaveTextContent("This is the last phase");
  });

  it("shows the profit split for funded accounts", () => {
    renderCard({ accountSize: 10000, phase: "2-phase", status: "funded" });
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Twice a month")).toBeInTheDocument();
    expect(screen.queryByText(/profit target/i)).toBeNull();
  });

  it("explains when the size isn't in the published schedule", () => {
    renderCard({ accountSize: 12345, phase: "2-phase", status: "active" });
    expect(screen.getByText(/isn’t in the published new-account schedule/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Objectives/ })).toHaveAttribute("href", "/dashboard/objectives");
  });

  it("counts down to the reset in seconds near the end of the day", () => {
    render(<TradingDayStrip now={new Date("2026-11-07T21:59:15Z")} />);
    expect(screen.getByTestId("trading-day-strip")).toHaveTextContent("ends in 0m 45s");
  });
});

describe("dashboard overview", () => {
  it("shows the rules card for the active challenge", async () => {
    mocks.challenges = [{ challengeId: "ch-1", name: "$25K 3-Phase", status: "active", phase: "3-phase", accountSize: 25000, style: "standard", startDate: "2026-11-01" }];
    render(<MemoryRouter><DashboardOverview /></MemoryRouter>);
    const card = await screen.findByTestId("account-plan-card");
    expect(within(card).getByText("+$1,500")).toBeInTheDocument();
  });

  it("offers planning tools when there is no active challenge", async () => {
    mocks.challenges = [];
    render(<MemoryRouter><DashboardOverview /></MemoryRouter>);
    const box = await screen.findByTestId("plan-before-buying");
    expect(within(box).getByRole("link", { name: /Find your challenge/ })).toHaveAttribute("href", "/challenges#finder");
    expect(screen.queryByTestId("account-plan-card")).toBeNull();
  });
});

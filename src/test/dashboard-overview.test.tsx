import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Challenge } from "@/services/types";

const mocks = vi.hoisted(() => ({ challenges: [] as unknown[], accounts: [] as unknown[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" } }) }));
vi.mock("@/services/database", () => ({
  dataService: { getChallenges: async () => mocks.challenges, getAccounts: async () => mocks.accounts },
}));
import DashboardOverview, { liveAccounts, statusCounts } from "@/pages/dashboard/Overview";

afterEach(cleanup);

const ch = (id: string, status: Challenge["status"], extra: Partial<Challenge> = {}): Challenge => ({
  challengeId: id, userId: "u1", orderId: `o-${id}`, name: `$10K 2-Phase ${id}`, phase: "2-phase", accountSize: 10000, style: "standard", status, startDate: "2026-11-01", ...extra,
});

describe("dashboard home account helpers", () => {
  it("lists funded accounts before evaluations, newest first", () => {
    const list = liveAccounts([ch("a", "active", { startDate: "2026-10-01" }), ch("f", "funded"), ch("b", "active", { startDate: "2026-11-03" }), ch("x", "failed")]);
    expect(list.map((c) => c.challengeId)).toEqual(["f", "b", "a"]);
  });
  it("counts accounts by stage", () => {
    expect(statusCounts([ch("a", "active"), ch("f", "funded"), ch("p", "passed"), ch("x", "failed"), ch("e", "expired")])).toEqual({ funded: 1, active: 1, passed: 1, ended: 2 });
  });
});

describe("dashboard home", () => {
  it("shows a funded account on the main card with payout shortcuts", async () => {
    mocks.challenges = [ch("f1", "funded")];
    mocks.accounts = [];
    render(<MemoryRouter><DashboardOverview /></MemoryRouter>);
    const tools = await screen.findByTestId("account-tools");
    expect(within(tools).getByRole("link", { name: /Payouts/ })).toHaveAttribute("href", "/dashboard/payouts");
    expect(within(tools).getByRole("link", { name: /Account workspace/ })).toHaveAttribute("href", "/dashboard/accounts/f1");
    expect(within(tools).getByRole("link", { name: /FYNX Trade terminal/ })).toHaveAttribute("href", "/trade/access");
    expect(screen.getAllByText("Funded").length).toBeGreaterThan(0);
    expect(screen.queryByText("No active challenges")).toBeNull();
    expect(screen.getByTestId("status-summary")).toHaveTextContent("Funded1");
    expect(screen.queryByTestId("account-switcher")).toBeNull();
  });

  it("switches between several live accounts", async () => {
    mocks.challenges = [ch("a1", "active", { currentPhase: 2 }), ch("f1", "funded")];
    mocks.accounts = [{ accountId: "t1", userId: "u1", challengeId: "a1", platform: "FYNX Trade", server: "FYNX-Live", login: "100200", balance: 0, equity: 0, status: "active" }];
    render(<MemoryRouter><DashboardOverview /></MemoryRouter>);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveTextContent("Funded");
    expect(screen.getByText("Trading credentials pending")).toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Phase 2 · 2 phase")).toBeInTheDocument();
    expect(within(screen.getByTestId("account-tools")).getByRole("link", { name: /Objectives/ })).toHaveAttribute("href", "/dashboard/objectives");
    expect(screen.getByText("FYNX-Live")).toBeInTheDocument();
    expect(screen.getByTestId("password-note")).toHaveTextContent("Never shown");
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("says when an account passed and is in review, and stays honest with no live account", async () => {
    mocks.challenges = [ch("p1", "passed"), ch("x1", "failed")];
    mocks.accounts = [];
    render(<MemoryRouter><DashboardOverview /></MemoryRouter>);
    expect(await screen.findByTestId("passed-notice")).toHaveTextContent("1 account passed its phase");
    expect(screen.getByText("No active challenges")).toBeInTheDocument();
    expect(screen.getByText(/None of your accounts is trading right now/)).toBeInTheDocument();
    expect(screen.queryByTestId("account-tools")).toBeNull();
  });
});

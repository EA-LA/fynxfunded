import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Challenge } from "@/services/types";
import { fundedSplits, scheduleSplitRange, traderShare } from "@/lib/fundedSplit";

const mocks = vi.hoisted(() => ({ challenges: [] as unknown[], fail: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1", emailVerified: true, kycStatus: "pending" } }) }));
vi.mock("@/services/database", () => ({ dataService: { getChallenges: async () => { if (mocks.fail) throw new Error("offline"); return mocks.challenges; } } }));
vi.mock("@/services/kyc", () => ({ watchCurrentUserKyc: () => () => {} }));
vi.mock("@/services/payouts", () => ({ canRequestPayout: async () => ({ allowed: false, reason: "" }), getUserPayouts: async () => [], requestPayout: vi.fn() }));
vi.mock("@/hooks/use-trading-data", () => ({ useTradingData: () => ({ hasAccount: false, payout: null }) }));
import DashboardPayouts from "@/pages/dashboard/DashboardPayouts";

afterEach(() => { cleanup(); mocks.fail = false; });

const ch = (id: string, status: Challenge["status"], extra: Partial<Challenge> = {}): Challenge => ({
  challengeId: id, userId: "u1", orderId: `o-${id}`, name: id, phase: "2-phase", accountSize: 10000, style: "standard", status, startDate: "2026-11-01", accountReference: `FX-${id}`, ...extra,
});

describe("funded profit split from the published schedule", () => {
  it("knows the schedule's range", () => {
    expect(scheduleSplitRange()).toEqual({ min: 75, max: 90 });
  });
  it("keeps the general range when nothing is funded", () => {
    expect(fundedSplits([ch("a", "active", { accountSize: 50000 })])).toMatchObject({ rows: [], value: "Up to 90%", personal: false });
  });
  it("shows the one funded plan's split", () => {
    const s = fundedSplits([ch("a", "active"), ch("f", "funded", { accountSize: 50000 })]);
    expect(s).toMatchObject({ value: "85%", desc: "Your $50,000 2 phase plan", personal: true });
    expect(s.rows.map(r => r.splitPercent)).toEqual([85]);
  });
  it("shows a range across several funded accounts and handles plans outside the schedule", () => {
    const s = fundedSplits([ch("f1", "funded"), ch("f2", "funded", { accountSize: 50000 }), ch("f3", "funded", { accountSize: 12345 })]);
    expect(s).toMatchObject({ value: "80–85%", desc: "Depends on the account; see below", personal: true });
    expect(s.rows.map(r => r.splitPercent)).toEqual([80, 85, null]);
    expect(fundedSplits([ch("f1", "funded"), ch("f2", "funded", { phase: "2 Phase" })])).toMatchObject({ value: "80%", desc: "All 2 funded accounts" });
    expect(fundedSplits([ch("x", "funded", { phase: "mystery" })])).toMatchObject({ value: "Up to 90%", personal: false, desc: expect.stringMatching(/isn't in the published schedule/) });
  });
  it("works out the example share in cents", () => {
    expect(traderShare(1000, 85)).toBe(850);
    expect(traderShare(333.33, 80)).toBe(266.66);
  });
});

describe("Dashboard Payouts", () => {
  it("shows the trader's own split and a worked example per funded account", async () => {
    mocks.challenges = [ch("f1", "funded"), ch("f2", "funded", { accountSize: 50000, phase: "3-phase" }), ch("a1", "active")];
    render(<MemoryRouter><DashboardPayouts /></MemoryRouter>);
    const card = await screen.findByTestId("funded-split-card");
    const rows = within(card).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/FX-f1.*\$10,000 · 2 phase.*80%.*you \$800\.00 · FYNX \$200\.00/);
    expect(rows[1]).toHaveTextContent(/FX-f2.*\$50,000 · 3 phase.*85%.*you \$850\.00 · FYNX \$150\.00/);
    expect(screen.getByText("Your Profit Split")).toBeInTheDocument();
    expect(screen.getByText("80–85%")).toBeInTheDocument();
    expect(within(card).getByText(/is an example amount, not your balance/)).toBeInTheDocument();
  });

  it("keeps the general wording when there is no funded account or the accounts can't be loaded", async () => {
    mocks.challenges = [ch("a1", "active")];
    render(<MemoryRouter><DashboardPayouts /></MemoryRouter>);
    expect(await screen.findByText("Up to 90%")).toBeInTheDocument();
    expect(screen.queryByTestId("funded-split-card")).toBeNull();
    cleanup();
    mocks.fail = true;
    render(<MemoryRouter><DashboardPayouts /></MemoryRouter>);
    expect(await screen.findByText("Up to 90%")).toBeInTheDocument();
    expect(screen.queryByTestId("funded-split-card")).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/tradingData";

const trade = (id: string, symbol: string, pnl: number): Trade => ({
  id, accountId: "acc-1", challengeId: "ch-1", symbol, type: "Buy", openTime: "2026-11-02T09:00:00.000Z", closeTime: "2026-11-02T10:00:00.000Z",
  lots: 1, pnl, pips: 0, duration: "1h", riskPercent: 0.5, rr: 2, session: "London", result: pnl > 0 ? "Win" : "Loss",
});
const mocks = vi.hoisted(() => ({ trades: [] as Trade[], auth: { user: { userId: "u1" } } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-trading-data", async () => {
  const actual = await import("@/lib/tradingData");
  return { useTradingData: () => ({ loading: false, error: "", trades: mocks.trades }), computeAnalytics: actual.computeAnalytics };
});
vi.mock("@/services/database", () => ({
  dataService: {
    getChallenges: async () => [{ challengeId: "ch-1", name: "$10K 2-Phase", status: "active", phase: "2-phase", accountSize: 10000, style: "standard" }],
    getAccounts: async () => [],
  },
}));
vi.mock("@/components/AccountEquityHistory", () => ({ default: () => null }));
vi.mock("@/components/TradingAccess", () => ({ default: () => null }));
vi.mock("@/components/OrderProgress", () => ({ default: () => null }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, Area: () => null, AreaChart: () => null, Bar: () => null, BarChart: () => null, Cell: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import AccountWorkspace from "@/pages/dashboard/AccountWorkspace";

afterEach(cleanup);

describe("account workspace analysis tab", () => {
  it("shows the instrument, timing and trading-day breakdowns for this account", async () => {
    mocks.trades = [trade("1", "EURUSD", 100), trade("2", "EURUSD", 40), trade("3", "EURUSD", -20), trade("4", "XAUUSD", -50)];
    render(<MemoryRouter initialEntries={["/dashboard/accounts/ch-1"]}><Routes><Route path="/dashboard/accounts/:challengeId" element={<AccountWorkspace />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Analysis/ }));
    expect(screen.getByRole("heading", { name: /Instruments by session/ })).toBeInTheDocument();
    expect(screen.getByTestId("instrument-highlights")).toHaveTextContent("EURUSD · London");
    expect(screen.getByRole("heading", { name: /When you trade best/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /P\/L by trading day/ })).toBeInTheDocument();
  });
});

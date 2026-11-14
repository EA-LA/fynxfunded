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

  it("narrows the analysis to the last 7 or 30 days", async () => {
    const day = 86_400_000, now = Date.now();
    const at = (t: Trade, daysAgo: number): Trade => ({ ...t, openTime: new Date(now - daysAgo * day - 3_600_000).toISOString(), closeTime: new Date(now - daysAgo * day).toISOString() });
    mocks.trades = [at(trade("1", "EURUSD", 100), 1), at(trade("2", "EURUSD", 40), 12), at(trade("3", "XAUUSD", -20), 60)];
    render(<MemoryRouter initialEntries={["/dashboard/accounts/ch-1"]}><Routes><Route path="/dashboard/accounts/:challengeId" element={<AccountWorkspace />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Analysis/ }));
    expect(screen.getByTestId("analysis-range-status")).toHaveTextContent("showing 3 of 3 closed trades");
    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    expect(screen.getByTestId("analysis-range-status")).toHaveTextContent("Last 30 calendar days · showing 2 of 3 closed trades");
    fireEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(screen.getByTestId("analysis-range-status")).toHaveTextContent("showing 1 of 3 closed trades");
    expect(screen.getByText(/In this period this account has 1 closed trade with a/)).toBeInTheDocument();
  });

  it("explains the MetriX labels and shows a profit factor without losses in plain words", async () => {
    mocks.trades = [trade("1", "EURUSD", 100), trade("2", "XAUUSD", 40)];
    render(<MemoryRouter initialEntries={["/dashboard/accounts/ch-1"]}><Routes><Route path="/dashboard/accounts/:challengeId" element={<AccountWorkspace />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Account MetriX/ }));
    expect(screen.getByText("No losses yet")).toBeInTheDocument();
    expect(screen.queryByText("Infinity")).not.toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument(); // drawdown, never shown as "+$"
    expect(screen.getByText("Average loss").parentElement).toHaveTextContent("—");
    for (const term of ["win rate", "profit factor", "risk-reward ratio", "expectancy", "trading sessions"]) {
      expect(screen.getAllByRole("button", { name: `What does "${term}" mean?` }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getAllByRole("button", { name: 'What does "profit factor" mean?' })[0]);
    expect(await screen.findByText(/Everything your winning trades made divided by everything your losing trades lost/)).toBeInTheDocument();
  });
});

describe("account workspace long / short comparison", () => {
  it("shows win rate, wins/losses and average per side with help", async () => {
    const sell = (t: Trade): Trade => ({ ...t, type: "Sell" });
    mocks.trades = [trade("1", "EURUSD", 100), trade("2", "EURUSD", -40), trade("3", "EURUSD", 60), sell(trade("4", "EURUSD", -20)), sell(trade("5", "EURUSD", -10)), sell(trade("6", "XAUUSD", 30))];
    render(<MemoryRouter initialEntries={["/dashboard/accounts/ch-1"]}><Routes><Route path="/dashboard/accounts/:challengeId" element={<AccountWorkspace />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Analysis/ }));
    const long = screen.getByTestId("side-long");
    expect(long).toHaveTextContent("$120.00");
    expect(long).toHaveTextContent("66.7%");
    expect(long).toHaveTextContent("2 / 1");
    expect(long).toHaveTextContent("$40.00");
    expect(screen.getByTestId("side-short")).toHaveTextContent("33.3%");
    expect(screen.getByTestId("side-note")).toHaveTextContent("Long trades average $40.00 more per trade than short trades.");
    expect(document.querySelector('[data-glossary-term="long-short"]') ?? screen.getByRole("button", { name: /long and short/i })).toBeTruthy();
  });
});

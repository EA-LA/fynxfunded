import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/tradingData";

const mocks = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-trading-data", async () => {
  const actual = await import("@/lib/tradingData");
  return { useTradingData: () => mocks.data, computeAnalytics: actual.computeAnalytics };
});
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, Area: () => null, AreaChart: () => null, Bar: () => null, BarChart: () => null, Cell: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import Analytics from "@/pages/dashboard/Analytics";

const trade = (id: string, type: "Buy" | "Sell", pnl: number, accountId = "a"): Trade => ({
  id, accountId, challengeId: "c", symbol: "EURUSD", type, openTime: "2026-11-02T09:00:00.000Z", closeTime: "2026-11-02T10:00:00.000Z", lots: 1, pnl, pips: 0,
  duration: "1h 0m", riskPercent: 0.5, rr: 2, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
});

afterEach(cleanup);

describe("dashboard Analytics long/short comparison", () => {
  beforeEach(() => {
    mocks.data = {
      loading: false, error: "", brokerConnected: false, accountName: "All accounts", hasTrades: true,
      trades: [trade("1", "Buy", 100), trade("2", "Buy", 50, "b"), trade("3", "Buy", -30), trade("4", "Sell", -40, "b"), trade("5", "Sell", 20), trade("6", "Sell", -10)],
    };
  });

  it("compares Buy and Sell trades across the recorded trades", () => {
    render(<MemoryRouter><Analytics /></MemoryRouter>);
    const card = screen.getByTestId("long-short-card");
    expect(within(card).getByRole("heading", { name: /Long \/ short comparison/ })).toBeInTheDocument();
    const long = within(card).getByTestId("side-long");
    expect(long).toHaveTextContent("$120.00");
    expect(long).toHaveTextContent("3 · 50%");
    expect(long).toHaveTextContent("66.7%");
    expect(long).toHaveTextContent("2 / 1");
    expect(within(card).getByTestId("side-short")).toHaveTextContent("-$30.00");
    // Long average $40, short average -$10.
    expect(within(card).getByTestId("side-note")).toHaveTextContent("Long trades average $50.00 more per trade than short trades.");
  });

  it("waits for three trades on each side before comparing", () => {
    mocks.data = { ...mocks.data, trades: [trade("1", "Buy", 100), trade("2", "Sell", -20)] };
    render(<MemoryRouter><Analytics /></MemoryRouter>);
    expect(screen.getByTestId("side-note")).toHaveTextContent("A comparison appears once each side has at least 3 closed trades.");
  });
});

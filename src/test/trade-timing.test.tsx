import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/tradingData";
import {
  TIME_ZONE_STORAGE_KEY, formatTradeTime, performanceByHour, performanceByWeekday, pnlByTradingDay, readTimeZoneMode,
  saveTimeZoneMode, summarizeTradingDays, timingHighlights,
} from "@/lib/tradeTiming";

const mocks = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-trading-data", async () => {
  const actual = await import("@/lib/tradingData");
  return { useTradingData: () => mocks.data, computeAnalytics: actual.computeAnalytics };
});
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, Area: () => null, AreaChart: () => null, Bar: () => null, BarChart: () => null, Cell: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import Analytics from "@/pages/dashboard/Analytics";
import Trades from "@/pages/dashboard/Trades";

const trade = (id: string, openTime: string, closeTime: string, pnl: number): Trade => ({
  id, accountId: "a", challengeId: "c", symbol: "EURUSD", type: "Buy", openTime, closeTime, lots: 1, pnl, pips: 0, duration: "1h 0m",
  riskPercent: 0.5, rr: 2, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
});

// Mon 2 Nov 2026 and Tue 3 Nov 2026 (UTC).
const trades: Trade[] = [
  trade("m1", "2026-11-02T09:00:00.000Z", "2026-11-02T10:00:00.000Z", 100),
  trade("m2", "2026-11-02T09:30:00.000Z", "2026-11-02T11:00:00.000Z", 50),
  trade("m3", "2026-11-02T14:00:00.000Z", "2026-11-02T15:00:00.000Z", -30),
  trade("t1", "2026-11-03T14:00:00.000Z", "2026-11-03T15:00:00.000Z", -40),
  trade("t2", "2026-11-03T14:10:00.000Z", "2026-11-03T15:30:00.000Z", -20),
  trade("t3", "2026-11-03T14:20:00.000Z", "2026-11-03T21:30:00.000Z", 10),
  // Closes after the 22:00 UTC reset on Tuesday, so it belongs to Wednesday's trading day.
  trade("w1", "2026-11-03T22:30:00.000Z", "2026-11-03T23:00:00.000Z", 25),
];

afterEach(() => { cleanup(); localStorage.clear(); });

describe("trade timing helpers", () => {
  it("groups trades by weekday and hour in UTC", () => {
    const days = performanceByWeekday(trades, "utc");
    expect(days.map(d => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days[0]).toMatchObject({ count: 3, wins: 2, losses: 1, pnl: 120, winRate: 66.67 });
    expect(days[1]).toMatchObject({ count: 4, pnl: -25 });
    const hours = performanceByHour(trades, "utc");
    expect(hours).toHaveLength(24);
    expect(hours[9]).toMatchObject({ label: "09:00", count: 2, pnl: 150 });
    expect(hours[14]).toMatchObject({ count: 4, pnl: -80 });
    expect(hours[22]).toMatchObject({ count: 1, pnl: 25 });
  });

  it("only calls out buckets with enough trades", () => {
    const h = timingHighlights(performanceByWeekday(trades, "utc"));
    expect(h.best?.label).toBe("Mon");
    expect(h.worst?.label).toBe("Tue");
    const thin = timingHighlights(performanceByWeekday(trades.slice(0, 2), "utc"));
    expect(thin).toEqual({ best: null, worst: null, smallSample: true });
  });

  it("splits trading days at the 22:00 UTC reset and summarises them", () => {
    const days = pnlByTradingDay(trades);
    expect(days.map(d => [d.date, d.count, d.pnl])).toEqual([["2026-11-02", 3, 120], ["2026-11-03", 3, -50], ["2026-11-04", 1, 25]]);
    const s = summarizeTradingDays(days);
    expect(s).toMatchObject({ days: 3, greenDays: 2, redDays: 1, flatDays: 0, averageDay: 31.67 });
    expect(s.bestDay?.date).toBe("2026-11-02");
    expect(s.worstDay?.date).toBe("2026-11-03");
    // Best day 120 of 95 total profit: above the 40% limit.
    expect(s.consistency.sharePercent).toBeCloseTo(126.32, 2);
    expect(s.consistency.passes).toBe(false);
  });

  it("formats times in UTC and handles missing values", () => {
    expect(formatTradeTime("2026-11-02T09:05:00.000Z", "utc")).toMatch(/09:05/);
    expect(formatTradeTime("", "local")).toBe("—");
    expect(formatTradeTime("not a date", "utc")).toBe("—");
  });

  it("remembers the time zone choice", () => {
    expect(readTimeZoneMode()).toBe("local");
    saveTimeZoneMode("utc");
    expect(localStorage.getItem(TIME_ZONE_STORAGE_KEY)).toBe("utc");
    expect(readTimeZoneMode()).toBe("utc");
  });
});

describe("analytics and trades pages", () => {
  beforeEach(() => { mocks.data = { loading: false, error: "", brokerConnected: false, accountName: "Account A", hasTrades: true, trades }; });

  it("shows trade quality, timing and trading-day sections on Analytics", () => {
    render(<MemoryRouter><Analytics /></MemoryRouter>);
    const quality = screen.getByTestId("trade-quality");
    expect(within(quality).getByText("Longest losing streak")).toBeInTheDocument();
    expect(within(quality).getByText("-$30.00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /When you trade best/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "UTC" }));
    expect(screen.getByTestId("timing-highlights")).toHaveTextContent("Mon: +$120.00 over 3 trades (67% won)");
    expect(screen.getByTestId("timing-highlights")).toHaveTextContent("Tue: -$25.00 over 4 trades");
    fireEvent.click(screen.getByRole("button", { name: "By hour" }));
    expect(screen.getByTestId("timing-highlights")).toHaveTextContent("14:00–15:00: -$80.00 over 4 trades");
    expect(screen.getByTestId("trading-day-stats")).toHaveTextContent("2 up · 1 down · 0 flat");
    expect(screen.getByTestId("consistency-estimate")).toHaveTextContent("126.3% · above 40%");
    expect(screen.getByRole("link", { name: "Objectives" })).toHaveAttribute("href", "/dashboard/objectives");
    expect(localStorage.getItem(TIME_ZONE_STORAGE_KEY)).toBe("utc");
  });

  it("shows readable trade times on Trades and switches to UTC", () => {
    render(<MemoryRouter><Trades /></MemoryRouter>);
    expect(screen.queryByText("2026-11-02T09:00:00.000Z")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "UTC" }));
    expect(screen.getByRole("columnheader", { name: /Open \(UTC\)/ })).toBeInTheDocument();
    const cell = document.querySelector('time[datetime="2026-11-02T09:00:00.000Z"]');
    expect(cell?.textContent).toMatch(/09:00/);
  });
});

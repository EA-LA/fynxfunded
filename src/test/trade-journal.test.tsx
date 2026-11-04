import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/tradingData";
import { DEFAULT_SORT, EMPTY_FILTERS, filterTrades, hasActiveFilters, nextSort, sortTrades, summarizeTrades } from "@/lib/tradeJournal";

const mocks = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-trading-data", () => ({ useTradingData: () => mocks.data }));
import Trades from "@/pages/dashboard/Trades";

const trade = (over: Partial<Trade>): Trade => ({
  id: "t", accountId: "a", challengeId: "c", symbol: "EURUSD", type: "Buy", openTime: "2026-11-02T09:00:00.000Z", closeTime: "2026-11-02T10:00:00.000Z",
  lots: 1, pnl: 0, pips: 0, duration: "1h 0m", riskPercent: 0.5, rr: 2, session: "London", result: "Breakeven", ...over,
});
const trades: Trade[] = [
  trade({ id: "t1", symbol: "EURUSD", type: "Buy", pnl: 120, pips: 12, lots: 1, closeTime: "2026-11-03T10:00:00.000Z", result: "Win", session: "London" }),
  trade({ id: "t2", symbol: "GBPUSD", type: "Sell", pnl: -80, pips: -8, lots: 0.5, closeTime: "2026-11-02T15:00:00.000Z", result: "Loss", session: "New York" }),
  trade({ id: "t3", symbol: "XAUUSD", type: "Buy", pnl: 0, lots: 2, closeTime: "2026-11-01T03:00:00.000Z", result: "Breakeven", session: "Asia" }),
  trade({ id: "t4", symbol: "EURGBP", type: "Sell", pnl: 40, pips: 4, lots: 0.25, closeTime: "2026-11-04T11:00:00.000Z", result: "Win", session: "London" }),
];

afterEach(cleanup);
beforeEach(() => { mocks.data = { loading: false, error: "", brokerConnected: false, accountName: "Account A", hasTrades: true, trades }; });

describe("trade journal helpers", () => {
  it("filters by symbol, result, side and session", () => {
    expect(filterTrades(trades, { ...EMPTY_FILTERS, symbol: " eur " }).map(t => t.id)).toEqual(["t1", "t4"]);
    expect(filterTrades(trades, { ...EMPTY_FILTERS, result: "Breakeven" }).map(t => t.id)).toEqual(["t3"]);
    expect(filterTrades(trades, { ...EMPTY_FILTERS, side: "Sell", session: "London" }).map(t => t.id)).toEqual(["t4"]);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, symbol: "  " })).toBe(false);
  });

  it("sorts newest first by default and by any numeric or text column", () => {
    expect(sortTrades(trades, DEFAULT_SORT).map(t => t.id)).toEqual(["t4", "t1", "t2", "t3"]);
    expect(sortTrades(trades, { key: "pnl", dir: "desc" }).map(t => t.id)).toEqual(["t1", "t4", "t3", "t2"]);
    expect(sortTrades(trades, { key: "symbol", dir: "asc" }).map(t => t.symbol)).toEqual(["EURGBP", "EURUSD", "GBPUSD", "XAUUSD"]);
    expect(nextSort({ key: "pnl", dir: "desc" }, "pnl")).toEqual({ key: "pnl", dir: "asc" });
    expect(nextSort({ key: "pnl", dir: "desc" }, "symbol")).toEqual({ key: "symbol", dir: "asc" });
    expect(nextSort(DEFAULT_SORT, "lots")).toEqual({ key: "lots", dir: "desc" });
  });

  it("summarises wins, losses and averages", () => {
    expect(summarizeTrades(trades)).toEqual({
      count: 4, netPnl: 80, winRate: 50, volume: 3.75, wins: 2, losses: 1, breakeven: 1,
      averageWin: 80, averageLoss: -80, largestWin: 120, largestLoss: -80,
    });
    expect(summarizeTrades([])).toMatchObject({ count: 0, winRate: 0, averageWin: 0, averageLoss: 0 });
  });
});

describe("trades page", () => {
  const rows = () => screen.getAllByRole("row").slice(1);

  it("can show breakeven trades and updates the totals for the filter", () => {
    render(<MemoryRouter><Trades /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Filter by result"), { target: { value: "Breakeven" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Clear filters/ })[0]);
    expect(rows()).toHaveLength(4);
  });

  it("filters by side and session together", () => {
    render(<MemoryRouter><Trades /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Filter by side"), { target: { value: "Sell" } });
    fireEvent.change(screen.getByLabelText("Filter by session"), { target: { value: "New York" } });
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("GBPUSD")).toBeInTheDocument();
    expect(within(rows()[0]).getByText("-$80.00")).toBeInTheDocument();
  });

  it("sorts when a column header is clicked and announces the order", () => {
    render(<MemoryRouter><Trades /></MemoryRouter>);
    const pnl = screen.getByRole("button", { name: "P/L" });
    fireEvent.click(pnl);
    expect(pnl.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(within(rows()[0]).getByText("EURUSD")).toBeInTheDocument();
    fireEvent.click(pnl);
    expect(pnl.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(within(rows()[0]).getByText("GBPUSD")).toBeInTheDocument();
  });

  it("shows a clear-filters action when nothing matches", () => {
    render(<MemoryRouter><Trades /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Filter by symbol"), { target: { value: "BTC" } });
    expect(screen.getByText("No trades match these filters")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Clear filters/ })).toHaveLength(2);
  });
});

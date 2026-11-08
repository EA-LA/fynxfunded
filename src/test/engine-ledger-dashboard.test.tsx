import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dealToTradeRecord, tradeRecordId } from "@/engine/ledger";
import { mapClosedTrade } from "@/lib/tradingData";

const mocks = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-trading-data", () => ({ useTradingData: () => mocks.data }));
import Trades from "@/pages/dashboard/Trades";

const T0 = Date.parse("2026-11-04T10:00:00Z");
afterEach(cleanup);

describe("FYNX Trade deals on /dashboard/trades", () => {
  it("shows the platform and how each trade was closed", () => {
    const deals = [
      { id: "pos_a:1", reason: "stop_loss" as const, netProfit: -127, grossProfit: -120, exitPrice: 1.0788 },
      { id: "pos_b:1", reason: "take_profit" as const, netProfit: 243, grossProfit: 250, exitPrice: 1.0825 },
    ];
    const trades = deals.map(d => {
      const record = dealToTradeRecord("acc_1", { positionId: "p", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, openedAt: T0, closedAt: T0 + 3_600_000, commission: 7, ...d }, { userId: "u1" }, 0.0001, T0);
      return mapClosedTrade(tradeRecordId("acc_1", d.id), record)!;
    });
    expect(trades.map(t => [t.closedBy, t.platform])).toEqual([["Stop loss", "FYNX Trade"], ["Take profit", "FYNX Trade"]]);
    // Records from other sources stay as they were.
    expect(mapClosedTrade("x", { closeTime: "2026-11-04T11:00:00Z", netProfit: 5, closeReason: "unknown" })).not.toHaveProperty("closedBy");
    mocks.data = { loading: false, error: "", brokerConnected: false, accountName: "Account A", hasTrades: true, trades };
    render(<MemoryRouter><Trades /></MemoryRouter>);
    expect(screen.getAllByText("FYNX Trade")).toHaveLength(2);
    expect(screen.getByText("Stop loss")).toBeInTheDocument();
    expect(screen.getByText("Take profit")).toBeInTheDocument();
  });
});

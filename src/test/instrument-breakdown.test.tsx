import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { Trade } from "@/lib/tradingData";
import { breakdownHighlights, instrumentBreakdown, sessionTotals } from "@/lib/instrumentBreakdown";
import InstrumentSessionCard from "@/components/analytics/InstrumentSessionCard";
import { dailyResetIcs } from "@/lib/tradingDayClock";
import TradingDayClock from "@/components/TradingDayClock";

afterEach(cleanup);

let n = 0;
const trade = (symbol: string, session: Trade["session"], pnl: number, type: Trade["type"] = "Buy"): Trade => ({
  id: `t${++n}`, accountId: "a", challengeId: "c", symbol, type, openTime: "2026-11-02T09:00:00.000Z", closeTime: "2026-11-02T10:00:00.000Z",
  lots: 1, pnl, pips: 0, duration: "1h", riskPercent: 0.5, rr: 2, session, result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
});

const trades: Trade[] = [
  trade("EURUSD", "London", 100), trade("EURUSD", "London", 50), trade("EURUSD", "London", -20, "Sell"),
  trade("EURUSD", "New York", -10),
  trade("XAUUSD", "New York", -40), trade("XAUUSD", "New York", -30), trade("XAUUSD", "New York", 5),
  trade("GBPUSD", "Asia", 200),
];

describe("instrument × session breakdown", () => {
  it("totals each instrument and splits it by session", () => {
    const rows = instrumentBreakdown(trades);
    expect(rows.map(r => r.symbol)).toEqual(["GBPUSD", "EURUSD", "XAUUSD"]);
    const eur = rows.find(r => r.symbol === "EURUSD")!;
    expect(eur).toMatchObject({ count: 4, pnl: 120, wins: 2, losses: 2, winRate: 50, average: 30, best: 100, worst: -20, longs: 3, shorts: 1 });
    expect(eur.sessions.London).toMatchObject({ count: 3, pnl: 130, wins: 2 });
    expect(eur.sessions["New York"]).toMatchObject({ count: 1, pnl: -10 });
    expect(eur.sessions.Asia.count).toBe(0);
    expect(instrumentBreakdown(trades, "count")[0].symbol).toBe("EURUSD");
    expect(instrumentBreakdown(trades, "symbol").map(r => r.symbol)).toEqual(["EURUSD", "GBPUSD", "XAUUSD"]);
    expect(instrumentBreakdown(trades, "winRate")[0].symbol).toBe("GBPUSD");
    const totals = sessionTotals(rows);
    expect(totals["New York"]).toMatchObject({ count: 4, pnl: -75 });
    expect(totals.Asia.pnl).toBe(200);
  });

  it("only highlights combinations with at least 3 trades", () => {
    const { strongest, weakest } = breakdownHighlights(instrumentBreakdown(trades));
    // GBPUSD Asia has the biggest profit but only one trade, so it is skipped.
    expect(strongest).toMatchObject({ symbol: "EURUSD", session: "London" });
    expect(weakest).toMatchObject({ symbol: "XAUUSD", session: "New York" });
    expect(breakdownHighlights(instrumentBreakdown(trades.slice(0, 2)))).toEqual({ strongest: null, weakest: null });
  });

  it("renders the table, highlights and an empty state", () => {
    render(<MemoryRouter><InstrumentSessionCard trades={trades} /></MemoryRouter>);
    const card = screen.getByTestId("instrument-session");
    expect(within(screen.getByTestId("instrument-highlights")).getByText("EURUSD · London")).toBeInTheDocument();
    const eurRow = within(card).getByRole("rowheader", { name: /EURUSD/ }).closest("tr")!;
    expect(within(eurRow).getByText("+$120.00")).toBeInTheDocument();
    expect(within(eurRow).getByText("+$130.00")).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText("Sort by"), { target: { value: "symbol" } });
    expect(within(card).getAllByRole("rowheader")[0]).toHaveTextContent("EURUSD");
    cleanup();
    render(<MemoryRouter><InstrumentSessionCard trades={[]} /></MemoryRouter>);
    expect(screen.getByText(/once closed trades are recorded/)).toBeInTheDocument();
  });

  it("collapses long instrument lists", () => {
    const many = Array.from({ length: 10 }, (_, i) => trade(`SYM${i}`, "London", i + 1));
    render(<MemoryRouter><InstrumentSessionCard trades={many} /></MemoryRouter>);
    const card = screen.getByTestId("instrument-session");
    expect(within(card).getAllByRole("rowheader")).toHaveLength(9); // 8 rows + totals
    fireEvent.click(within(card).getByRole("button", { name: "Show all 10 instruments" }));
    expect(within(card).getAllByRole("rowheader")).toHaveLength(11);
  });
});

describe("daily reset calendar file", () => {
  it("repeats every day at 22:00 UTC with an optional reminder", () => {
    const ics = dailyResetIcs(new Date("2026-11-05T23:10:00Z"), 15);
    expect(ics).toContain("DTSTART:20261106T220000Z");
    expect(ics).toContain("DTEND:20261106T221500Z");
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics.split("\r\n").every(l => l.length <= 75)).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(dailyResetIcs(new Date("2026-11-05T10:00:00Z"), 0)).not.toContain("VALARM");
    expect(dailyResetIcs(new Date("2026-11-05T10:00:00Z"))).toContain("DTSTART:20261105T220000Z");
  });

  it("offers the download on the trading-day clock", () => {
    render(<MemoryRouter><TradingDayClock now={new Date("2026-11-04T16:00:00Z")} /></MemoryRouter>);
    const box = screen.getByTestId("reset-calendar");
    expect(within(box).getByRole("button", { name: /Add the daily reset to my calendar/ })).toBeInTheDocument();
    expect(within(box).getByLabelText("Reminder")).toHaveValue("15");
  });
});

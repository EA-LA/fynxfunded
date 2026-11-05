import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { Trade } from "@/lib/tradingData";
import { fitRewardRatio, journalPlan, journalRiskAmount, nearestTradesPerDay } from "@/lib/journalSimulator";
import JournalSimulatorCard from "@/components/analytics/JournalSimulatorCard";

afterEach(cleanup);

let n = 0;
// Trading days run 22:00–22:00 UTC; noon UTC on consecutive dates are separate days.
const trade = (day: number, pnl: number): Trade => {
  const close = `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
  return {
    id: `j${++n}`, accountId: "a", challengeId: "c", symbol: "EURUSD", type: "Buy", openTime: close, closeTime: close,
    lots: 1, pnl, pips: 0, duration: "0m", riskPercent: 0, rr: 0, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
  };
};

// 6 days × 2 trades: 5 wins of $150, 7 losses of $100, plus 1 breakeven.
const record: Trade[] = [
  ...[1, 2, 3, 4, 5].map((d) => trade(d, 150)),
  ...[1, 2, 3, 4, 5, 6, 6].map((d) => trade(d, -100)),
  trade(6, 0),
];

describe("journal plan", () => {
  it("summarises a record into simulator inputs", () => {
    const plan = journalPlan(record, 50000);
    expect(plan).toMatchObject({
      ready: true, trades: 13, wins: 5, losses: 7, breakeven: 1, avgWin: 150, avgLoss: 100, payoff: 1.5,
      rewardRatio: 1.5, rewardFit: "exact", riskPercent: 0.2, tradingDays: 6, tradesPerDayActual: 2, tradesPerDay: 2,
    });
    expect(plan.winRate).toBeCloseTo(41.67, 2);
    expect(journalRiskAmount(plan, 100000)).toBe(200);
    expect(journalRiskAmount({ ...plan, riskPercent: null }, 100000)).toBe(100);
  });

  it("never rounds the reward up", () => {
    expect(fitRewardRatio(2.9)).toEqual({ rewardRatio: 2, rewardFit: "roundedDown" });
    expect(fitRewardRatio(3.4)).toEqual({ rewardRatio: 3, rewardFit: "roundedDown" });
    expect(fitRewardRatio(0.7)).toEqual({ rewardRatio: 1, rewardFit: "flattering" });
    expect(fitRewardRatio(1)).toEqual({ rewardRatio: 1, rewardFit: "exact" });
  });

  it("picks the nearest trades-per-day option", () => {
    expect(nearestTradesPerDay(0.4)).toBe(1);
    expect(nearestTradesPerDay(2.5)).toBe(2);
    expect(nearestTradesPerDay(4.2)).toBe(5);
    expect(nearestTradesPerDay(30)).toBe(8);
  });

  it("refuses small or one-sided records", () => {
    expect(journalPlan(record.slice(0, 4), 50000)).toMatchObject({ ready: false });
    expect(journalPlan(record.slice(0, 4), 50000).reason).toContain("at least 10");
    const allWins = Array.from({ length: 12 }, (_, i) => trade(i + 1, 50));
    expect(journalPlan(allWins, 50000).reason).toContain("one winning and one losing");
  });
});

describe("JournalSimulatorCard", () => {
  const renderCard = (trades: Trade[], size = 50000, program?: string) =>
    render(<MemoryRouter><JournalSimulatorCard trades={trades} accountSize={size} periodLabel="all recorded history" program={program} /></MemoryRouter>);

  it("shows the record, a pass rate and a link to the full simulator", () => {
    renderCard(record);
    const card = screen.getByTestId("journal-simulator");
    const inputs = within(card).getByTestId("journal-sim-inputs");
    expect(inputs).toHaveTextContent("41.7%");
    expect(inputs).toHaveTextContent("5 wins · 7 losses · 1 breakeven left out");
    expect(inputs).toHaveTextContent("$100");
    expect(inputs).toHaveTextContent("simulated as 1:1.5");
    expect(within(card).getByTestId("journal-sim-pass").textContent).toMatch(/^\d+(\.\d)?%$/);
    // A small edge per trade at 0.2% risk mostly runs out of time rather than breaching.
    expect(within(card).getByTestId("journal-sim-slow")).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: /Open this in the pass simulator/ });
    const href = link.getAttribute("href")!;
    expect(href).toContain("/rules?size=50000&program=2-phase");
    expect(href).toContain("risk=0.2");
    expect(href).toContain("rr=1.5");
    expect(href).toContain("wr=41.67");
    expect(href).toContain("tpd=2");
    expect(href.endsWith("#simulator")).toBe(true);
  });

  it("starts on the account's program and lets the trader change size and phases", () => {
    renderCard(record, 50000, "3-phase");
    expect(screen.getByRole("button", { name: "3-phase" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "All 3 phases" }));
    expect(screen.getByRole("link", { name: /Open this in the pass simulator/ }).getAttribute("href")).toContain("sphase=all");
    fireEvent.change(screen.getByLabelText("Account size"), { target: { value: "100000" } });
    expect(screen.getByTestId("journal-sim-inputs")).toHaveTextContent("$200");
    expect(screen.getByRole("link", { name: /Open this in the pass simulator/ }).getAttribute("href")).toContain("size=100000");
  });

  it("warns instead of simulating when one average loss is bigger than the daily allowance", () => {
    const big = record.map((t) => ({ ...t, pnl: t.pnl * 40 }));
    renderCard(big, 50000);
    fireEvent.change(screen.getByLabelText("Account size"), { target: { value: "5000" } });
    expect(screen.getByRole("alert")).toHaveTextContent("bigger than the whole daily loss allowance");
    expect(screen.queryByTestId("journal-sim-pass")).toBeNull();
  });

  it("explains what is needed when the record is too small", () => {
    renderCard(record.slice(0, 3));
    expect(screen.getByText(/at least 10 winning or losing closed trades/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Try the simulator with numbers you type in/ })).toHaveAttribute("href", "/rules#simulator");
  });
});

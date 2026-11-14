import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { Trade } from "@/lib/tradingData";
import { getRulePlan } from "@/lib/ruleCalculator";
import { journalReplayTrades, replayRecord } from "@/lib/recordReplay";
import JournalReplayCard from "@/components/analytics/JournalReplayCard";

afterEach(cleanup);

let n = 0;
const trade = (closeTime: string, pnl: number): Trade => ({
  id: `r${++n}`, accountId: "a", challengeId: "c", symbol: "EURUSD", type: "Buy", openTime: closeTime, closeTime,
  lots: 1, pnl, pips: 0, duration: "0m", riskPercent: 0, rr: 0, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
});
const noon = (day: number, pnl: number) => trade(`2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`, pnl);

// Journals list newest first; six steady +$400 days on a $25,000 account.
const steady = [6, 5, 4, 3, 2, 1].map((d) => noon(d, 400));

describe("journal replay record", () => {
  it("puts the journal oldest first and keeps net results as they are", () => {
    const { trades, undated, scale } = journalReplayTrades(steady, 25000, 25000);
    expect(scale).toBe(1);
    expect(undated).toBe(0);
    expect(trades.map((t) => t.time)).toEqual([1, 2, 3, 4, 5, 6].map((d) => Date.UTC(2026, 9, d, 12)));
    expect(trades.every((t) => t.value === 400)).toBe(true);
  });

  it("resizes to the chosen account and leaves out trades without a close time", () => {
    const { trades, undated, scale } = journalReplayTrades([noon(1, 801), trade("", 50), { ...noon(2, 10), pnl: Number.NaN }], 50000, 25000);
    expect(scale).toBe(0.5);
    expect(undated).toBe(2);
    expect(trades).toEqual([{ time: Date.UTC(2026, 9, 1, 12), value: 400.5 }]);
  });

  it("replays the real order against the schedule: pass on the fifth day", () => {
    const plan = getRulePlan(25000, "2-phase");
    const result = replayRecord({ plan, phase: 1, trades: journalReplayTrades(steady, 25000, 25000).trades, tradesPerDay: 1, costPerTrade: 0 });
    expect(result.outcome).toBe("passed");
    expect(result.finalDay).toMatchObject({ date: "2026-10-05", phaseDay: 5, endBalance: 27000 });
    expect(result.tradesUsed).toBe(5);
  });

  it("groups a trade closed after 22:00 UTC into the next trading day", () => {
    const plan = getRulePlan(25000, "2-phase");
    const record = [trade("2026-10-02T12:00:00.000Z", -700), trade("2026-10-01T22:30:00.000Z", -700)];
    const result = replayRecord({ plan, phase: 1, trades: journalReplayTrades(record, 25000, 25000).trades, tradesPerDay: 1, costPerTrade: 0 });
    // Both losses fall in the trading day that starts Oct 1 22:00 UTC: -$1,400 breaks the $1,250 daily limit.
    expect(result.outcome).toBe("dailyBreach");
    expect(result.days).toHaveLength(1);
    expect(result.finalDay).toMatchObject({ date: "2026-10-02", trades: 2 });
  });
});

describe("JournalReplayCard", () => {
  const renderCard = (trades: Trade[], accountSize = 25000, program?: string) =>
    render(
      <MemoryRouter>
        <JournalReplayCard trades={trades} accountSize={accountSize} program={program} periodLabel="all time" />
      </MemoryRouter>,
    );

  it("shows the day the journal would have passed, with the trading days listed", () => {
    renderCard(steady, 25000, "2-phase");
    const card = screen.getByTestId("journal-replay");
    expect(within(card).getByTestId("replay-verdict")).toHaveTextContent("Your journal would have passed phase 1");
    expect(within(card).getByTestId("replay-verdict")).toHaveTextContent("Mon, Oct 5, 2026");
    expect(within(card).getByTestId("journal-replay-read")).toHaveTextContent("6 closed trades, Thu, Oct 1, 2026 to Tue, Oct 6, 2026");
    expect(within(within(card).getByTestId("replay-days")).getAllByRole("row")).toHaveLength(6); // header + 5 days
    expect(within(card).getByRole("link", { name: /See your real objectives/ })).toHaveAttribute("href", "/dashboard/objectives");
    expect(within(card).getByRole("link", { name: /broker export/ })).toHaveAttribute("href", "/rules?size=25000&program=2-phase#replay");
  });

  it("runs all phases in a row when asked", () => {
    renderCard(steady, 25000, "2-phase");
    fireEvent.click(screen.getByRole("button", { name: "All phases in a row" }));
    const verdict = screen.getByTestId("replay-verdict");
    expect(verdict).toHaveTextContent("Not passed yet: the record ran out during phase 2");
    expect(verdict).toHaveTextContent("1 phase passed first");
    expect(screen.getByRole("link", { name: /broker export/ })).toHaveAttribute("href", "/rules?size=25000&program=2-phase&rphase=all#replay");
  });

  it("resizes the record when another account size is chosen", () => {
    renderCard(steady, 25000, "2-phase");
    fireEvent.change(screen.getByTestId("journal-replay-size"), { target: { value: "50000" } });
    expect(screen.getByTestId("journal-replay-read")).toHaveTextContent("each resized ×2 from your $25,000 account to the same share of $50,000");
    expect(screen.getByTestId("replay-verdict")).toHaveTextContent("Your journal would have passed phase 1");
  });

  it("shows a breach plainly", () => {
    renderCard([noon(2, -1100), noon(1, -400)], 25000, "1-phase");
    expect(screen.getByTestId("replay-verdict")).toHaveTextContent("The daily loss limit would have been broken on Fri, Oct 2, 2026");
  });

  it("has a helpful empty state", () => {
    renderCard([]);
    expect(screen.getByTestId("journal-replay-empty")).toHaveTextContent("No closed trades in this period yet");
    expect(screen.queryByTestId("replay-verdict")).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import RecordReplay from "@/components/RecordReplay";
import { getRulePlan } from "@/lib/ruleCalculator";
import {
  EXAMPLE_DATED_RESULTS,
  groupTradingDays,
  offsetLabel,
  parseDatedTradeResults,
  parseTradeTime,
  pickTimeColumn,
  replayRecord,
  type ReplayTrade,
} from "@/lib/recordReplay";

afterEach(cleanup);

const undated = (...values: number[]): ReplayTrade[] => values.map((value) => ({ time: null, value }));

describe("reading trade times", () => {
  it("reads year-first dates and times as UTC by default", () => {
    expect(parseTradeTime("2026-10-05 14:30")).toBe(Date.UTC(2026, 9, 5, 14, 30));
    expect(parseTradeTime("2026.10.05 14:30:05")).toBe(Date.UTC(2026, 9, 5, 14, 30, 5));
    expect(parseTradeTime("2026/10/05")).toBe(Date.UTC(2026, 9, 5, 12));
    expect(parseTradeTime("2026-10-05T14:30:00.123Z")).toBe(Date.UTC(2026, 9, 5, 14, 30));
  });

  it("applies the chosen offset unless the time names its own zone", () => {
    expect(parseTradeTime("2026-10-05 23:30", 120)).toBe(Date.UTC(2026, 9, 5, 21, 30));
    expect(parseTradeTime("2026-10-05 23:30 UTC", 120)).toBe(Date.UTC(2026, 9, 5, 23, 30));
    expect(parseTradeTime("2026-10-05T23:30:00+03:00", 120)).toBe(Date.UTC(2026, 9, 5, 20, 30));
    expect(parseTradeTime("2026-10-05T01:00-0500")).toBe(Date.UTC(2026, 9, 5, 6, 0));
  });

  it("rejects dates that don't exist or aren't year-first", () => {
    expect(parseTradeTime("2026-02-30 10:00")).toBeNull();
    expect(parseTradeTime("2026-13-01")).toBeNull();
    expect(parseTradeTime("05/10/2026 10:00")).toBeNull();
    expect(parseTradeTime("2026-10-05 25:00")).toBeNull();
    expect(parseTradeTime("yesterday")).toBeNull();
  });

  it("prefers a close-time column, and the last plain Time column (MT5 lists open time first)", () => {
    expect(pickTimeColumn(["Open time", "Symbol", "Close time", "Profit"])).toBe(2);
    expect(pickTimeColumn(["Time", "Position", "Symbol", "Time", "Price", "Profit"])).toBe(3);
    expect(pickTimeColumn(["Open Time", "Profit"])).toBe(0);
    expect(pickTimeColumn(["Date (UTC)", "P/L"])).toBe(0);
    expect(pickTimeColumn(["Symbol", "Profit"])).toBe(-1);
  });

  it("labels offsets plainly", () => {
    expect(offsetLabel(0)).toBe("UTC");
    expect(offsetLabel(120)).toBe("UTC+2");
    expect(offsetLabel(-300)).toBe("UTC-5");
    expect(offsetLabel(330)).toBe("UTC+5:30");
  });
});

describe("reading a dated record", () => {
  it("reads a broker CSV by column name and sorts trades oldest first", () => {
    const r = parseDatedTradeResults(
      ["Ticket,Open Time,Close Time,Symbol,Profit", "2,2026-10-06 08:00,2026-10-06 09:00,EURUSD,-80", "1,2026-10-05 08:00,2026-10-05 09:00,EURUSD,\"1,200.50\"", ",,,Total,1120.50"].join("\n"),
    );
    expect(r.error).toBeNull();
    expect(r.dated).toBe(true);
    expect(r.column).toBe("Profit");
    expect(r.timeColumn).toBe("Close Time");
    expect(r.trades).toEqual([
      { time: Date.UTC(2026, 9, 5, 9), value: 1200.5 },
      { time: Date.UTC(2026, 9, 6, 9), value: -80 },
    ]);
    // The "Total" row has no time: it is skipped and shown, not counted.
    expect(r.skipped).toHaveLength(1);
  });

  it("reads header-less 'date, result' lines", () => {
    const r = parseDatedTradeResults("2026-10-05 14:10, 250\n2026-10-06 09:05\t-125\n2026-10-07 10:00 -$60\nnot a trade");
    expect(r.dated).toBe(true);
    expect(r.trades.map((t) => t.value)).toEqual([250, -125, -60]);
    expect(r.skipped).toEqual(["not a trade"]);
  });

  it("falls back to an undated list kept in the order given", () => {
    const r = parseDatedTradeResults("Profit\n120\n-80\n45");
    expect(r.dated).toBe(false);
    expect(r.trades).toEqual(undated(120, -80, 45));
    const noTime = parseDatedTradeResults("Symbol,Profit\nEURUSD,10\nGBPUSD,-5");
    expect(noTime.dated).toBe(false);
    expect(noTime.trades).toEqual(undated(10, -5));
  });

  it("explains when the date column can't be read", () => {
    const r = parseDatedTradeResults("Close time,Profit\n05/10/2026,10\n06/10/2026,-5");
    expect(r.error).toMatch(/year-first dates/);
  });

  it("parses the made-up example", () => {
    const r = parseDatedTradeResults(EXAMPLE_DATED_RESULTS);
    expect(r.error).toBeNull();
    expect(r.trades).toHaveLength(20);
    expect(r.skipped).toEqual([]);
  });
});

describe("grouping into trading days", () => {
  it("splits at the 22:00 UTC reset and names the day after the reset", () => {
    const groups = groupTradingDays(
      [
        { time: Date.UTC(2026, 9, 5, 21, 59), value: 1 },
        { time: Date.UTC(2026, 9, 5, 22, 1), value: 2 },
        { time: Date.UTC(2026, 9, 6, 9, 0), value: 3 },
      ],
      2,
    );
    expect(groups).toEqual([
      { date: "2026-10-05", values: [1] },
      { date: "2026-10-06", values: [2, 3] },
    ]);
  });

  it("uses a fixed number per day when there are no dates", () => {
    expect(groupTradingDays(undated(1, 2, 3, 4, 5), 2).map((g) => g.values)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("replaying a record against the schedule", () => {
  // $10,000 1-phase: 4% daily ($400 from the reset balance), 8% static maximum ($9,200 floor), 10% target, 3 days.
  const plan = getRulePlan(10000, "1-phase");
  const run = (trades: ReplayTrade[], tradesPerDay = 1, costPerTrade = 0) => replayRecord({ plan, phase: 1, trades, tradesPerDay, costPerTrade });

  it("passes on the first day every condition is met", () => {
    const r = run(undated(300, 300, 300, 200, 500));
    expect(r.outcome).toBe("passed");
    expect(r.finalDay?.index).toBe(4);
    expect(r.finalDay?.event).toBe("phasePassed");
    expect(r.tradesUsed).toBe(4);
    expect(r.tradesTotal).toBe(5);
  });

  it("stops at a daily loss breach, trade by trade", () => {
    const r = run(undated(-250, -200, 500), 3);
    expect(r.outcome).toBe("dailyBreach");
    expect(r.tradesUsed).toBe(2);
    expect(r.finalDay).toMatchObject({ floor: 9600, endBalance: 9550, roomAtLow: -50, binding: "daily" });
  });

  it("records a maximum loss breach once the static floor is the higher one", () => {
    const r = run(undated(-350, -350, -150));
    expect(r.outcome).toBe("maxBreach");
    expect(r.finalDay).toMatchObject({ index: 3, floor: 9200, binding: "maximum", endBalance: 9150 });
  });

  it("keeps going when the target is reached before the 40% rule is met", () => {
    const r = run(undated(900, 50, 60));
    expect(r.outcome).toBe("unfinished");
    expect(r.days[2].event).toBe("targetWaiting");
    expect(r.progress).toMatchObject({ profit: 1010, tradingDays: 3, minDays: 3 });
    expect(r.progress?.consistency.passes).toBe(false);
    expect(r.progress?.consistency.profitNeededForBestDay).toBe(2250);
  });

  it("takes charges off every trade", () => {
    const r = run(undated(300, 300, 300, 200), 1, 30);
    expect(r.outcome).toBe("unfinished");
    expect(r.progress?.profit).toBe(980);
  });

  it("restarts each phase from the full account size", () => {
    const two = getRulePlan(10000, "2-phase"); // 8% then 5%, 5 days each
    const trades = undated(...Array(5).fill(200), ...Array(5).fill(120));
    const r = replayRecord({ plan: two, phase: "all", trades, tradesPerDay: 1, costPerTrade: 0 });
    expect(r.outcome).toBe("passed");
    expect(r.phasesPassed).toBe(2);
    expect(r.days[5]).toMatchObject({ phase: 2, phaseDay: 1, startBalance: 10000 });
  });

  it("reports the closest call outside the breach day", () => {
    const r = run(undated(-390, 100, 50));
    expect(r.closestCall?.index).toBe(1);
    expect(r.closestCall?.roomAtLow).toBe(10);
  });
});

describe("Rules page replay section", () => {
  const renderReplay = (path = "/rules#replay") =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <RecordReplay />
      </MemoryRouter>,
    );

  it("replays the made-up example and shows the verdict and every trading day", () => {
    renderReplay("/rules?size=25000&program=2-phase#replay");
    fireEvent.click(screen.getByRole("button", { name: "Try a made-up example record" }));
    expect(screen.getByTestId("replay-read").textContent).toContain("20 trades read");
    expect(screen.getByTestId("replay-verdict").textContent).toContain("Not passed yet");
    expect(screen.getByTestId("replay-verdict").textContent).toContain("$595 more profit");
    const rows = within(screen.getByTestId("replay-days")).getAllByRole("row");
    expect(rows).toHaveLength(12); // header + 11 trading days
  });

  it("shows a breach on a smaller account", () => {
    renderReplay("/rules?size=5000&program=1-phase#replay");
    fireEvent.change(screen.getByLabelText(/Your closed trades/), { target: { value: EXAMPLE_DATED_RESULTS } });
    expect(screen.getByTestId("replay-verdict").textContent).toMatch(/daily loss limit would have been broken on Wed, Oct 7, 2026/);
  });

  it("replays undated results a chosen number per day", () => {
    renderReplay("/rules?size=10000&program=1-phase#replay");
    fireEvent.change(screen.getByLabelText(/Your closed trades/), { target: { value: "300\n300\n300\n200" } });
    expect(screen.getByTestId("replay-read").textContent).toContain("in the order given");
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByTestId("replay-verdict").textContent).toContain("would have passed phase 1");
  });
});

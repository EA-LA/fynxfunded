import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import ChallengeSimulator from "@/components/ChallengeSimulator";
import { getRulePlan } from "@/lib/ruleCalculator";
import { simulateChallenge } from "@/lib/challengeSimulator";
import {
  EXAMPLE_TRADE_RESULTS,
  MAX_TRADE_RESULTS,
  parseMoney,
  parseTradeResults,
  resizeTradeResults,
  splitDelimited,
  summarizeTradeResults,
} from "@/lib/tradeResultsImport";

afterEach(cleanup);

describe("reading pasted trade results", () => {
  it("understands common ways of writing money", () => {
    expect(parseMoney("120")).toBe(120);
    expect(parseMoney("-80.5")).toBe(-80.5);
    expect(parseMoney("+45")).toBe(45);
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("-$80")).toBe(-80);
    expect(parseMoney("$-80")).toBe(-80);
    expect(parseMoney("(80)")).toBe(-80);
    expect(parseMoney("−80")).toBe(-80);
    expect(parseMoney("80 USD")).toBe(80);
    expect(parseMoney('"-12.346"')).toBe(-12.35);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1,23")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("reads a free list split by lines, spaces, semicolons and commas", () => {
    const r = parseTradeResults("120\n-80, 45;-30  $1,250.50\n\nhello -10");
    expect(r.values).toEqual([120, -80, 45, -30, 1250.5, -10]);
    expect(r.skipped).toEqual(["hello"]);
    expect(r.column).toBeNull();
    expect(r.error).toBeNull();
  });

  it("skips a lone Profit header above a column of numbers", () => {
    const r = parseTradeResults("Profit\n10\n-5");
    expect(r.values).toEqual([10, -5]);
    expect(r.skipped).toEqual([]);
    expect(r.column).toBe("Profit");
  });

  it("uses the profit column of a CSV export and ignores the rest", () => {
    const csv = [
      "Time,Symbol,Type,Volume,Price,Commission,Swap,Profit",
      '2026.11.02 09:00,EURUSD,buy,0.5,1.0812,-3.5,0,"1,120.00"',
      "2026.11.02 11:00,XAUUSD,sell,0.1,2650.1,-1,0,-80.25",
      "2026.11.03 10:00,GBPUSD,buy,0.2,1.29,-1,0,",
      ",,,,,,,Total",
    ].join("\n");
    const r = parseTradeResults(csv);
    expect(r.column).toBe("Profit");
    expect(r.values).toEqual([1120, -80.25]);
    expect(r.skipped).toEqual(["Total"]);
  });

  it("detects semicolon and tab files and P/L style names", () => {
    expect(parseTradeResults("Date;Net P/L\n1.11;-5\n2.11;7").values).toEqual([-5, 7]);
    expect(parseTradeResults("Symbol\tPnL\nEURUSD\t12\nUSDJPY\t-3").values).toEqual([12, -3]);
  });

  it("explains when a header has no profit column", () => {
    const r = parseTradeResults("Time,Symbol,Price\n1,EURUSD,1.08");
    expect(r.values).toEqual([]);
    expect(r.error).toMatch(/Couldn't find a profit column/);
    expect(r.error).toMatch(/Time, Symbol, Price/);
  });

  it("splits quoted CSV fields correctly", () => {
    expect(splitDelimited('a,"b, c","say ""hi""",', ",")).toEqual(["a", "b, c", 'say "hi"', ""]);
  });

  it("stops at the maximum number of results", () => {
    const r = parseTradeResults(Array.from({ length: MAX_TRADE_RESULTS + 3 }, (_, i) => (i % 2 ? "-1" : "2")).join("\n"));
    expect(r.values).toHaveLength(MAX_TRADE_RESULTS);
    expect(r.truncated).toBe(true);
  });

  it("summarizes and resizes results", () => {
    const s = summarizeTradeResults([100, -50, 0, 200, -150]);
    expect(s).toMatchObject({ trades: 5, wins: 2, losses: 2, breakeven: 1, winRate: 50, avgWin: 150, avgLoss: 100, biggestWin: 200, biggestLoss: 150, net: 100 });
    expect(resizeTradeResults([100, -50], 10000, 25000)).toEqual([250, -125]);
    expect(resizeTradeResults([100, -50], null, 25000)).toEqual([100, -50]);
  });

  it("replays pasted results in the simulator engine", () => {
    const values = parseTradeResults(EXAMPLE_TRADE_RESULTS).values;
    const r = simulateChallenge({
      plan: getRulePlan(25000, "2-phase"),
      phase: 1,
      riskAmount: 0,
      rewardRatio: 0,
      winRatePercent: 0,
      tradesPerDay: 2,
      dayLimit: 60,
      costPerTrade: 0,
      stopBeforeBreach: true,
      runs: 300,
      seed: 3,
      tradeOutcomes: values.filter((v) => v !== 0),
    });
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(300);
  });
});

const renderSim = (path = "/rules?smethod=own#simulator") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ChallengeSimulator />
    </MemoryRouter>,
  );

describe("pass simulator with your own results", () => {
  it("opens in own-results mode from the link and runs on pasted results", () => {
    renderSim();
    expect(screen.getByRole("button", { name: "One of my own trade results" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText(/Win rate/)).toBeNull();
    expect(screen.queryByTestId("sim-pass-rate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try made-up example results" }));
    const summary = screen.getByTestId("sim-own-summary");
    expect(summary).toHaveTextContent("20 results read");
    expect(summary).toHaveTextContent("8 / 12");
    expect(screen.getByTestId("sim-pass-rate")).toHaveTextContent("%");
    expect(screen.getByText(/each simulated trade is one of your results picked at random/i)).toBeInTheDocument();
  });

  it("asks for enough results and both wins and losses", () => {
    renderSim();
    const box = screen.getByLabelText("Your closed-trade results (USD)");
    fireEvent.change(box, { target: { value: "10 -5 20" } });
    expect(screen.getByText(/at least 10 winning or losing results \(found 3\)/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: Array(12).fill("10").join("\n") } });
    expect(screen.getByText("Add at least one winning and one losing result.")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-pass-rate")).toBeNull();
  });

  it("warns when the biggest loss is larger than the daily allowance and resizes by the original account", () => {
    renderSim("/rules?size=10000&smethod=own#simulator");
    fireEvent.change(screen.getByLabelText("Your closed-trade results (USD)"), {
      target: { value: [...Array(6).fill("300"), ...Array(5).fill("-200"), "-900"].join("\n") },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Your biggest loss here ($900 with charges)");
    expect(screen.queryByTestId("sim-pass-rate")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Account size these results were made on/), { target: { value: "25,000" } });
    expect(screen.getByText(/resized ×0.4/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("sim-pass-rate")).toBeInTheDocument();
  });

  it("reads an uploaded CSV on the device", async () => {
    renderSim();
    const csv = ["Symbol,Profit", ...Array.from({ length: 12 }, (_, i) => `EURUSD,${i % 3 ? -50 : 120}`)].join("\n");
    const file = new File([csv], "history.csv", { type: "text/csv" });
    fireEvent.change(screen.getByTestId("sim-trade-file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("sim-own-summary")).toHaveTextContent('12 results read from the "Profit" column'));
    expect(screen.getByText("Read history.csv on this device.")).toBeInTheDocument();
  });

  it("keeps the method in the share link but switches back to fixed mode", () => {
    renderSim();
    fireEvent.click(screen.getByRole("button", { name: "A fixed win or loss at a set win rate" }));
    expect(screen.getByLabelText(/Win rate/)).toBeInTheDocument();
    expect(screen.getByTestId("sim-pass-rate")).toBeInTheDocument();
  });
});

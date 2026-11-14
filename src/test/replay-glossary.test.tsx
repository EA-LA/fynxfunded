import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import FAQ from "@/pages/FAQ";
import type { Trade } from "@/lib/tradingData";
import { getRulePlan } from "@/lib/ruleCalculator";
import { simulateChallenge, type SimulationInput } from "@/lib/challengeSimulator";
import { journalTradeOutcomes } from "@/lib/journalSimulator";
import { glossaryGroups, glossaryTerms, searchGlossary } from "@/lib/glossary";
import JournalSimulatorCard from "@/components/analytics/JournalSimulatorCard";

afterEach(cleanup);

const base = (over: Partial<SimulationInput> = {}): SimulationInput => ({
  plan: getRulePlan(25000, "2-phase"),
  phase: 1,
  riskAmount: 250,
  rewardRatio: 2,
  winRatePercent: 50,
  tradesPerDay: 2,
  dayLimit: 60,
  costPerTrade: 0,
  stopBeforeBreach: true,
  runs: 400,
  seed: 7,
  ...over,
});

describe("replay mode in the simulator", () => {
  it("matches the fixed plan when the record is one win and one loss of the planned size", () => {
    const fixed = simulateChallenge(base());
    const replay = simulateChallenge(base({ riskAmount: 0, rewardRatio: 0, winRatePercent: 0, tradeOutcomes: [500, -250] }));
    expect(replay).toEqual(fixed);
  });

  it("is repeatable and takes charges off every replayed trade", () => {
    const input = base({ riskAmount: 0, rewardRatio: 0, winRatePercent: 0, tradeOutcomes: [400, -150, 90, -260, 310] });
    expect(simulateChallenge(input)).toEqual(simulateChallenge(input));
    const free = simulateChallenge(input).percents.passed;
    const charged = simulateChallenge({ ...input, costPerTrade: 60 }).percents.passed;
    expect(charged).toBeLessThan(free);
  });

  it("never trades past a floor when stopping before a breach, using the biggest loss", () => {
    // Biggest loss ($1,300) is larger than the $1,250 daily allowance: nothing can be traded safely.
    const res = simulateChallenge(base({ riskAmount: 0, rewardRatio: 0, winRatePercent: 0, tradeOutcomes: [300, -1300, 200] }));
    expect(res.counts.dailyBreach + res.counts.maxBreach).toBe(0);
  });

  it("resizes the record to the chosen account and leaves breakeven trades out", () => {
    const trades = [100, -50, 0, 30].map((pnl, i) => ({ pnl, id: String(i) }) as Trade);
    expect(journalTradeOutcomes(trades, 50000, 100000)).toEqual([200, -100, 60]);
    expect(journalTradeOutcomes(trades, 0, 100000)).toEqual([100, -50, 30]);
  });
});

let n = 0;
const trade = (day: number, pnl: number): Trade => {
  const close = `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
  return {
    id: `r${++n}`, accountId: "a", challengeId: "c", symbol: "EURUSD", type: "Buy", openTime: close, closeTime: close,
    lots: 1, pnl, pips: 0, duration: "0m", riskPercent: 0, rr: 0, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
  };
};
const record: Trade[] = [
  ...[1, 2, 3, 4, 5].map((d) => trade(d, 150)),
  ...[1, 2, 3, 4, 5, 6, 6].map((d) => trade(d, -100)),
  trade(7, 900),
  trade(7, -400),
];

describe("JournalSimulatorCard replay", () => {
  const renderCard = () =>
    render(<MemoryRouter><JournalSimulatorCard trades={record} accountSize={50000} periodLabel="all recorded history" /></MemoryRouter>);

  it("switches to replaying real trades and compares with the average method", () => {
    renderCard();
    const average = screen.getByTestId("journal-sim-pass").textContent;
    expect(screen.getByTestId("journal-sim-compare")).toHaveTextContent("Replaying your real trades instead");
    fireEvent.click(screen.getByRole("button", { name: "One of your real trades" }));
    expect(screen.getByRole("button", { name: "One of your real trades" })).toHaveAttribute("aria-pressed", "true");
    const note = screen.getByTestId("journal-sim-replay-note");
    expect(note).toHaveTextContent("14 real winning or losing trades");
    expect(note).toHaveTextContent("biggest loss here is $400");
    expect(note).toHaveTextContent("biggest win $900");
    expect(screen.getByTestId("journal-sim-pass").textContent).toMatch(/^\d+(\.\d)?%$/);
    expect(screen.getByTestId("journal-sim-compare")).toHaveTextContent(`Using your average win or loss instead: ${average} passed`);
  });

  it("warns when the biggest real loss alone would break the daily limit at the chosen size", () => {
    // A $3,000 loss is bigger than the $2,500 daily allowance of a $50K 2-phase account.
    render(
      <MemoryRouter>
        <JournalSimulatorCard trades={[...record, trade(8, -3000)]} accountSize={50000} periodLabel="all recorded history" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "One of your real trades" }));
    expect(screen.getByRole("alert")).toHaveTextContent("biggest recorded loss ($3,000)");
    expect(screen.queryByTestId("journal-sim-pass")).toBeNull();
  });
});

describe("glossary", () => {
  it("has unique ids, known groups and internal links only", () => {
    const ids = glossaryTerms.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = glossaryGroups.map((g) => g.id);
    for (const t of glossaryTerms) {
      expect(groups).toContain(t.group);
      expect(t.definition.length).toBeGreaterThan(30);
      if (t.link) expect(t.link.to.startsWith("/")).toBe(true);
    }
  });

  it("uses the published rule figures", () => {
    const max = glossaryTerms.find((t) => t.id === "maximum-loss")!.definition;
    expect(max).toContain("8% below the starting balance on 1-phase, 10% on 2-phase and 12% on 3-phase");
    expect(glossaryTerms.find((t) => t.id === "daily-reset")!.definition).toContain("22:00 UTC");
  });

  it("finds terms by name, other names and definition, name matches first", () => {
    expect(searchGlossary("pip")[0].id).toBe("pip");
    expect(searchGlossary("trailing").map((t) => t.id)).toContain("static-vs-trailing");
    expect(searchGlossary("R:R").map((t) => t.id)).toContain("risk-reward");
    expect(searchGlossary("zzzz")).toEqual([]);
  });

  it("is searchable on the FAQ page and links each term", () => {
    render(<I18nProvider><MemoryRouter initialEntries={["/faq"]}><FAQ /></MemoryRouter></I18nProvider>);
    const glossary = screen.getByTestId("glossary");
    expect(within(glossary).getAllByTestId("glossary-term")).toHaveLength(glossaryTerms.length);
    fireEvent.change(screen.getByLabelText("Search the glossary"), { target: { value: "equity" } });
    expect(within(glossary).getAllByTestId("glossary-term")[0]).toHaveAttribute("id", "term-equity");
    expect(screen.getByText(/of \d+ terms match/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search the glossary"), { target: { value: "qqqq" } });
    expect(within(glossary).getByText(/No terms match/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the glossary" })).toHaveAttribute("href", "#glossary");
  });

  it("highlights a shared term link", () => {
    render(<I18nProvider><MemoryRouter initialEntries={["/faq#term-pip"]}><FAQ /></MemoryRouter></I18nProvider>);
    expect(document.getElementById("term-pip")?.className).toContain("ring-2");
  });
});

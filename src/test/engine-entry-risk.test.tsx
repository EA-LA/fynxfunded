import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { closePosition, entryRiskFor, modifyPosition, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import type { Deal, Quote, RuleSet } from "@/engine/types";
import { buildSpecs } from "@/engine/venue";
import { parseHistoryPage, validEntryRisk } from "@/engine/gateway";
import { dealRiskFields, dealToTradeRecord } from "@/engine/ledger";
import { computeAnalytics, mapClosedTrade, recordedRMultiple, type Trade } from "@/lib/tradingData";
import { rBucketKey, rMultipleSummary } from "@/lib/rMultiples";
import { sortTrades } from "@/lib/tradeJournal";
import { dealR } from "@/trade-access/TradeAccess";
import RMultipleCard from "@/components/analytics/RMultipleCard";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });

describe("engine: risk at entry", () => {
  it("records the entry stop, dollars at risk and opening balance on a market fill", () => {
    const step = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.0781, takeProfit: 1.0841 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    // Filled at the ask 1.0801; the stop 20 pips below on 1 lot = $200.
    expect(step.state.positions[0].entryRisk).toEqual({ stopLoss: 1.0781, takeProfit: 1.0841, amount: 200, balance: 10000 });
  });

  it("leaves it out without a stop loss and converts non-USD quote currencies", () => {
    const none = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    expect(none.state.positions[0].entryRisk).toBeUndefined();
    const book = [q("USDJPY", 150, 150.02)];
    const jpy = placeOrder(newAccount("a", rules, T0), { symbol: "USDJPY", side: "sell", type: "market", lots: 1, stopLoss: 150.3 }, ctx(book));
    // 30 pips on 100,000 USD = 30,000 JPY at 150.01 ≈ $199.99
    expect(jpy.state.positions[0].entryRisk?.amount).toBeCloseTo(199.99, 2);
    expect(entryRiskFor(specs.EURGBP, "buy", 1, 0.85, 0.849, undefined, 10000, {})).toBeNull(); // no GBP price: no figure, order not blocked
  });

  it("measures a pending order's risk from its actual fill and keeps it when the stop is moved later", () => {
    const placed = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "stop", lots: 2, price: 1.081, stopLoss: 1.08 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    expect(placed.state.positions).toHaveLength(0);
    // The stop order fills at the market, 1.0812 (2 pips of slippage past 1.0810): 12 pips × 2 lots = $240.
    const filled = tick(placed.state, ctx([q("EURUSD", 1.0811, 1.0812, T0 + 1000)], T0 + 1000));
    const p = filled.state.positions[0];
    expect(p.entryRisk).toEqual({ stopLoss: 1.08, amount: 240, balance: 10000 });
    const moved = modifyPosition(filled.state, p.id, { stopLoss: 1.0812 - 0.0002 }, ctx([q("EURUSD", 1.083, 1.0831, T0 + 2000)], T0 + 2000));
    expect(moved.state.positions[0].stopLoss).toBeCloseTo(1.081, 6);
    expect(moved.state.positions[0].entryRisk).toEqual(p.entryRisk);
  });

  it("splits the risk across partial closes and puts it on each deal", () => {
    const opened = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.0781 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    const id = opened.state.positions[0].id;
    const part = closePosition(opened.state, id, 0.4, ctx([q("EURUSD", 1.0841, 1.0842, T0 + 1000)], T0 + 1000));
    expect(part.state.history[0].entryRisk?.amount).toBe(80);
    expect(part.state.positions[0].entryRisk?.amount).toBe(120);
    const rest = closePosition(part.state, id, undefined, ctx([q("EURUSD", 1.0781, 1.0782, T0 + 2000)], T0 + 2000));
    expect(rest.state.history[1].entryRisk?.amount).toBe(120);
    expect(rest.state.history.reduce((t, d) => t + (d.entryRisk?.amount ?? 0), 0)).toBe(200);
    // Stopped out at the stop: −1R plus costs.
    expect(dealR(rest.state.history[1])).toBe(`−${(Math.abs(rest.state.history[1].netProfit) / 120).toFixed(2)}R`);
  });

  it("accepts deals with entry risk from a server and refuses malformed ones", () => {
    const d: Deal = { id: "p1:1", positionId: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.082, openedAt: T0, closedAt: T0 + 1, grossProfit: 200, commission: 7, netProfit: 193, reason: "manual", entryRisk: { stopLoss: 1.079, amount: 100, balance: 10000 } };
    const page = (deal: unknown) => ({ accountId: "a", index: 0, chunks: 1, firstClosedAt: T0, lastClosedAt: T0, deals: [deal] });
    expect(parseHistoryPage(page(d), "a", 0).deals[0].entryRisk?.amount).toBe(100);
    expect(() => parseHistoryPage(page({ ...d, entryRisk: { stopLoss: 1.079, amount: 0, balance: 10000 } }), "a", 0)).toThrow();
    expect(validEntryRisk({ stopLoss: 1.079, takeProfit: "x", amount: 1, balance: 1 })).toBe(false);
  });
});

describe("ledger: risk %, planned R:R and result in R", () => {
  const base: Deal = { id: "d1", positionId: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.0825, openedAt: T0, closedAt: T0 + 60_000, grossProfit: 250, commission: 7, netProfit: 243, reason: "take_profit" };

  it("fills the fields from the entry risk", () => {
    const deal = { ...base, entryRisk: { stopLoss: 1.079, takeProfit: 1.0825, amount: 100, balance: 10000 } };
    expect(dealRiskFields(deal)).toEqual({ stopLossAtEntry: 1.079, riskAmount: 100, riskPercent: 1, rr: 2.5, rMultiple: 2.43 });
    const record = dealToTradeRecord("acc_1", deal, { userId: "u1" }, 0.0001, T0);
    expect(Object.values(record).every(v => v !== undefined)).toBe(true);
    const trade = mapClosedTrade("x", record)!;
    expect(trade).toMatchObject({ riskPercent: 1, rr: 2.5, rMultiple: 2.43 });
  });

  it("writes no risk fields (never 0) without an entry stop, and no R:R without an entry target", () => {
    const record = dealToTradeRecord("acc_1", base, { userId: "u1" }, 0.0001, T0);
    expect(record).not.toHaveProperty("riskPercent");
    expect(record).not.toHaveProperty("rMultiple");
    expect(mapClosedTrade("x", record)).toMatchObject({ riskPercent: null, rr: null, rMultiple: null });
    expect(dealRiskFields({ ...base, entryRisk: { stopLoss: 1.079, amount: 100, balance: 10000 } })).not.toHaveProperty("rr");
  });

  it("works out R from riskAmount on other records", () => {
    expect(recordedRMultiple({ riskAmount: 50 }, -75)).toBe(-1.5);
    expect(recordedRMultiple({ rMultiple: 2 }, -75)).toBe(2);
    expect(recordedRMultiple({}, 10)).toBeNull();
  });
});

const trade = (id: string, pnl: number, over: Partial<Trade> = {}): Trade => ({
  id, accountId: "a", challengeId: "c", symbol: "EURUSD", type: "Buy", openTime: "2026-11-02T09:00:00.000Z", closeTime: `2026-11-02T1${id.length % 10}:00:00.000Z`,
  lots: 1, pnl, pips: 0, duration: "1h", riskPercent: null, rr: null, rMultiple: null, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven", ...over,
});

describe("dashboard: honest risk columns and R-multiple distribution", () => {
  it("averages risk and R:R over the trades that carry them, null when none do", () => {
    expect(computeAnalytics([trade("a", 10), trade("b", -5)])).toMatchObject({ avgRisk: null, avgRR: null });
    expect(computeAnalytics([trade("a", 10, { riskPercent: 1, rr: 2 }), trade("b", -5)])).toMatchObject({ avgRisk: 1, avgRR: 2 });
  });

  it("sorts trades without a risk value last in both directions", () => {
    const list = [trade("a", 1), trade("bb", 1, { riskPercent: 0.5 }), trade("ccc", 1, { riskPercent: 2 })];
    expect(sortTrades(list, { key: "riskPercent", dir: "desc" }).map(t => t.id)).toEqual(["ccc", "bb", "a"]);
    expect(sortTrades(list, { key: "riskPercent", dir: "asc" }).map(t => t.id)).toEqual(["bb", "ccc", "a"]);
  });

  it("buckets R and summarises it", () => {
    expect([-2.5, -2, -1, -0.4, 0, 0.9, 1, 2.2, 3, 7].map(rBucketKey)).toEqual(["lt-2", "lt-2", "-2to-1", "-1to0", "0to1", "0to1", "1to2", "2to3", "ge3", "ge3"]);
    const rs = [-1, -1.2, 2, 2.5, -1, 0.5];
    const s = rMultipleSummary([...rs.map((r, i) => trade(`t${i}`, r * 100, { rMultiple: r })), trade("none", 40)]);
    expect(s).toMatchObject({ count: 6, total: 7, average: 0.3, median: -0.25, best: 2.5, worst: -1.2, beyondStop: 1, twoROrMore: 2, sum: 1.8 });
    expect(s.buckets.find(b => b.key === "-2to-1")).toMatchObject({ count: 3, share: 50 });
    expect(s.note).toContain("+0.30R");
    expect(s.note).toContain("1 loss went past −1R");
  });

  it("shows the card with coverage, and an honest empty state", () => {
    const { unmount } = render(<RMultipleCard trades={[trade("a", 10), trade("b", -5)]} />);
    expect(screen.getByTestId("r-coverage").textContent).toMatch(/None of these trades recorded the risk/);
    expect(screen.queryByTestId("r-bucket-ge3")).toBeNull();
    unmount();
    render(<RMultipleCard trades={[trade("a", 300, { rMultiple: 3 }), trade("b", -100, { rMultiple: -1 }), trade("c", 5)]} />);
    const card = screen.getByTestId("r-multiple-card");
    expect(within(card).getByTestId("r-coverage").textContent).toContain("2 of 3 closed trades");
    expect(within(card).getByTestId("r-bucket-ge3").textContent).toContain("1 · 50%");
    expect(within(card).getByTestId("r-note").textContent).toMatch(/at least 5 trades/);
  });
});

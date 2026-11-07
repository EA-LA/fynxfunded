import { describe, expect, it } from "vitest";
import { dailyResults, newAccount, targetReport, tick, type EngineContext } from "@/engine/core";
import type { AccountState, Deal, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22, consistencyPercent: 40 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const ctx = (now = T0, r = rules): EngineContext => ({ specs, quotes: {}, rules: r, now, maxQuoteAgeMs: 5000, newId: p => `${p}1` });
const deal = (closedAt: string, netProfit: number, i: number): Deal => ({ id: `d${i}`, positionId: `p${i}`, symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.09, openedAt: Date.parse(closedAt) - 60_000, closedAt: Date.parse(closedAt), grossProfit: netProfit, commission: 0, netProfit, reason: "manual" });
const withDeals = (results: [string, number][], extra: Partial<AccountState> = {}): AccountState => {
  const history = results.map(([t, v], i) => deal(t, v, i));
  return { ...newAccount("a", rules, T0), balance: 10000 + results.reduce((s, [, v]) => s + v, 0), history, tradingDays: [...new Set(results.map(([t]) => t.slice(0, 10)))], ...extra };
};

describe("target report and the 40% best-day rule", () => {
  it("groups closed results into 22:00 UTC trading days", () => {
    const s = withDeals([["2026-11-03T21:59:00Z", 100], ["2026-11-03T22:01:00Z", 50], ["2026-11-04T09:00:00Z", -20.5]]);
    expect(dailyResults(s, 22)).toEqual({ "2026-11-02": 100, "2026-11-03": 29.5 });
  });

  it("holds the target back while one day is more than 40% of the profit", () => {
    const s = withDeals([["2026-11-02T10:00:00Z", 500], ["2026-11-03T10:00:00Z", 200], ["2026-11-04T10:00:00Z", 150]]); // 850 profit, best 500 = 58.8%
    const r = targetReport(s, rules);
    expect(r).toMatchObject({ profit: 850, targetProfit: 800, targetMet: true, daysMet: true, bestDay: { day: "2026-11-01", profit: 500 }, bestDayShare: 58.82, consistencyMet: false, profitForConsistency: 1250, ready: false });
    expect(r.missing).toEqual(["Best day is 58.82% of the profit (limit 40%): total profit needs to reach 1250.00 USD."]);
    expect(tick(s, ctx()).events).toEqual([]);
  });

  it("reports the target once every rule is met, exactly at the 40% limit", () => {
    const s = withDeals([["2026-11-02T10:00:00Z", 400], ["2026-11-03T10:00:00Z", 300], ["2026-11-04T10:00:00Z", 300]]); // 1000 profit, best day exactly 40%
    const r = targetReport(s, rules);
    expect(r).toMatchObject({ bestDayShare: 40, consistencyMet: true, ready: true, missing: [] });
    expect(tick(s, ctx()).events.map(e => e.type)).toEqual(["target_reached"]);
  });

  it("lists everything still missing in plain words", () => {
    const s = withDeals([["2026-11-04T10:00:00Z", 300]], { positions: [{ id: "p9", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, openedAt: T0, commission: 3.5 }] });
    const r = targetReport(s, rules);
    expect(r.profitToGo).toBe(500);
    expect(r.missing).toEqual(["500.00 USD more closed profit for the target.", "2 more trading days.", "Best day is 100% of the profit (limit 40%): total profit needs to reach 750.00 USD.", "Close 1 open position."]);
  });

  it("needs positive profit for the rule, ignores it when the account has none, and never passes a breached account", () => {
    const losing = withDeals([["2026-11-04T10:00:00Z", -100]]);
    expect(targetReport(losing, rules)).toMatchObject({ bestDayShare: null, consistencyMet: false, profitForConsistency: null });
    expect(targetReport(losing, rules).missing).toContain("Total profit must be positive for the 40% best-day rule.");
    const noRule = { ...rules, consistencyPercent: null };
    const lumpy = withDeals([["2026-11-02T10:00:00Z", 700], ["2026-11-03T10:00:00Z", 50], ["2026-11-04T10:00:00Z", 60]]);
    expect(targetReport(lumpy, noRule)).toMatchObject({ consistencyLimit: null, consistencyMet: true, ready: true });
    expect(targetReport({ ...lumpy, status: "breached" }, noRule).ready).toBe(false);
    const funded = targetReport(lumpy, { ...rules, profitTargetPercent: null });
    expect(funded).toMatchObject({ targetProfit: null, profitToGo: null, ready: false });
    expect(funded.missing[0]).toBe("Funded accounts have no profit target.");
  });

  it("sends the report with every venue snapshot", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 5000 }, () => T0);
    venue.connect(new StaticQuoteFeed());
    const snap = await venue.open("acc");
    expect(snap.report).toMatchObject({ profit: 0, targetProfit: 800, tradingDays: 0, minTradingDays: 3, ready: false });
  });
});

describe("rules from a purchase", () => {
  it("turns stored purchase rules into an engine rule set", () => {
    expect(rulesFromPurchase(50000, { profit_target_percent: "8%", daily_loss_percent: "5", max_loss_percent: 10, min_trading_days: "5", consistency_percent: "40" }))
      .toEqual({ startingBalance: 50000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22, consistencyPercent: 40 });
    expect(rulesFromPurchase(50000, { profit_target_percent: null, daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 0, reset_hour_utc: 21 }, { funded: true }))
      .toMatchObject({ profitTargetPercent: null, consistencyPercent: null, resetHourUtc: 21 });
  });
  it("refuses malformed rules instead of guessing", () => {
    const ok = { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 };
    expect(() => rulesFromPurchase(0, ok)).toThrow(/Starting balance/);
    expect(() => rulesFromPurchase(10000, { ...ok, daily_loss_percent: "abc" })).toThrow(/Daily loss/);
    expect(() => rulesFromPurchase(10000, { ...ok, max_loss_percent: "150" })).toThrow(/Maximum loss/);
    expect(() => rulesFromPurchase(10000, { ...ok, profit_target_percent: null })).toThrow(/Profit target/);
    expect(() => rulesFromPurchase(10000, { ...ok, min_trading_days: 2.5 })).toThrow(/whole number/);
    expect(() => rulesFromPurchase(10000, { ...ok, reset_hour_utc: 24 })).toThrow(/Reset hour/);
  });
});

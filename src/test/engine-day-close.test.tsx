import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DAY_CLOSES_KEPT, dayCloseRecord, newAccount, tick, type EngineContext } from "@/engine/core";
import type { AccountState, DayClose, Deal, Position, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore } from "@/engine/venue";
import { HttpGateway } from "@/engine/gateway";
import { handleEngineRequest } from "@/engine/host";
import { fromFirestoreData, toFirestoreData } from "@/engine/firestore-store";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { DAILY_HEADERS, dailyStatementCsv, dailySummary, sortedDays } from "@/trade-access/daily-statement";
import DailyStatement from "@/trade-access/DailyStatement";

const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22, consistencyPercent: 40 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, swap: { EURUSD: { longPerLot: -7, shortPerLot: 2.5 } } });
const RESET = Date.parse("2026-11-10T22:00:00Z"); // ends trading day 2026-11-09 (a Tuesday reset)
const ctx = (now: number, quotes: Quote[] = []): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(q => [q.symbol, q])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}x` });
const deal = (id: string, closedAt: number, netProfit: number): Deal => ({ id, positionId: `p-${id}`, symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.081, openedAt: closedAt - 60_000, closedAt, grossProfit: netProfit, commission: 0, netProfit, reason: "manual" });
const pos = (over: Partial<Position> = {}): Position => ({ id: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, openedAt: RESET - 3_600_000, commission: 0, ...over });
const account = (over: Partial<AccountState> = {}): AccountState => ({ ...newAccount("acc1", rules, RESET - 3_600_000), ...over });

describe("end-of-day records at the daily reset", () => {
  it("records how a flat day ended: balances, closed trades and result, limit levels", () => {
    const s = account({ balance: 10050, history: [deal("d1", RESET - 7_200_000, 80), deal("d2", RESET - 3_600_000, -30), deal("old", RESET - 2 * 86_400_000, 999)] });
    const step = tick(s, ctx(RESET + 30_000));
    expect(step.state.tradingDay).toBe("2026-11-10");
    expect(step.state.dayStartBalance).toBe(10050);
    expect(step.state.dayCloses).toEqual([{
      tradingDay: "2026-11-09", startBalance: 10000, closingBalance: 10050, closingEquity: 10050, pricesAt: null, closedResult: 50, trades: 2,
      dailyLossFloor: 9500, maxLossFloor: 9000, roomAtClose: 550, openPositions: 0, openLots: 0, swapAtRollover: 0, status: "active", recordedAt: RESET + 30_000, late: false,
      lowestEquity: 10050, lowestEquityAt: RESET + 30_000, roomAtLow: 550,
    }]);
    // The next tick in the same day adds nothing.
    expect(tick(step.state, ctx(RESET + 60_000)).state.dayCloses).toHaveLength(1);
  });

  it("values positions held through the reset at the last prices and records the rollover swap", () => {
    const q: Quote = { symbol: "EURUSD", bid: 1.081, ask: 1.0811, time: RESET - 1000 };
    const s = account({ balance: 10050, positions: [pos()] });
    const step = tick(s, ctx(RESET + 1000, [{ ...q, time: RESET + 500 }]));
    const swap = step.events.filter(e => e.type === "swap_applied").reduce((t, e) => t + (e.type === "swap_applied" ? e.amount : 0), 0);
    expect(swap).toBeLessThan(0);
    const [rec] = step.state.dayCloses!;
    expect(rec).toMatchObject({ closingEquity: 10150, pricesAt: RESET + 500, roomAtClose: 650, openPositions: 1, openLots: 1, swapAtRollover: swap });
    expect(step.state.positions[0].swap).toBe(swap);
  });

  it("leaves equity blank instead of guessing when an open trade has no price or no dollar conversion", () => {
    const noPrice = dayCloseRecord(account({ positions: [pos()] }), ctx(RESET + 1000));
    expect(noPrice).toMatchObject({ closingEquity: null, pricesAt: null, roomAtClose: null, openPositions: 1 });
    // EUR/GBP has a price, but there is no GBP/USD price to turn the result into dollars: no crash, no figure.
    const cross = dayCloseRecord(account({ positions: [pos({ symbol: "EURGBP", entryPrice: 0.87 })] }), ctx(RESET, [{ symbol: "EURGBP", bid: 0.871, ask: 0.8711, time: RESET }]));
    expect(cross.closingEquity).toBeNull();
  });

  it("marks a record late when the engine was not running at the reset, and writes one record for the stored day", () => {
    const s = account({ balance: 10100 });
    const later = RESET + 2 * 86_400_000 + 3_600_000; // two days later
    const step = tick(s, ctx(later));
    expect(step.state.dayCloses).toHaveLength(1);
    expect(step.state.dayCloses![0]).toMatchObject({ tradingDay: "2026-11-09", late: true, recordedAt: later });
    expect(tick(account(), ctx(RESET + 4 * 60_000)).state.dayCloses![0].late).toBe(false);
    expect(tick(account(), ctx(RESET + 6 * 60_000)).state.dayCloses![0].late).toBe(true);
  });

  it("keeps the newest records only and records breached accounts too", () => {
    const old: DayClose[] = Array.from({ length: DAY_CLOSES_KEPT }, (_, i) => ({ ...tick(account(), ctx(RESET + 1000)).state.dayCloses![0], tradingDay: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` }));
    const step = tick(account({ status: "breached", dayCloses: old }), ctx(RESET + 1000));
    expect(step.state.dayCloses).toHaveLength(DAY_CLOSES_KEPT);
    expect(step.state.dayCloses![0]).toMatchObject({ tradingDay: "2026-11-09", status: "breached" });
  });

  it("reaches the terminal through the venue and the HTTP contract after a reset", async () => {
    let now = RESET - 3_600_000;
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 5000 }, () => now);
    await venue.open("acc1");
    now = RESET + 2000;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string> }, { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => false, status: () => ({ priceFeed: true, execution: false, message: "ok" }) });
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const snap = await new HttpGateway("https://api.example.com", async () => "t", fetcher).snapshot("acc1");
    expect(snap.state.dayCloses).toEqual([expect.objectContaining({ tradingDay: "2026-11-09", closingBalance: 10000, closingEquity: 10000, late: false })]);
    // Stored, so a second look does not add another record.
    expect((await venue.snapshot("acc1")).state.dayCloses).toHaveLength(1);
  });

  it("survives the Firestore store and rejects malformed records", () => {
    const state = tick(account({ positions: [pos()] }), ctx(RESET + 1000, [{ symbol: "EURUSD", bid: 1.081, ask: 1.0811, time: RESET + 900 }])).state;
    const back = fromFirestoreData("acc1", toFirestoreData(state));
    expect(back.dayCloses).toEqual(state.dayCloses);
    expect(() => fromFirestoreData("acc1", { ...toFirestoreData(state), dayCloses: "nope" })).toThrow(/malformed/);
    expect(() => fromFirestoreData("acc1", { ...toFirestoreData(state), dayCloses: [{ x: 1 }] })).toThrow(/malformed/);
  });
});

const rec = (tradingDay: string, start: number, close: number, over: Partial<DayClose> = {}): DayClose => ({ tradingDay, startBalance: start, closingBalance: close, closingEquity: close, pricesAt: null, closedResult: close - start, trades: 2, dailyLossFloor: start * 0.95, maxLossFloor: 9000, roomAtClose: close - Math.max(start * 0.95, 9000), openPositions: 0, openLots: 0, swapAtRollover: 0, status: "active", recordedAt: 0, late: false, ...over });

describe("daily statement for the terminal and dashboard", () => {
  const days = [rec("2026-11-05", 10000, 10200), rec("2026-11-06", 10200, 10050, { late: true, recordedAt: 5 }), rec("2026-11-09", 10050, 10050), rec("2026-11-06", 10200, 10050, { recordedAt: 1 })];

  it("sums up days, dropping a repeated day", () => {
    expect(sortedDays(days).map(d => d.tradingDay)).toEqual(["2026-11-09", "2026-11-06", "2026-11-05"]);
    expect(sortedDays(days)[1].recordedAt).toBe(5);
    expect(dailySummary(days)).toEqual({ days: 3, up: 1, down: 1, flat: 1, net: 50, best: { day: "2026-11-05", change: 200 }, worst: { day: "2026-11-06", change: -150 }, closestCall: { day: "2026-11-06", room: 360 }, closestIntraday: null, late: 1, firstDay: "2026-11-05", lastDay: "2026-11-09" });
    expect(dailySummary(undefined)).toMatchObject({ days: 0, best: null, worst: null, closestCall: null });
  });

  it("downloads a CSV oldest day first with totals, safe for spreadsheets", () => {
    const csv = dailyStatementCsv("=acc", days).split("\r\n");
    expect(csv[0]).toBe(DAILY_HEADERS.map(h => `"${h}"`).join(","));
    expect(csv[1]).toMatch(/^"2026-11-05","2026-11-06T22:00:00Z",10000,10200,200,10200,2,200,9500,9000,700,0,0,0,"active","no",,,$/);
    expect(csv[2]).toContain('"yes"');
    expect(csv).toContain('"Account","\'=acc"');
    expect(csv).toContain('"Net change (USD)",50');
  });

  it("shows an honest empty state before the first reset", () => {
    render(<DailyStatement accountId="a" closes={undefined} now={Date.parse("2026-11-12T10:00:00Z")} />);
    expect(screen.getByTestId("daily-empty").textContent).toMatch(/first one appears after the next reset/);
    expect(screen.queryByTestId("daily-download")).toBeNull();
  });

  it("lists the days newest first with show-all and the late mark explained", () => {
    const many = Array.from({ length: 12 }, (_, i) => rec(`2026-10-${String(i + 10)}`, 10000, 10000 + i));
    render(<DailyStatement accountId="a" closes={[...many, rec("2026-11-06", 10200, 10050, { late: true })]} now={RESET} />);
    expect(screen.getAllByTestId("daily-row")).toHaveLength(10);
    expect(screen.getAllByTestId("daily-row")[0].textContent).toMatch(/6 Nov\*.*\$10,200\.00.*\$10,050\.00.*−\$150\.00/);
    fireEvent.click(screen.getByRole("button", { name: "Show all 13 days" }));
    expect(screen.getAllByTestId("daily-row")).toHaveLength(13);
    expect(screen.getByTestId("daily-statement").textContent).toMatch(/Recorded after the reset because the trading server was not running/);
    expect(screen.getByTestId("daily-download")).toBeTruthy();
  });

  it("shows five days in the dashboard's compact view without a download", () => {
    render(<DailyStatement accountId="a" closes={Array.from({ length: 7 }, (_, i) => rec(`2026-10-1${i}`, 10000, 10010))} now={RESET} compact />);
    expect(screen.getByText("Recent trading days")).toBeTruthy();
    expect(screen.getAllByTestId("daily-row")).toHaveLength(5);
    expect(screen.queryByTestId("daily-download")).toBeNull();
  });
});

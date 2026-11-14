import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DAY_LOW_INTERVAL_MS, dayCloseRecord, metrics, newAccount, nextDayLow, tick, tradingDayKey, type EngineContext } from "@/engine/core";
import type { AccountState, DayClose, Position, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore } from "@/engine/venue";
import { fromFirestoreData, toFirestoreData } from "@/engine/firestore-store";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { DAILY_HEADERS, dailyStatementCsv, dailySummary, todayLow } from "@/trade-access/daily-statement";
import DailyStatement from "@/trade-access/DailyStatement";

const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22, consistencyPercent: 40 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 });
const T0 = Date.parse("2026-11-11T10:00:00Z"); // Wednesday, markets open
const DAY = tradingDayKey(T0, 22);
const q = (bid: number, time: number, symbol = "EURUSD"): Quote => ({ symbol, bid, ask: Number((bid + 0.0001).toFixed(5)), time });
const ctx = (now: number, quotes: Quote[] = []): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}x` });
const pos = (over: Partial<Position> = {}): Position => ({ id: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, openedAt: T0 - 3_600_000, commission: 0, ...over });
const account = (over: Partial<AccountState> = {}): AccountState => ({ ...newAccount("acc1", rules, T0 - 3_600_000), positions: [pos()], ...over });

describe("lowest equity of the day: write-light rules", () => {
  it("starts a new low each trading day and ignores higher equity", () => {
    expect(nextDayLow(undefined, DAY, 10000, 9900, T0)).toEqual({ tradingDay: DAY, equity: 9900, at: T0 });
    expect(nextDayLow({ tradingDay: "2026-11-09", equity: 9000, at: 1 }, DAY, 10000, 9950, T0)).toEqual({ tradingDay: DAY, equity: 9950, at: T0 });
    expect(nextDayLow({ tradingDay: DAY, equity: 9900, at: T0 }, DAY, 10000, 9900, T0 + 1000)).toBeNull();
    expect(nextDayLow({ tradingDay: DAY, equity: 9900, at: T0 }, DAY, 10000, 9950, T0 + 1000)).toBeNull();
    expect(nextDayLow(undefined, DAY, 10000, Number.NaN, T0)).toBeNull();
  });

  it("stores a deep dip at once, a small one at most once a minute, and anything when the account changes anyway", () => {
    const low = { tradingDay: DAY, equity: 9900, at: T0 };
    // 0.1% of a $10,000 day = $10.
    expect(nextDayLow(low, DAY, 10000, 9890, T0 + 1000)).toEqual({ tradingDay: DAY, equity: 9890, at: T0 + 1000 });
    expect(nextDayLow(low, DAY, 10000, 9895, T0 + 1000)).toBeNull();
    expect(nextDayLow(low, DAY, 10000, 9895, T0 + DAY_LOW_INTERVAL_MS)).toEqual({ tradingDay: DAY, equity: 9895, at: T0 + DAY_LOW_INTERVAL_MS });
    expect(nextDayLow(low, DAY, 10000, 9899.5, T0 + 1000, true)).toEqual({ tradingDay: DAY, equity: 9899.5, at: T0 + 1000 });
  });
});

describe("lowest equity in the timer step", () => {
  it("records the first priced check of the day as one change", () => {
    const s = account();
    const step = tick(s, ctx(T0, [q(1.079, T0)]));
    expect(step.state.dayLow).toEqual({ tradingDay: DAY, equity: 9900, at: T0 });
    expect(step.state.sequence).toBe(s.sequence + 1);
    expect(step.events).toEqual([]);
  });

  it("does not touch the account for a small dip within the minute (nothing to save)", () => {
    const s = account({ dayLow: { tradingDay: DAY, equity: 9900, at: T0 } });
    const same = tick(s, ctx(T0 + 2000, [q(1.0795, T0 + 2000)])); // 9950: higher
    expect(same.state).toBe(s);
    const small = tick(s, ctx(T0 + 2000, [q(1.07895, T0 + 2000)])); // 9895: $5 lower
    expect(small.state).toBe(s);
    const deep = tick(s, ctx(T0 + 2000, [q(1.0788, T0 + 2000)])); // 9880: $20 lower
    expect(deep.state.dayLow).toEqual({ tradingDay: DAY, equity: 9880, at: T0 + 2000 });
  });

  it("waits for fresh, complete prices: stale quotes and missing dollar conversions record nothing", () => {
    expect(tick(account(), ctx(T0 + 10_000, [q(1.07, T0)])).state.dayLow).toBeUndefined();
    const cross = account({ positions: [pos({ symbol: "EURGBP", entryPrice: 0.87 })] });
    expect(tick(cross, ctx(T0, [q(0.869, T0, "EURGBP")])).state.dayLow).toBeUndefined();
  });

  it("records the balance on a flat account and keeps one sequence step when something else changed too", () => {
    const flat = account({ positions: [], balance: 9970, dayLow: { tradingDay: DAY, equity: 9975, at: T0 } });
    expect(tick(flat, ctx(T0 + 1000)).state.dayLow).toEqual({ tradingDay: DAY, equity: 9970, at: T0 + 1000 });
    // A stop loss closes the trade in the same step: the low is taken as it is, and the step is still one change.
    const withStop = account({ positions: [pos({ stopLoss: 1.0795 })], dayLow: { tradingDay: DAY, equity: 9960, at: T0 } });
    const step = tick(withStop, ctx(T0 + 1000, [q(1.0794, T0 + 1000)]));
    expect(step.state.positions).toHaveLength(0);
    expect(step.state.dayLow).toEqual({ tradingDay: DAY, equity: step.state.balance, at: T0 + 1000 });
    expect(step.state.sequence).toBe(withStop.sequence + 1);
  });

  it("keeps the equity at a loss-limit breach as the day's low", () => {
    const s = account({ dayLow: { tradingDay: DAY, equity: 9600, at: T0 } });
    const step = tick(s, ctx(T0 + 1000, [q(1.0749, T0 + 1000)])); // 9490: below the 9500 daily level
    expect(step.state.status).toBe("breached");
    expect(step.state.dayLow).toEqual({ tradingDay: DAY, equity: 9490, at: T0 + 1000 });
  });
});

describe("lowest equity in the end-of-day record", () => {
  const RESET = Date.parse("2026-11-11T22:00:00Z");
  it("uses the stored low, or the closing equity when that was lower, and the room it left", () => {
    const s = account({ dayLow: { tradingDay: DAY, equity: 9700, at: T0 } });
    const rec = dayCloseRecord(s, ctx(RESET + 1000, [q(1.0795, RESET - 500)]));
    expect(rec).toMatchObject({ closingEquity: 9950, lowestEquity: 9700, lowestEquityAt: T0, roomAtLow: 200 });
    const lower = dayCloseRecord(s, ctx(RESET + 1000, [q(1.0765, RESET - 500)]));
    expect(lower).toMatchObject({ closingEquity: 9650, lowestEquity: 9650, lowestEquityAt: RESET - 500, roomAtLow: 150 });
  });

  it("ignores a low stored for another day and stays blank without any price", () => {
    const s = account({ dayLow: { tradingDay: "2026-11-02", equity: 9100, at: 1 } });
    expect(dayCloseRecord(s, ctx(RESET + 1000))).toMatchObject({ closingEquity: null, lowestEquity: null, lowestEquityAt: null, roomAtLow: null });
  });

  it("is written at the reset and a fresh low starts for the new day", () => {
    const s = account({ dayLow: { tradingDay: DAY, equity: 9700, at: T0 } });
    const step = tick(s, ctx(RESET + 1000, [q(1.0795, RESET + 900)]));
    expect(step.state.dayCloses![0]).toMatchObject({ tradingDay: DAY, lowestEquity: 9700 });
    expect(step.state.dayLow).toEqual({ tradingDay: tradingDayKey(RESET + 1000, 22), equity: 9950, at: RESET + 1000 });
  });
});

describe("lowest equity through the venue and the store", () => {
  it("saves rarely while a price drifts down by cents every second", async () => {
    class CountingStore extends MemoryStore { saves = 0; async save(state: AccountState, expected: number) { this.saves++; return super.save(state, expected); } }
    const store = new CountingStore();
    let now = T0;
    const venue = new LocalVenue(specs, store, async () => rules, { maxQuoteAgeMs: 5000 }, () => now);
    await venue.open("acc1");
    const opened = (await store.load("acc1"))!;
    await store.save({ ...opened, positions: [pos()], dayLow: undefined, sequence: opened.sequence + 1 }, opened.sequence);
    const quotes = (venue as unknown as { quotes: Record<string, Quote> }).quotes;
    const before = store.saves;
    for (let i = 0; i < 300; i++) { // five minutes, ten cents lower each second ($30 in total)
      now = T0 + i * 1000;
      quotes.EURUSD = q(Number((1.079 - i * 0.000001).toFixed(6)), now);
      await venue.snapshot("acc1");
    }
    const written = store.saves - before;
    expect(written).toBeGreaterThanOrEqual(1);
    // First of the day, one per $10 (0.1%) step and at most one a minute otherwise: 300 checks, a handful of writes.
    expect(written).toBeLessThanOrEqual(10);
    const low = (await store.load("acc1"))!.dayLow!;
    // The true low was $9,870.10; the stored one is within 0.1% of the day's balance of it.
    expect(low.equity).toBeGreaterThanOrEqual(9870.1);
    expect(low.equity).toBeLessThanOrEqual(9880.1);
  });

  it("survives the Firestore store and rejects a malformed low", () => {
    const state = account({ dayLow: { tradingDay: DAY, equity: 9700, at: T0 } });
    expect(fromFirestoreData("acc1", toFirestoreData(state)).dayLow).toEqual(state.dayLow);
    expect(() => fromFirestoreData("acc1", { ...toFirestoreData(state), dayLow: { tradingDay: DAY, equity: "low", at: 1 } })).toThrow(/malformed/);
    expect(() => fromFirestoreData("acc1", { ...toFirestoreData(state), dayLow: [] })).toThrow(/malformed/);
  });
});

const rec = (tradingDay: string, over: Partial<DayClose> = {}): DayClose => ({ tradingDay, startBalance: 10000, closingBalance: 10000, closingEquity: 10000, pricesAt: null, closedResult: 0, trades: 0, dailyLossFloor: 9500, maxLossFloor: 9000, roomAtClose: 500, openPositions: 0, openLots: 0, swapAtRollover: 0, status: "active", recordedAt: 0, late: false, ...over });

describe("lowest equity on the daily statement", () => {
  const days = [rec("2026-11-09", { lowestEquity: 9620, lowestEquityAt: Date.parse("2026-11-10T14:32:00Z"), roomAtLow: 120 }), rec("2026-11-10", { lowestEquity: 9800, lowestEquityAt: 5, roomAtLow: 300 }), rec("2026-11-05")];

  it("reports today's low with the room it left, only for the current day", () => {
    const m = metrics(account({ positions: [] }), ctx(T0));
    expect(todayLow({ tradingDay: DAY, dayLow: { tradingDay: DAY, equity: 9620, at: T0 } }, m)).toEqual({ equity: 9620, at: T0, room: 120, limit: "daily" });
    expect(todayLow({ tradingDay: DAY, dayLow: { tradingDay: "2026-11-02", equity: 9620, at: T0 } }, m)).toBeNull();
    expect(todayLow({ tradingDay: DAY }, m)).toBeNull();
    expect(todayLow({ tradingDay: DAY, dayLow: { tradingDay: DAY, equity: 9100, at: T0 } }, { dailyLossFloor: 8950, maxLossFloor: 9000 })).toMatchObject({ room: 100, limit: "maximum" });
  });

  it("finds the closest call during a day and adds three CSV columns (blank on older records)", () => {
    expect(dailySummary(days).closestIntraday).toEqual({ day: "2026-11-09", room: 120, equity: 9620, at: Date.parse("2026-11-10T14:32:00Z") });
    expect(dailySummary([rec("2026-11-05")]).closestIntraday).toBeNull();
    expect(DAILY_HEADERS.slice(-3)).toEqual(["Lowest equity (USD)", "Lowest equity at (UTC)", "Room above limits at lowest (USD)"]);
    const csv = dailyStatementCsv("a", days).split("\r\n");
    expect(csv[1]).toMatch(/^"2026-11-05",.*"no",,,$/);
    expect(csv[2]).toMatch(/^"2026-11-09",.*"no",9620,"2026-11-10T14:32:00Z",120$/);
  });

  it("shows the lowest equity column, the closest call and today's low", () => {
    render(<DailyStatement accountId="a" closes={days} now={T0} today={{ equity: 9650, at: T0, room: 150, limit: "daily" }} />);
    expect(screen.getByTestId("daily-today-low").textContent).toMatch(/Lowest equity today so far: \$9,650\.00 at .* \$150\.00 above the daily loss level/);
    expect(screen.getByTestId("daily-closest").textContent).toMatch(/\$120\.00 on Mon 9 Nov/);
    const rows = screen.getAllByTestId("daily-row");
    expect(rows[0].textContent).toMatch(/\$9,800\.00/);
    expect(rows[2].textContent).toMatch(/5 Nov.*—/);
    expect(screen.getByText("Closest to a limit (lowest equity)")).toBeTruthy();
  });

  it("shows today's low even before the first end-of-day record", () => {
    render(<DailyStatement accountId="a" closes={undefined} now={T0} today={{ equity: 9450, at: T0, room: -50, limit: "daily" }} />);
    expect(screen.getByTestId("daily-today-low").textContent).toMatch(/-\$50\.00|−\$50\.00/);
    expect(screen.getByTestId("daily-empty")).toBeTruthy();
  });
});

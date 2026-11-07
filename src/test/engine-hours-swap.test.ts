import { describe, expect, it } from "vitest";
import { cancelOrder, closePosition, metrics, modifyOrder, modifyPosition, newAccount, placeOrder, rollovers, targetReport, tick, type EngineContext } from "@/engine/core";
import { ALWAYS_OPEN, FOREX_HOURS, formatUtc, isMarketOpen, marketState, weekMinute, zoneOffsetMinutes, type TradingHours } from "@/engine/hours";
import type { AccountState, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed, symbolMarketState } from "@/engine/venue";
import { forexMarketOpen, FOREX_PAIRS } from "@/trade-access/instruments";

const at = (iso: string) => Date.parse(iso);
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, swap: { EURUSD: { longPerLot: -7, shortPerLot: 2.5 }, GBPJPY: { longPerLot: 4, shortPerLot: -9, tripleWeekday: 5 } } });
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (now: number, quotes: Quote[]): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });

describe("trading hours", () => {
  it("follows the forex week in New York time, through daylight-saving changes", () => {
    expect(zoneOffsetMinutes("America/New_York", at("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(zoneOffsetMinutes("America/New_York", at("2026-12-01T12:00:00Z"))).toBe(-300);
    // Winter: Sunday 22:00 UTC to Friday 22:00 UTC.
    expect(isMarketOpen(FOREX_HOURS, at("2026-11-08T21:59:00Z"))).toBe(false);
    expect(isMarketOpen(FOREX_HOURS, at("2026-11-08T22:00:00Z"))).toBe(true);
    expect(isMarketOpen(FOREX_HOURS, at("2026-11-13T21:59:00Z"))).toBe(true);
    expect(isMarketOpen(FOREX_HOURS, at("2026-11-13T22:00:00Z"))).toBe(false);
    // Summer: one hour earlier in UTC.
    expect(isMarketOpen(FOREX_HOURS, at("2026-07-05T21:00:00Z"))).toBe(true);
    expect(isMarketOpen(FOREX_HOURS, at("2026-07-10T21:00:00Z"))).toBe(false);
    expect(isMarketOpen(FOREX_HOURS, at("2026-07-08T03:00:00Z"))).toBe(true);
    // Week of the March switch (8 March 2026): Friday before is winter, Friday after is summer.
    expect(isMarketOpen(FOREX_HOURS, at("2026-03-06T21:30:00Z"))).toBe(true);
    expect(isMarketOpen(FOREX_HOURS, at("2026-03-13T21:30:00Z"))).toBe(false);
    // Saturday is always closed; no hours = always open.
    expect(isMarketOpen(FOREX_HOURS, at("2026-11-07T12:00:00Z"))).toBe(false);
    expect(isMarketOpen(undefined, at("2026-11-07T12:00:00Z"))).toBe(true);
    expect(isMarketOpen(ALWAYS_OPEN, at("2026-11-07T12:00:00Z"))).toBe(true);
    // The terminal's open/closed badge uses the same schedule.
    expect(forexMarketOpen(new Date("2026-11-07T12:00:00Z"))).toBe(false);
    expect(forexMarketOpen(new Date("2026-11-09T12:00:00Z"))).toBe(true);
  });

  it("tells when the market opens or closes next", () => {
    expect(marketState(FOREX_HOURS, at("2026-11-07T12:00:00Z"))).toEqual({ open: false, nextChange: at("2026-11-08T22:00:00Z"), reason: "Outside trading hours" });
    expect(marketState(FOREX_HOURS, at("2026-07-04T12:00:00Z")).nextChange).toBe(at("2026-07-05T21:00:00Z"));
    expect(marketState(FOREX_HOURS, at("2026-11-04T10:00:00Z"))).toEqual({ open: true, nextChange: at("2026-11-06T22:00:00Z"), reason: null });
    // Friday 30 October (summer) closes 21:00 UTC; it reopens Sunday 1 November after the switch, at 22:00 UTC.
    expect(marketState(FOREX_HOURS, at("2026-10-31T12:00:00Z")).nextChange).toBe(at("2026-11-01T22:00:00Z"));
    expect(formatUtc(at("2026-11-08T22:00:00Z"))).toBe("Sun 22:00 UTC");
    expect(marketState(undefined, 0)).toEqual({ open: true, nextChange: null, reason: null });
  });

  it("handles host-supplied closures such as holidays", () => {
    const hours: TradingHours = { ...FOREX_HOURS, closures: [{ from: at("2026-11-11T10:00:00Z"), to: at("2026-11-11T12:00:00Z"), reason: "Price provider maintenance" }] };
    expect(isMarketOpen(hours, at("2026-11-11T09:59:00Z"))).toBe(true);
    expect(marketState(hours, at("2026-11-11T11:00:00Z"))).toEqual({ open: false, nextChange: at("2026-11-11T12:00:00Z"), reason: "Price provider maintenance" });
    expect(marketState(hours, at("2026-11-11T08:00:00Z")).nextChange).toBe(at("2026-11-11T10:00:00Z"));
    // A closure that runs into the weekend reopens with the week.
    const friday: TradingHours = { ...FOREX_HOURS, closures: [{ from: at("2026-11-13T12:00:00Z"), to: at("2026-11-14T00:00:00Z"), reason: "Holiday" }] };
    expect(marketState(friday, at("2026-11-13T13:00:00Z"))).toEqual({ open: false, nextChange: at("2026-11-15T22:00:00Z"), reason: "Holiday" });
  });

  it("supports per-symbol hours and refuses malformed windows", () => {
    const short: TradingHours = { timeZone: "UTC", weekly: [1, 2, 3, 4, 5].map(d => ({ from: weekMinute(d, 7), to: weekMinute(d, 16) })) };
    const s = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, hoursBySymbol: { USDTRY: short, EURUSD: null } });
    expect(symbolMarketState(s, "USDTRY", at("2026-11-04T17:00:00Z"))).toEqual({ open: false, nextChange: at("2026-11-05T07:00:00Z"), reason: "Outside trading hours" });
    expect(symbolMarketState(s, "GBPUSD", at("2026-11-04T17:00:00Z")).open).toBe(true);
    expect(s.EURUSD.hours).toBeUndefined();
    expect(s.GBPUSD.hours).toBe(FOREX_HOURS);
    expect(() => symbolMarketState(s, "XAUUSD", 0)).toThrow(/not available/);
    expect(() => marketState({ timeZone: "UTC", weekly: [{ from: 600, to: 300 }] }, 0)).toThrow(RangeError);
  });
});

describe("engine with closed markets", () => {
  const saturday = at("2026-11-07T12:00:00Z");
  const friday = at("2026-11-06T15:00:00Z");
  const monday = at("2026-11-09T08:00:00Z");

  it("refuses to open, change or close while closed but still lets an order be cancelled", () => {
    const open = placeOrder(newAccount("a", rules, friday), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.075 }, ctx(friday, [q("EURUSD", 1.08, 1.0801, friday)]));
    const withOrder = placeOrder(open.state, { symbol: "EURUSD", side: "sell", type: "limit", lots: 1, price: 1.09 }, ctx(friday, [q("EURUSD", 1.08, 1.0801, friday)])).state;
    const c = ctx(saturday, [q("EURUSD", 1.08, 1.0801, saturday)]);
    expect(() => placeOrder(withOrder, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, c)).toThrow("The EURUSD market is closed; it opens Sun 22:00 UTC. Nothing was sent.");
    const pos = withOrder.positions[0].id, ord = withOrder.orders[0].id;
    for (const action of [() => closePosition(withOrder, pos, undefined, c), () => modifyPosition(withOrder, pos, { stopLoss: 1.076 }, c), () => modifyOrder(withOrder, ord, { price: 1.091 }, c)]) {
      expect(action).toThrow(expect.objectContaining({ code: "market_closed" }));
    }
    expect(cancelOrder(withOrder, ord).state.orders).toHaveLength(0);
  });

  it("does not fill or stop out while closed, and fills at the first price after a weekend gap", () => {
    let s = placeOrder(newAccount("a", rules, friday), { symbol: "EURUSD", side: "buy", type: "market", lots: 0.2, stopLoss: 1.075 }, ctx(friday, [q("EURUSD", 1.08, 1.0801, friday)])).state;
    s = placeOrder(s, { symbol: "GBPUSD", side: "buy", type: "stop", lots: 1, price: 1.28 }, ctx(friday, [q("GBPUSD", 1.27, 1.2702, friday), q("EURUSD", 1.08, 1.0801, friday)])).state;
    s = placeOrder(s, { symbol: "USDCHF", side: "buy", type: "limit", lots: 1, price: 0.88 }, ctx(friday, [q("USDCHF", 0.885, 0.8852, friday), q("EURUSD", 1.08, 1.0801, friday)])).state;
    // A (bad) weekend price beyond every level: nothing happens while closed.
    const weekend = tick(s, ctx(saturday, [q("EURUSD", 1.07, 1.0701, saturday), q("GBPUSD", 1.29, 1.2902, saturday), q("USDCHF", 0.87, 0.8702, saturday)]));
    expect(weekend.state.positions).toHaveLength(1);
    expect(weekend.state.orders).toHaveLength(2);
    // Monday open gaps through the stop (1.075) and both pending prices.
    const reopen = tick(weekend.state, ctx(monday, [q("EURUSD", 1.07, 1.0701, monday), q("GBPUSD", 1.29, 1.2902, monday), q("USDCHF", 0.87, 0.8702, monday)]));
    const closed = reopen.state.history.find(d => d.symbol === "EURUSD")!;
    expect(closed).toMatchObject({ reason: "stop_loss", exitPrice: 1.07 }); // the gap price, not the 1.075 level
    const gbp = reopen.state.positions.find(p => p.symbol === "GBPUSD")!;
    const chf = reopen.state.positions.find(p => p.symbol === "USDCHF")!;
    expect(gbp.entryPrice).toBe(1.2902); // stop order: market price after the gap
    expect(chf.entryPrice).toBe(0.8702); // limit: better than its 0.88 price
    expect(reopen.state.orders).toHaveLength(0);
  });

  it("checks loss limits on the first tradable price after the reopen, not on weekend prices", () => {
    const s = placeOrder(newAccount("a", rules, friday), { symbol: "EURUSD", side: "buy", type: "market", lots: 0.6 }, ctx(friday, [q("EURUSD", 1.08, 1.0801, friday)])).state;
    const weekend = tick(s, ctx(saturday, [q("EURUSD", 1.07, 1.0701, saturday)]));
    expect(weekend.state.status).toBe("active");
    expect(weekend.state.positions).toHaveLength(1);
    const reopen = tick(weekend.state, ctx(monday, [q("EURUSD", 1.07, 1.0701, monday)]));
    expect(reopen.state.status).toBe("breached");
    expect(reopen.state.history[0]).toMatchObject({ reason: "daily_loss_limit", exitPrice: 1.07 });
  });

  it("runs through LocalVenue with the default forex hours", async () => {
    let now = saturday;
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 }), new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => now);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    await venue.open("acc");
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    await expect(venue.place("acc", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).rejects.toMatchObject({ code: "market_closed" });
    now = monday; feed.push(q("EURUSD", 1.08, 1.0801, now));
    expect((await venue.place("acc", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).state.positions).toHaveLength(1);
  });
});

describe("swap / rollover", () => {
  it("counts nights per reset: none on weekends, three on the triple day", () => {
    expect(rollovers("2026-11-02", "2026-11-09", 22).map(r => [new Date(r.at).toISOString().slice(0, 16), r.nights])).toEqual([
      ["2026-11-03T22:00", 1], ["2026-11-04T22:00", 3], ["2026-11-05T22:00", 1], ["2026-11-06T22:00", 1], ["2026-11-07T22:00", 0], ["2026-11-08T22:00", 0], ["2026-11-09T22:00", 1],
    ]);
    expect(rollovers("2026-11-04", "2026-11-04", 22)).toEqual([]);
    expect(rollovers("bad", "2026-11-04", 22)).toEqual([]);
  });

  it("charges longs, pays shorts, and settles the swap into the deal and balance", () => {
    const tue = at("2026-11-03T10:00:00Z"), thu = at("2026-11-05T10:00:00Z");
    const quotes = (t: number) => [q("EURUSD", 1.08, 1.0801, t)];
    let s: AccountState = placeOrder(newAccount("a", rules, tue), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx(tue, quotes(tue))).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "sell", type: "market", lots: 0.5 }, ctx(tue, quotes(tue))).state;
    const step = tick(s, ctx(thu, quotes(thu)));
    // Tuesday 22:00 (1 night) + Wednesday 22:00 (3 nights) = 4 nights.
    expect(step.events.filter(e => e.type === "swap_applied")).toEqual([
      { type: "swap_applied", positionId: s.positions[0].id, amount: -28, nights: 4, at: at("2026-11-04T22:00:00Z") },
      { type: "swap_applied", positionId: s.positions[1].id, amount: 5, nights: 4, at: at("2026-11-04T22:00:00Z") },
    ]);
    expect(step.state.positions.map(p => p.swap)).toEqual([-28, 5]);
    expect(step.state.balance).toBe(10000); // swap stays on the position until it closes
    const m = metrics(step.state, ctx(thu, quotes(thu)));
    // Floating: long 1 lot −0.0001 = −10, short 0.5 lot = −5 (spread), swaps −28 + 5.
    expect(m.floatingProfit).toBe(-10 - 5 - 28 + 5);

    const part = closePosition(step.state, s.positions[0].id, 0.5, ctx(thu, quotes(thu)));
    expect(part.state.history[0]).toMatchObject({ swap: -14, netProfit: -5 - 14 });
    expect(part.state.positions[0].swap).toBe(-14);
    expect(part.state.balance).toBe(10000 - 19);
    const report = targetReport(part.state, rules);
    expect(report.profit).toBe(-19);
  });

  it("charges only for resets a position was open through, and nothing without rates", () => {
    const fri = at("2026-11-06T10:00:00Z"), mon = at("2026-11-09T10:00:00Z");
    let s = placeOrder(newAccount("a", rules, fri), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx(fri, [q("EURUSD", 1.08, 1.0801, fri)])).state;
    s = placeOrder(s, { symbol: "GBPUSD", side: "buy", type: "market", lots: 1 }, ctx(fri, [q("GBPUSD", 1.27, 1.2702, fri), q("EURUSD", 1.08, 1.0801, fri)])).state;
    const weekend = tick(s, ctx(mon, [q("EURUSD", 1.08, 1.0801, mon), q("GBPUSD", 1.27, 1.2702, mon)]));
    expect(weekend.state.positions.map(p => p.swap)).toEqual([-7, undefined]); // Friday 22:00 only; GBPUSD has no rate
    // A position opened after a missed reset (no tick in between) is not charged for it.
    const late = at("2026-11-05T09:00:00Z");
    const stale = { ...newAccount("b", rules, at("2026-11-03T10:00:00Z")) };
    const opened = placeOrder(stale, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx(late, [q("EURUSD", 1.08, 1.0801, late)])).state;
    expect(tick(opened, ctx(late + 3_600_000, [q("EURUSD", 1.08, 1.0801, late + 3_600_000)])).state.positions[0].swap).toBeUndefined();
  });

  it("uses each symbol's triple day and validates rates", () => {
    const thu = at("2026-11-05T10:00:00Z"), sat = at("2026-11-07T10:00:00Z");
    const s = placeOrder(newAccount("a", rules, thu), { symbol: "GBPJPY", side: "sell", type: "market", lots: 1 }, ctx(thu, [q("GBPJPY", 195, 195.03, thu), q("USDJPY", 150, 150.02, thu), q("GBPUSD", 1.3, 1.3002, thu)])).state;
    const step = tick(s, ctx(sat, [q("GBPJPY", 195, 195.03, thu), q("USDJPY", 150, 150.02, thu), q("GBPUSD", 1.3, 1.3002, thu)]));
    expect(step.state.positions[0].swap).toBe(-9 * (1 + 3)); // Thursday 22:00 ×1, Friday 22:00 ×3 (triple day 5)
    expect(() => buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, swap: { XAUUSD: { longPerLot: 1, shortPerLot: 1 } } })).toThrow(/not in the catalogue/);
    expect(() => buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, swap: { EURUSD: { longPerLot: Number.NaN, shortPerLot: 1 } } })).toThrow(/must be numbers/);
    expect(() => buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, swap: { EURUSD: { longPerLot: 1, shortPerLot: 1, tripleWeekday: 7 } } })).toThrow(/triple weekday/);
  });
});

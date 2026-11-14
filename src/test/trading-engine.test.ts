import { describe, expect, it, vi } from "vitest";
import { closePosition, metrics, modifyPosition, newAccount, placeOrder, profitUsd, tick, usdPerUnit, type EngineContext } from "@/engine/core";
import { EngineError, type Quote, type RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { createGateway, DisconnectedGateway, GatewayNotConnectedError, HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0, r = rules): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules: r, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });

describe("engine core", () => {
  it("fills buys at the ask and sells at the bid, charging commission", () => {
    const c = ctx([q("EURUSD", 1.08, 1.0801)]);
    const buy = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, c);
    expect(buy.state.positions[0]).toMatchObject({ side: "buy", entryPrice: 1.0801, commission: 3.5 });
    expect(buy.state.balance).toBe(9996.5);
    const sell = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, c);
    expect(sell.state.positions[0].entryPrice).toBe(1.08);
  });

  it("values profit in dollars for every kind of pair", () => {
    const book = Object.fromEntries([q("USDJPY", 150, 150.02), q("GBPUSD", 1.27, 1.2702)].map(x => [x.symbol, x]));
    expect(usdPerUnit(book, "JPY")).toBeCloseTo(1 / 150.01, 8);
    expect(profitUsd(specs.EURUSD, "buy", 1, 1.08, 1.081, book)).toBe(100);
    expect(profitUsd(specs.USDJPY, "sell", 1, 150.5, 150, book)).toBe(333.31); // 50,000 JPY at 150.01
    expect(profitUsd(specs.EURGBP, "buy", 0.5, 0.85, 0.851, book)).toBe(63.51); // 50 GBP at 1.2701
    expect(() => usdPerUnit(book, "ZAR")).toThrow(EngineError);
  });

  it("refuses bad volumes, prices, protection, stale quotes and missing margin", () => {
    const c = ctx([q("EURUSD", 1.08, 1.0801)]), a = newAccount("a", rules, T0);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.005 }, c)).toThrow(/between 0.01/);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.015 }, c)).toThrow(/steps of 0.01/);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.081 }, c)).toThrow(/below/);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, takeProfit: 1.07 }, c)).toThrow(/above/);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.079999 }, c)).toThrow(/steps of 0.00001/);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx([q("EURUSD", 1.08, 1.0801, T0 - 10_000)]))).toThrow(/out of date/);
    expect(() => placeOrder(a, { symbol: "XAUUSD", side: "buy", type: "market", lots: 1 }, c)).toThrow(/not available/);
    expect(() => placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 50 }, c)).toThrow(/free margin/); // 50 lots ≈ $180K margin at 1:30
  });

  it("is idempotent for a repeated client id", () => {
    const c = ctx([q("EURUSD", 1.08, 1.0801)]);
    const once = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "k1" }, c);
    const twice = placeOrder(once.state, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "k1" }, c);
    expect(twice.state.positions).toHaveLength(1);
    expect(twice.events).toEqual([]);
  });

  it("works out equity, margin and the loss floors", () => {
    const opened = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    const m = metrics(opened.state, ctx([q("EURUSD", 1.079, 1.0791)]));
    expect(m).toMatchObject({ balance: 9996.5, floatingProfit: -110, equity: 9886.5, margin: 3596.83, dailyLossFloor: 9500, maxLossFloor: 9000, profitTargetBalance: 10800 });
    expect(m.roomToFloor).toBe(386.5);
  });

  it("closes partially and fully with a dealt history", () => {
    const opened = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    const id = opened.state.positions[0].id, later = ctx([q("EURUSD", 1.0811, 1.0812)]);
    const half = closePosition(opened.state, id, 0.5, later);
    expect(half.state.positions[0].lots).toBe(0.5);
    expect(half.state.history[0]).toMatchObject({ lots: 0.5, exitPrice: 1.0811, grossProfit: 50, commission: 3.5, netProfit: 46.5, reason: "manual" });
    const all = closePosition(half.state, id, undefined, later);
    expect(all.state.positions).toHaveLength(0);
    expect(all.state.balance).toBe(10093); // 10000 + 100 gross - 7 commission
  });

  it("closes at stop loss and take profit on a tick", () => {
    const opened = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "sell", type: "market", lots: 1, stopLoss: 1.081, takeProfit: 1.078 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    const stopped = tick(opened.state, ctx([q("EURUSD", 1.081, 1.0811, T0 + 1000)], T0 + 1000));
    expect(stopped.state.history[0]).toMatchObject({ reason: "stop_loss", exitPrice: 1.0811 });
    const target = tick(opened.state, ctx([q("EURUSD", 1.0778, 1.0779, T0 + 1000)], T0 + 1000));
    expect(target.state.history[0]).toMatchObject({ reason: "take_profit", exitPrice: 1.0779 });
  });

  it("fills limit orders at their price or better and stop orders at the market", () => {
    const c = ctx([q("EURUSD", 1.08, 1.0801)]);
    expect(() => placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.081 }, c)).toThrow(/below/);
    const placed = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 }, c);
    expect(placed.state.orders).toHaveLength(1);
    const filled = tick(placed.state, ctx([q("EURUSD", 1.0785, 1.0786, T0 + 1000)], T0 + 1000));
    expect(filled.state.orders).toHaveLength(0);
    expect(filled.state.positions[0].entryPrice).toBe(1.0786);
    expect(filled.events.map(e => e.type)).toContain("order_triggered");
    const stop = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "sell", type: "stop", lots: 1, price: 1.079 }, c);
    expect(tick(stop.state, ctx([q("EURUSD", 1.0785, 1.0786, T0 + 1000)], T0 + 1000)).state.positions[0].entryPrice).toBe(1.0785);
  });

  it("closes everything and locks the account when a loss limit is hit", () => {
    const opened = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 2 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    const crash = tick(opened.state, ctx([q("EURUSD", 1.0775, 1.0776, T0 + 1000)], T0 + 1000)); // -$520 floating, equity $9,473 below the $9,500 daily floor
    expect(crash.state.status).toBe("breached");
    expect(crash.state.breachReason).toBe("daily_loss_limit");
    expect(crash.state.positions).toHaveLength(0);
    expect(() => placeOrder(crash.state, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx([q("EURUSD", 1.08, 1.0801, T0 + 2000)], T0 + 2000))).toThrow(/loss limit/);
  });

  it("resets the trading day at 22:00 UTC from the balance at the reset", () => {
    const a = { ...newAccount("a", rules, T0), balance: 10200 };
    const next = tick(a, ctx([], Date.parse("2026-11-04T22:00:01Z")));
    expect(next.state).toMatchObject({ tradingDay: "2026-11-04", dayStartBalance: 10200 });
    expect(metrics(next.state, ctx([])).dailyLossFloor).toBe(9690);
  });

  it("reports the profit target once, for review", () => {
    const a = { ...newAccount("a", rules, T0), balance: 10850, tradingDays: ["2026-11-03"] };
    const step = tick(a, ctx([]));
    expect(step.events.map(e => e.type)).toEqual(["target_reached"]);
    expect(step.state.status).toBe("active");
    expect(tick(step.state, ctx([])).events).toEqual([]);
  });

  it("moves protection only to valid levels", () => {
    const opened = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx([q("EURUSD", 1.08, 1.0801)]));
    const id = opened.state.positions[0].id;
    expect(modifyPosition(opened.state, id, { stopLoss: 1.079 }, ctx([q("EURUSD", 1.08, 1.0801)])).state.positions[0].stopLoss).toBe(1.079);
    expect(() => modifyPosition(opened.state, id, { stopLoss: 1.0805 }, ctx([q("EURUSD", 1.08, 1.0801)]))).toThrow(/below/);
  });
});

describe("venue and gateways", () => {
  it("runs accounts end to end once a price feed is plugged in", async () => {
    let now = T0;
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 5000 }, () => now);
    const feed = new StaticQuoteFeed();
    venue.connect(feed);
    const events: string[] = [];
    venue.onEvents((_id, e) => events.push(...e.map(x => x.type)));
    const gw = new LocalGatewayAdapter(venue);
    expect((await gw.status()).priceFeed).toBe(false);
    await venue.open("acc");
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    expect((await gw.status()).execution).toBe(true);
    const snap = await gw.placeOrder("acc", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, takeProfit: 1.082 });
    expect(snap.state.positions).toHaveLength(1);
    now += 1000; feed.push(q("EURUSD", 1.0821, 1.0822, now));
    const after = await gw.snapshot("acc");
    expect(after.state.positions).toHaveLength(0);
    expect(after.state.history[0].reason).toBe("take_profit");
    expect(events).toEqual(["position_opened", "position_closed"]);
  });

  it("reports not connected without an API address", async () => {
    const gw = createGateway(undefined, async () => null);
    expect(gw).toBeInstanceOf(DisconnectedGateway);
    expect(createGateway("ftp://x", async () => null).mode).toBe("disconnected");
    expect(createGateway("https://api.example.com", async () => null).mode).toBe("remote");
    await expect(gw.placeOrder("a", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).rejects.toBeInstanceOf(GatewayNotConnectedError);
  });

  it("speaks the documented HTTP contract", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ state: {}, metrics: {}, quotes: {} }), { status: 200 }));
    const gw = new HttpGateway("https://api.example.com/", async () => "tok", fetcher);
    await gw.placeOrder("acc 1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "k" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/accounts/acc%201/orders");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer tok", "Idempotency-Key": "k", "Content-Type": "application/json" } });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "no_margin", message: "Not enough free margin" } }), { status: 422 }));
    await expect(gw.closePosition("acc", "p1")).rejects.toMatchObject({ code: "no_margin", message: "Not enough free margin" });
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    await expect(gw.cancelOrder("acc", "o1")).rejects.toMatchObject({ code: "network" });
  });
});

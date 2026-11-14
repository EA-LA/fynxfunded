import { describe, expect, it, vi } from "vitest";
import { cancelOrder, modifyOrder, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import type { Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { DisconnectedGateway, HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { orderChange, pendingErrors, pipsAway } from "@/trade-access/protection";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });
const market = ctx([q("EURUSD", 1.08, 1.0801)]);
const withLimit = () => placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, stopLoss: 1.077, takeProfit: 1.083 }, market).state;

describe("engine: modify a pending order", () => {
  it("moves the price and levels, keeps the rest and emits order_modified", () => {
    const state = withLimit(), id = state.orders[0].id;
    const step = modifyOrder(state, id, { price: 1.0785, stopLoss: 1.0765, takeProfit: null }, market);
    expect(step.state.orders[0]).toMatchObject({ id, side: "buy", type: "limit", lots: 1, price: 1.0785, stopLoss: 1.0765 });
    expect(step.state.orders[0].takeProfit).toBeUndefined();
    expect(step.state.sequence).toBe(state.sequence + 1);
    expect(step.events).toEqual([{ type: "order_modified", order: step.state.orders[0] }]);
    expect(state.orders[0].price).toBe(1.079); // input untouched
  });

  it("changes nothing when the values are the same", () => {
    const state = withLimit();
    const step = modifyOrder(state, state.orders[0].id, { price: 1.079, stopLoss: 1.077 }, market);
    expect(step.state).toBe(state);
    expect(step.events).toEqual([]);
  });

  it("applies the same checks as a new order", () => {
    const state = withLimit(), id = state.orders[0].id;
    expect(() => modifyOrder(state, id, { price: 1.0805 }, market)).toThrow(/buy limit must be below/);
    expect(() => modifyOrder(state, id, { stopLoss: 1.0795 }, market)).toThrow(/Stop loss must be below 1.079/);
    expect(() => modifyOrder(state, id, { takeProfit: 1.0785 }, market)).toThrow(/Take profit must be above/);
    expect(() => modifyOrder(state, id, { price: 1.078999 }, market)).toThrow(/steps of 0.00001/);
    // Moving the price under the old stop makes the stop invalid
    expect(() => modifyOrder(state, id, { price: 1.0765 }, market)).toThrow(/Stop loss must be below 1.0765/);
    expect(() => modifyOrder(state, "missing", { price: 1.078 }, market)).toThrow(/not pending/);
    expect(() => modifyOrder(state, id, { price: 1.078 }, ctx([q("EURUSD", 1.08, 1.0801, T0 - 60_000)]))).toThrow();
    expect(() => modifyOrder({ ...state, status: "breached" }, id, { price: 1.078 }, market)).toThrow(/loss limit/);
  });

  it("checks sell stops against the bid and fills at the new price", () => {
    const placed = placeOrder(newAccount("a", rules, T0), { symbol: "USDJPY", side: "sell", type: "stop", lots: 0.5, price: 149.5 }, ctx([q("USDJPY", 150, 150.02)])).state;
    const id = placed.orders[0].id, c = ctx([q("USDJPY", 150, 150.02)]);
    expect(() => modifyOrder(placed, id, { price: 150.1 }, c)).toThrow(/sell stop must be below/);
    const moved = modifyOrder(placed, id, { price: 149.8, stopLoss: 150.3 }, c).state;
    const filled = tick(moved, ctx([q("USDJPY", 149.79, 149.81, T0 + 1000)], T0 + 1000));
    expect(filled.state.orders).toEqual([]);
    expect(filled.state.positions[0]).toMatchObject({ side: "sell", lots: 0.5, stopLoss: 150.3 });
    expect(cancelOrder(moved, id).state.orders).toEqual([]);
  });

  it("works through the venue and every gateway", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const feed = new StaticQuoteFeed(); venue.connect(feed); feed.push(q("EURUSD", 1.08, 1.0801));
    await venue.open("acc");
    const placed = await venue.place("acc", { symbol: "EURUSD", side: "sell", type: "limit", lots: 0.2, price: 1.082 });
    const gw = new LocalGatewayAdapter(venue);
    const events = vi.fn(); venue.onEvents(events);
    const snap = await gw.modifyOrder("acc", placed.state.orders[0].id, { price: 1.0825, takeProfit: 1.0805 });
    expect(snap.state.orders[0]).toMatchObject({ price: 1.0825, takeProfit: 1.0805 });
    expect(events).toHaveBeenCalledWith("acc", [expect.objectContaining({ type: "order_modified" })]);
    await expect(new DisconnectedGateway().modifyOrder()).rejects.toMatchObject({ code: "not_connected" });

    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ state: {}, metrics: {}, quotes: {} }), { status: 200 }));
    await new HttpGateway("https://api.example.com", async () => "tok", fetcher).modifyOrder("acc 1", "ord/2", { price: 1.08, stopLoss: null });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/accounts/acc%201/orders/ord%2F2");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ price: 1.08, stopLoss: null }) });
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

describe("terminal: pending order helpers", () => {
  it("mirrors the engine's side checks with plain messages", () => {
    expect(pendingErrors("buy", "limit", 1.0801, 1.079, 1.077, 1.083, 5)).toEqual([]);
    expect(pendingErrors("buy", "limit", 1.0801, 1.081, null, null, 5)[0]).toMatch(/buy limit must be below the current ask 1.08010; otherwise use a stop order/);
    expect(pendingErrors("sell", "limit", 1.08, 1.079, null, null, 5)[0]).toMatch(/sell limit must be above the current bid/);
    expect(pendingErrors("sell", "stop", undefined, 1.079, 1.078, 1.08, 5)).toEqual(["Stop loss must be above the order price 1.07900.", "Take profit must be below the order price 1.07900."]);
    expect(pipsAway(1.079, 1.0801, 0.0001)).toBe(11);
    expect(pipsAway(149.5, 150, 0.01)).toBe(50);
    expect(orderChange({ price: 1.079, stopLoss: 1.077 }, { price: 1.079, stopLoss: 1.077, takeProfit: null })).toEqual({});
    expect(orderChange({ price: 1.079, takeProfit: 1.083 }, { price: 1.0785, stopLoss: 1.0765, takeProfit: null })).toEqual({ price: 1.0785, stopLoss: 1.0765, takeProfit: null });
  });
});

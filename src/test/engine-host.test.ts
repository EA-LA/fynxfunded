import { describe, expect, it, vi } from "vitest";
import type { RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway } from "@/engine/gateway";
import { handleEngineRequest, parseOrderRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };

async function setup(enabled = true) {
  const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
  const feed = new StaticQuoteFeed(); venue.connect(feed);
  feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
  await venue.open("acc_1"); await venue.open("acc_2");
  const trading = { enabled };
  const opts: HostOptions = {
    venue,
    verifyToken: async t => (t === "good" ? "u1" : t === "other" ? "u2" : null),
    canAccess: async (u, a) => u === "u1" && a === "acc_1",
    tradingEnabled: async () => trading.enabled,
    status: () => ({ priceFeed: true, execution: true, message: "ok" }),
  };
  // A fetch that goes straight into the host, so HttpGateway is tested against the real handler.
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const r = await handleEngineRequest({ method: init?.method ?? "GET", path: u.pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  return { venue, opts, trading, gw: new HttpGateway("https://api.example.com", async () => "good", fetcher), fetcher };
}

describe("engine host (HTTP contract skeleton)", () => {
  it("serves every endpoint of the contract to HttpGateway", async () => {
    const { gw } = await setup();
    expect(await gw.status()).toMatchObject({ connected: true, priceFeed: true, execution: true, message: "ok" });
    expect((await gw.status()).markets?.EURUSD).toEqual({ open: true, nextChange: Date.parse("2026-11-06T22:00:00Z"), reason: null });
    expect((await gw.snapshot("acc_1")).state.accountId).toBe("acc_1");
    const placed = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c-1" });
    const pos = placed.state.positions[0];
    expect(pos).toMatchObject({ entryPrice: 1.0801, clientId: "c-1" });
    expect((await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c-1" })).state.positions).toHaveLength(1); // replay
    expect((await gw.modifyPosition("acc_1", pos.id, { stopLoss: 1.079 })).state.positions[0].stopLoss).toBe(1.079);
    expect((await gw.modifyPosition("acc_1", pos.id, { stopLoss: null })).state.positions[0].stopLoss).toBeUndefined();
    expect((await gw.closePosition("acc_1", pos.id, 0.4)).state.positions[0].lots).toBe(0.6);
    const pending = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.5, price: 1.079 });
    const ord = pending.state.orders[0];
    expect((await gw.modifyOrder("acc_1", ord.id, { price: 1.0785, takeProfit: 1.0835 })).state.orders[0]).toMatchObject({ price: 1.0785, takeProfit: 1.0835 });
    expect((await gw.cancelOrder("acc_1", ord.id)).state.orders).toEqual([]);
    const closed = await gw.closePosition("acc_1", pos.id);
    expect(closed.state.positions).toEqual([]);
    expect(closed.report).toBeDefined();
  });

  it("passes engine errors through with their code", async () => {
    const { gw } = await setup();
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1000 })).rejects.toMatchObject({ code: "bad_volume" });
    await expect(gw.cancelOrder("acc_1", "nope")).rejects.toMatchObject({ code: "no_order", message: "That order is not pending." });
  });

  it("refuses missing or bad tokens and other people's accounts", async () => {
    const { opts } = await setup();
    const get = (headers: Record<string, string>, path = "/v1/accounts/acc_1") => handleEngineRequest({ method: "GET", path, headers }, opts);
    expect((await get({})).status).toBe(401);
    expect((await get({ Authorization: "Bearer bad" })).status).toBe(401);
    expect((await get({ authorization: "Bearer other" })).status).toBe(403);
    expect(await get({ Authorization: "Bearer good" }, "/v1/accounts/acc_2")).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    expect((await get({ Authorization: "Bearer good" }, "/v1/nothing")).status).toBe(404);
    expect((await handleEngineRequest({ method: "PUT", path: "/v1/accounts/acc_1/orders", headers: { Authorization: "Bearer good" } }, opts)).status).toBe(405);
  });

  it("never opens or changes orders while trading is switched off, but still lets risk be reduced", async () => {
    const { gw, venue, trading } = await setup(true);
    const placed = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "sell", type: "market", lots: 0.2 });
    const pending = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "sell", type: "limit", lots: 0.2, price: 1.082 });
    trading.enabled = false;
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).rejects.toMatchObject({ code: "trading_disabled" });
    await expect(gw.modifyOrder("acc_1", pending.state.orders[0].id, { price: 1.083 })).rejects.toMatchObject({ code: "trading_disabled" });
    await expect(gw.modifyPosition("acc_1", placed.state.positions[0].id, { stopLoss: 1.09 })).rejects.toMatchObject({ code: "trading_disabled" });
    expect((await gw.cancelOrder("acc_1", pending.state.orders[0].id)).state.orders).toEqual([]);
    expect((await gw.closePosition("acc_1", placed.state.positions[0].id)).state.positions).toEqual([]);
    expect((await venue.snapshot("acc_1")).state.history).toHaveLength(1);
  });

  it("reads bodies strictly", async () => {
    expect(parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "market", lots: 0.1 }, "k-1")).toEqual({ symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, clientId: "k-1" });
    expect(() => parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, clientId: "a" }, "b")).toThrow(/differ/);
    expect(() => parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "market", lots: "1" })).toThrow(/lots must be a number/);
    expect(() => parseOrderRequest({ symbol: "eur", side: "buy", type: "market", lots: 1 })).toThrow(/symbol/);
    expect(() => parseOrderRequest({ symbol: "EURUSD", side: "long", type: "market", lots: 1 })).toThrow(/side/);
    expect(() => parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLos: 1 })).toThrow(/Unknown field: stopLos/);
    const { opts } = await setup();
    const patch = (body: unknown) => handleEngineRequest({ method: "PATCH", path: "/v1/accounts/acc_1/orders/o1", headers: { Authorization: "Bearer good" }, body }, opts);
    expect(await patch({})).toMatchObject({ status: 400, body: { error: { message: "Nothing to change." } } });
    expect(await patch({ lots: 2 })).toMatchObject({ status: 400, body: { error: { message: "Unknown field: lots." } } });
    expect(await patch({ price: null })).toMatchObject({ status: 400 });
    const crash = await handleEngineRequest({ method: "GET", path: "/v1/accounts/acc_1", headers: { Authorization: "Bearer good" } }, { ...opts, canAccess: async () => { throw new Error("db down"); } });
    expect(crash).toMatchObject({ status: 500, body: { error: { code: "server_error" } } });
  });
});

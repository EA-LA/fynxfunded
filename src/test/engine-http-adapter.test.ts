import { describe, expect, it, vi } from "vitest";
import type { RuleSet } from "@/engine/types";
import { MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { createEngineServer } from "@/engine/server";
import { HttpGateway } from "@/engine/gateway";
import { createHttpHandler, checkAllowedOrigins, type NodeLikeRequest, type RequestLog } from "@/engine/http-adapter";
import { readEngineConfig } from "@/engine/config";
import { handleEngineRequest } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const SITE = "https://www.fynxfunded.com";
const rules: RuleSet = { startingBalance: 25000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22 };

function setup(extra: { openOnFirstVisit?: boolean; basePath?: string; rulesFor?: (id: string) => Promise<RuleSet> } = {}) {
  const feed = new StaticQuoteFeed();
  const store = new MemoryStore();
  const engine = createEngineServer({
    pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 },
    store, rulesFor: extra.rulesFor ?? (async () => rules), feed, accounts: async () => [],
    verifyToken: async t => (t === "good" ? "u1" : null),
    canAccess: async (u, a) => u === "u1" && a.startsWith("acc_"),
    tradingEnabled: async () => true,
    openOnFirstVisit: extra.openOnFirstVisit,
    clock: () => T0,
  });
  engine.start();
  feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
  const logs: RequestLog[] = [];
  const handler = createHttpHandler(engine, { allowedOrigins: [SITE], basePath: extra.basePath, log: l => logs.push(l), clock: () => T0 });
  return { engine, handler, logs, store };
}

/** Sends one request through the adapter like node:http would (body streamed in chunks). */
async function call(handler: ReturnType<typeof createHttpHandler>, method: string, url: string, headers: Record<string, string> = {}, body?: string | Uint8Array, extra: Partial<NodeLikeRequest> = {}) {
  const chunks = body === undefined ? [] : typeof body === "string" ? [body.slice(0, 5), body.slice(5)] : [body];
  const req: NodeLikeRequest = { method, url, headers, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; }, ...extra };
  const out = { statusCode: 0, headers: {} as Record<string, string>, text: "" };
  await handler(req, { set statusCode(v: number) { out.statusCode = v; }, get statusCode() { return out.statusCode; }, setHeader: (n, v) => { out.headers[n.toLowerCase()] = v; }, end: b => { out.text = b ?? ""; } });
  return { status: out.statusCode, headers: out.headers, body: out.text ? JSON.parse(out.text) : undefined };
}

/** A fetch that goes through the adapter, so HttpGateway is tested against the real HTTP layer. */
function adapterFetch(handler: ReturnType<typeof createHttpHandler>, origin = SITE) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const headers = { ...(init?.headers as Record<string, string>), Origin: origin };
    const r = await call(handler, init?.method ?? "GET", u.pathname + u.search, headers, init?.body ? String(init.body) : undefined);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
}

describe("HTTP adapter: browser access (CORS)", () => {
  it("answers the browser's preflight for the FYNX website only", async () => {
    const { handler } = setup();
    const ok = await call(handler, "OPTIONS", "/v1/accounts/acc_1/orders", { Origin: SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,idempotency-key" });
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe(SITE);
    expect(ok.headers["access-control-allow-methods"]).toBe("GET, POST, PATCH, DELETE");
    expect(ok.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type, Idempotency-Key, Accept");
    expect(ok.headers.vary).toBe("Origin");

    const other = await call(handler, "OPTIONS", "/v1/accounts/acc_1/orders", { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" });
    expect(other.status).toBe(403);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    expect(other.body.error.code).toBe("origin_not_allowed");

    expect((await call(handler, "OPTIONS", "/v1/status", { Origin: SITE, "Access-Control-Request-Method": "PUT" })).status).toBe(405);
  });

  it("refuses other websites even with a valid token, and never runs their request", async () => {
    const { handler, engine } = setup();
    const spy = vi.spyOn(engine.venue, "place");
    const r = await call(handler, "POST", "/v1/accounts/acc_1/orders", { Origin: "https://fynxfunded.com.evil.example", Authorization: "Bearer good", "Content-Type": "application/json" }, JSON.stringify({ symbol: "EURUSD", side: "buy", type: "market", lots: 1 }));
    expect(r.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("lets server-to-server calls (no Origin) through, still behind sign-in", async () => {
    const { handler } = setup();
    expect((await call(handler, "GET", "/v1/status")).status).toBe(401);
    const r = await call(handler, "GET", "/v1/status", { authorization: "Bearer good" });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.body).toMatchObject({ priceFeed: true });
  });

  it("checks the origin list when the server starts", () => {
    expect(checkAllowedOrigins([SITE, SITE, "http://localhost:5173"])).toEqual([SITE, "http://localhost:5173"]);
    for (const bad of [[], ["*"], ["https://www.fynxfunded.com/"], ["http://www.fynxfunded.com"], ["https://www.fynxfunded.com/trade"]]) {
      expect(() => checkAllowedOrigins(bad)).toThrow(expect.objectContaining({ code: "bad_settings" }));
    }
  });
});

describe("HTTP adapter: the whole contract over HTTP", () => {
  it("serves the terminal's gateway end to end from the FYNX website", async () => {
    const { handler, logs } = setup();
    const gw = new HttpGateway("https://engine.example.com", async () => "good", adapterFetch(handler));
    expect(await gw.status()).toMatchObject({ connected: true, priceFeed: true });
    // First visit opens the purchased account with its rules (no separate setup step).
    const first = await gw.snapshot("acc_new");
    expect(first.state).toMatchObject({ accountId: "acc_new", balance: 25000 });
    const placed = await gw.placeOrder("acc_new", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c-1" });
    const pos = placed.state.positions[0];
    expect(pos.entryPrice).toBe(1.0801);
    expect((await gw.modifyPosition("acc_new", pos.id, { stopLoss: 1.079 })).state.positions[0].stopLoss).toBe(1.079);
    expect((await gw.closePosition("acc_new", pos.id, 0.5)).state.positions[0].lots).toBe(0.5);
    expect((await gw.closePosition("acc_new", pos.id)).state.positions).toEqual([]);
    await expect(gw.placeOrder("acc_new", { symbol: "EURUSD", side: "buy", type: "market", lots: 1000 })).rejects.toMatchObject({ code: "bad_volume" });
    expect(logs.some(l => l.code === "bad_volume" && l.status === 422)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("good"); // the token is never logged
  });

  it("puts the engine on the watch list after an order", async () => {
    const { handler, engine } = setup();
    await engine.venue.open("acc_1");
    const watch = vi.spyOn(engine.runner, "watch");
    await call(handler, "POST", "/v1/accounts/acc_1/orders", { Authorization: "Bearer good", "Content-Type": "application/json" }, JSON.stringify({ symbol: "EURUSD", side: "buy", type: "market", lots: 0.1 }));
    expect(watch).toHaveBeenCalledWith("acc_1");
  });

  it("serves under a base path", async () => {
    const { handler } = setup({ basePath: "/engine" });
    expect((await call(handler, "GET", "/engine/v1/status", { Authorization: "Bearer good" })).status).toBe(200);
    expect((await call(handler, "GET", "/v1/status", { Authorization: "Bearer good" })).status).toBe(404);
    expect((await call(handler, "GET", "/engineering/v1/status", { Authorization: "Bearer good" })).status).toBe(404);
    expect((await call(handler, "GET", "/engine/healthz")).status).toBe(200);
  });

  it("passes the history page number through", async () => {
    const { handler } = setup();
    await call(handler, "GET", "/v1/accounts/acc_1", { Authorization: "Bearer good" });
    const r = await call(handler, "GET", "/v1/accounts/acc_1/history?chunk=0", { Authorization: "Bearer good" });
    expect(r.body.error.code).toBe("no_chunk");
  });
});

describe("HTTP adapter: request bodies", () => {
  const headers = { Authorization: "Bearer good", "Content-Type": "application/json" };

  it("refuses bodies that are too large, not JSON, or malformed", async () => {
    const { handler } = setup();
    const big = JSON.stringify({ symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "x".repeat(20_000) });
    expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", headers, big)).body.error.code).toBe("too_large");
    expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", headers, big)).status).toBe(413);
    const form = await call(handler, "POST", "/v1/accounts/acc_1/orders", { Authorization: "Bearer good", "Content-Type": "text/plain" }, "symbol=EURUSD");
    expect(form.status).toBe(415);
    const broken = await call(handler, "POST", "/v1/accounts/acc_1/orders", headers, "{ not json");
    expect(broken).toMatchObject({ status: 400, body: { error: { code: "bad_request" } } });
  });

  it("uses bodies already read by Express or Firebase", async () => {
    const { handler, engine } = setup();
    await engine.venue.open("acc_1"); await engine.venue.open("acc_2");
    const order = { symbol: "EURUSD", side: "buy", type: "market", lots: 0.2 };
    const express = await call(handler, "POST", "/v1/accounts/acc_1/orders", headers, undefined, { body: order });
    expect(express.status).toBe(200);
    expect(express.body.state.positions).toHaveLength(1);
    const firebase = await call(handler, "POST", "/v1/accounts/acc_2/orders", headers, undefined, { rawBody: new TextEncoder().encode(JSON.stringify(order)) });
    expect(firebase.body.state.positions).toHaveLength(1);
  });

  it("closes a position with an empty body", async () => {
    const { handler, engine } = setup();
    await engine.venue.open("acc_1");
    const placed = await call(handler, "POST", "/v1/accounts/acc_1/orders", headers, JSON.stringify({ symbol: "EURUSD", side: "sell", type: "market", lots: 0.3 }));
    const id = placed.body.state.positions[0].id;
    const closed = await call(handler, "POST", `/v1/accounts/acc_1/positions/${id}/close`, { Authorization: "Bearer good" });
    expect(closed.status).toBe(200);
    expect(closed.body.state.positions).toEqual([]);
  });

  it("sets safe headers and refuses unknown methods", async () => {
    const { handler } = setup();
    const r = await call(handler, "GET", "/v1/status", { Authorization: "Bearer good" });
    expect(r.headers).toMatchObject({ "cache-control": "no-store", "x-content-type-options": "nosniff", "content-type": "application/json; charset=utf-8" });
    expect((await call(handler, "PUT", "/v1/status", { Authorization: "Bearer good" })).status).toBe(405);
  });

  it("answers a 500 in the contract's shape if the engine itself throws", async () => {
    const handler = createHttpHandler({ handle: async () => { throw new Error("boom"); }, status: () => ({ priceFeed: false, execution: false, message: "", runner: {} as never }) }, { allowedOrigins: [SITE] });
    const r = await call(handler, "GET", "/v1/status", { Authorization: "Bearer good" });
    expect(r).toMatchObject({ status: 500, body: { error: { code: "server_error" } } });
  });
});

describe("HTTP adapter: health address", () => {
  it("reports feed and execution without sign-in and without account data", async () => {
    const { handler } = setup();
    const r = await call(handler, "GET", "/healthz");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["execution", "ok", "priceFeed"]);
    expect((await call(handler, "POST", "/healthz")).status).toBe(405);
  });
});

describe("first visit opens the account", () => {
  it("opens once with the purchased rules, even when two first visits race", async () => {
    const rulesFor = vi.fn(async () => rules);
    const { engine } = setup({ rulesFor });
    const req = { method: "GET", path: "/v1/accounts/acc_9", headers: { authorization: "Bearer good" } };
    const [a, b] = await Promise.all([engine.handle(req), engine.handle(req)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((a.body as { state: { balance: number } }).state.balance).toBe(25000);
  });

  it("can be turned off, and never opens accounts for someone else", async () => {
    const off = setup({ openOnFirstVisit: false });
    expect((await off.engine.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: { authorization: "Bearer good" } })).status).toBe(404);
    const on = setup();
    const r = await on.engine.handle({ method: "GET", path: "/v1/accounts/other_1", headers: { authorization: "Bearer good" } });
    expect(r.status).toBe(403);
    expect(await on.store.load("other_1")).toBeNull();
  });

  it("does not open accounts on an order to an unknown account", async () => {
    const { engine, store } = setup();
    const r = await handleEngineRequest({ method: "POST", path: "/v1/accounts/acc_x/orders", headers: { authorization: "Bearer good" }, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } }, {
      venue: engine.venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "" }),
    });
    expect(r.status).toBe(404);
    expect(await store.load("acc_x")).toBeNull();
  });
});

describe("settings from environment variables", () => {
  const env = {
    FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50",
    FYNX_ENGINE_ALLOWED_ORIGINS: "https://www.fynxfunded.com, https://fynxfunded.com",
  };

  it("reads a complete configuration", () => {
    const c = readEngineConfig({
      ...env, FYNX_ENGINE_MAX_QUOTE_AGE_MS: "10000", FYNX_ENGINE_BASE_PATH: "/engine",
      FYNX_ENGINE_SWAP: JSON.stringify({ EURUSD: { longPerLot: -6.2, shortPerLot: 1.1 } }),
      FYNX_ENGINE_CLOSURES: JSON.stringify([{ from: "2027-01-01T00:00:00Z", to: "2027-01-02T00:00:00Z", reason: "New Year's Day" }, { from: "2026-12-25T00:00:00Z", to: "2026-12-26T00:00:00Z", reason: "Christmas Day" }]),
    }, FOREX_PAIRS);
    expect(c.settings).toMatchObject({ leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 10000, swap: { EURUSD: { longPerLot: -6.2, shortPerLot: 1.1 } } });
    expect(c.settings.hours?.closures?.map(x => x.reason)).toEqual(["Christmas Day", "New Year's Day"]);
    expect(c.settings.hours?.timeZone).toBe("America/New_York");
    expect(c.http).toEqual({ allowedOrigins: ["https://www.fynxfunded.com", "https://fynxfunded.com"], basePath: "/engine" });
  });

  it("uses the standard forex week and a 15 s quote age when the optional values are left out", () => {
    const c = readEngineConfig(env, FOREX_PAIRS);
    expect(c.settings.maxQuoteAgeMs).toBe(15000);
    expect(c.settings.hours).toBeUndefined();
    expect(c.settings.swap).toBeUndefined();
  });

  it("lists every missing or wrong value at once instead of starting half-configured", () => {
    let message = "";
    try { readEngineConfig({ FYNX_ENGINE_LEVERAGE: "30.5", FYNX_ENGINE_MAX_LOTS: "-1", FYNX_ENGINE_ALLOWED_ORIGINS: "*", FYNX_ENGINE_SWAP: "{bad", FYNX_ENGINE_CLOSURES: JSON.stringify([{ from: "2026-12-26T00:00:00Z", to: "2026-12-25T00:00:00Z", reason: "x" }]) }, FOREX_PAIRS); }
    catch (e) { expect(e).toMatchObject({ code: "bad_settings" }); message = (e as Error).message; }
    for (const part of ["FYNX_ENGINE_LEVERAGE must be a whole number", "FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE is missing", "FYNX_ENGINE_MAX_LOTS must be a number", "FYNX_ENGINE_ALLOWED_ORIGINS", "FYNX_ENGINE_SWAP is not valid JSON", "\"to\" must be after \"from\""]) expect(message).toContain(part);
  });

  it("refuses swap rates for pairs the platform does not list", () => {
    expect(() => readEngineConfig({ ...env, FYNX_ENGINE_SWAP: JSON.stringify({ XAUUSD: { longPerLot: -1, shortPerLot: -1 } }) }, FOREX_PAIRS)).toThrow(/XAUUSD/);
    expect(() => readEngineConfig({ ...env, FYNX_ENGINE_SWAP: JSON.stringify({ EURUSD: { longPerLot: "-1", shortPerLot: 1 } }) }, FOREX_PAIRS)).toThrow(/EURUSD needs/);
  });
});

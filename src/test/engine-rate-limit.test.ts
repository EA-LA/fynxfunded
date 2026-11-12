import { describe, expect, it, vi } from "vitest";
import type { RuleSet } from "@/engine/types";
import { EngineError } from "@/engine/types";
import { MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { createEngineServer } from "@/engine/server";
import { HttpGateway } from "@/engine/gateway";
import { createHttpHandler, type NodeLikeRequest } from "@/engine/http-adapter";
import { readEngineConfig } from "@/engine/config";
import { engineChecklist } from "@/engine/preflight";
import {
  DEFAULT_RATE_LIMITS, RequestLimiter, checkRateLimits, describeRateLimits, parseRateLimits, requestClass, type RateLimits,
} from "@/engine/rate-limit";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const SITE = "https://www.fynxfunded.com";
const rules: RuleSet = { startingBalance: 25000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22 };
const SMALL: RateLimits = { trade: { burst: 3, perSecond: 1 }, reduce: { burst: 5, perSecond: 2 }, read: { burst: 4, perSecond: 2 } };

async function setup(rateLimits?: RateLimits | false) {
  let now = T0;
  const feed = new StaticQuoteFeed();
  const engine = createEngineServer({
    pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 600_000 },
    store: new MemoryStore(), rulesFor: async () => rules, feed, accounts: async () => [],
    verifyToken: async t => (t === "good" ? "u1" : t === "other" ? "u2" : null),
    canAccess: async (u, a) => (u === "u1" && a === "acc_1") || (u === "u2" && a === "acc_2"),
    tradingEnabled: async () => true,
    ...(rateLimits !== undefined ? { rateLimits } : {}),
    clock: () => now,
  });
  engine.start();
  feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
  await engine.venue.open("acc_1");
  await engine.venue.open("acc_2");
  const handler = createHttpHandler(engine, { allowedOrigins: [SITE], clock: () => now });
  return { engine, handler, advance: (ms: number) => { now += ms; } };
}

async function call(handler: ReturnType<typeof createHttpHandler>, method: string, url: string, token = "good", body?: unknown) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const req: NodeLikeRequest = {
    method, url, headers: { Origin: SITE, Authorization: `Bearer ${token}`, ...(text ? { "Content-Type": "application/json" } : {}) },
    async *[Symbol.asyncIterator]() { if (text) yield text; },
  };
  const out = { statusCode: 0, headers: {} as Record<string, string>, text: "" };
  await handler(req, { set statusCode(v: number) { out.statusCode = v; }, get statusCode() { return out.statusCode; }, setHeader: (n, v) => { out.headers[n.toLowerCase()] = v; }, end: b => { out.text = b ?? ""; } });
  return { status: out.statusCode, headers: out.headers, body: out.text ? JSON.parse(out.text) : undefined };
}

const order = (i: number) => ({ symbol: "EURUSD", side: "buy", type: "limit", price: 1.07, lots: 0.1, clientId: `c${i}` });

describe("rate limits: classes and settings", () => {
  it("puts closing and cancelling in the wide 'reduce' allowance, reads in 'read', everything else in 'trade'", () => {
    expect(requestClass("GET", "/v1/accounts/acc_1")).toBe("read");
    expect(requestClass("GET", "/v1/status")).toBe("read");
    expect(requestClass("POST", "/v1/accounts/acc_1/positions/p1/close")).toBe("reduce");
    expect(requestClass("DELETE", "/v1/accounts/acc_1/orders/o1")).toBe("reduce");
    expect(requestClass("DELETE", "/v1/accounts/acc_1/alerts/a1/")).toBe("reduce");
    expect(requestClass("POST", "/v1/accounts/acc_1/orders")).toBe("trade");
    expect(requestClass("PATCH", "/v1/accounts/acc_1/orders/o1")).toBe("trade");
    expect(requestClass("PATCH", "/v1/accounts/acc_1/positions/p1")).toBe("trade");
    expect(requestClass("POST", "/v1/accounts/acc_1/alerts")).toBe("trade");
    expect(requestClass("PATCH", "/v1/accounts/acc_1/notices")).toBe("trade");
    expect(requestClass("PUT", "/anything")).toBe("trade");
  });

  it("reads FYNX_ENGINE_RATE_LIMITS: empty = defaults, off, partial overrides, and lists mistakes", () => {
    expect(parseRateLimits(undefined)).toEqual({ limits: DEFAULT_RATE_LIMITS, problems: [] });
    expect(parseRateLimits(" OFF ").limits).toBe(false);
    const partial = parseRateLimits("trade=10/0.5");
    expect(partial.problems).toEqual([]);
    expect(partial.limits).toEqual({ ...DEFAULT_RATE_LIMITS, trade: { burst: 10, perSecond: 0.5 } });
    expect(parseRateLimits("trade=ten/1").problems[0]).toMatch(/should look like trade=20\/2/);
    expect(parseRateLimits("trade=5/1,trade=6/1").problems).toEqual(["trade is given twice."]);
    expect(parseRateLimits("read=0/1").problems[0]).toMatch(/read: the number allowed at once/);
    // A trader must always be able to get out: closing can never be tighter than opening.
    expect(parseRateLimits("reduce=5/1").problems[0]).toMatch(/at least as often as opening/);
    expect(() => checkRateLimits({ ...DEFAULT_RATE_LIMITS, trade: { burst: 2, perSecond: 0 } })).toThrow(EngineError);
    expect(describeRateLimits(DEFAULT_RATE_LIMITS)).toBe("Per signed-in user: orders and changes 20 at once, then 2/s; closing and cancelling 100 at once, then 20/s; reading 120 at once, then 10/s.");
    expect(describeRateLimits(false)).toMatch(/No request limits/);
  });

  it("is part of the engine settings and the readiness check", () => {
    const env = { FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50", FYNX_ENGINE_ALLOWED_ORIGINS: SITE };
    expect(readEngineConfig(env, FOREX_PAIRS).rateLimits).toEqual(DEFAULT_RATE_LIMITS);
    expect(readEngineConfig({ ...env, FYNX_ENGINE_RATE_LIMITS: "off" }, FOREX_PAIRS).rateLimits).toBe(false);
    expect(() => readEngineConfig({ ...env, FYNX_ENGINE_RATE_LIMITS: "trade=x" }, FOREX_PAIRS)).toThrow(/FYNX_ENGINE_RATE_LIMITS: "trade=x"/);
    const item = engineChecklist(env, FOREX_PAIRS).find(i => i.name === "Trading settings")!;
    expect(item.status).toBe("ready");
    expect(item.detail.join(" ")).toMatch(/orders and changes 20 at once, then 2\/s;.*\(defaults; change with FYNX_ENGINE_RATE_LIMITS\)/);
    const bad = engineChecklist({ ...env, FYNX_ENGINE_RATE_LIMITS: "reduce=1/1" }, FOREX_PAIRS).find(i => i.name === "Trading settings")!;
    expect(bad.status).toBe("missing");
  });
});

describe("RequestLimiter", () => {
  it("allows a burst, then refills continuously, per user and per class", () => {
    let now = 0;
    const l = new RequestLimiter(SMALL, () => now);
    expect([1, 2, 3].map(() => l.take("u1", "trade").ok)).toEqual([true, true, true]);
    expect(l.take("u1", "trade")).toEqual({ ok: false, retryAfterSeconds: 1 });
    // Another user and another class are untouched.
    expect(l.take("u2", "trade").ok).toBe(true);
    expect(l.take("u1", "reduce").ok).toBe(true);
    now += 500;
    expect(l.take("u1", "trade").ok).toBe(false); // half a request back
    now += 500;
    expect(l.take("u1", "trade").ok).toBe(true);
    now += 60_000; // never more than the burst after a long pause
    expect([1, 2, 3, 4].map(() => l.take("u1", "trade").ok)).toEqual([true, true, true, false]);
    expect(l.health()).toMatchObject({ refused: { trade: 3, reduce: 0, read: 0 }, lastRefusedAt: 61_000 });
  });

  it("says how long to wait with slow refills, and a clock going back adds nothing", () => {
    let now = 10_000;
    const l = new RequestLimiter({ ...SMALL, trade: { burst: 1, perSecond: 0.2 } }, () => now);
    expect(l.take("u", "trade").ok).toBe(true);
    expect(l.take("u", "trade").retryAfterSeconds).toBe(5);
    now -= 5_000;
    expect(l.take("u", "trade").ok).toBe(false);
  });

  it("keeps memory bounded: idle users are forgotten first, then the oldest", () => {
    let now = 0;
    const l = new RequestLimiter(SMALL, () => now, 10);
    for (let i = 0; i < 10; i++) l.take(`u${i}`, "read");
    expect(l.health().tracked).toBe(10);
    now += 10_000; // everyone refilled: all forgotten when someone new arrives
    l.take("new", "read");
    expect(l.health().tracked).toBe(1);
    for (let i = 0; i < 20; i++) { l.take(`busy${i}`, "read"); l.take(`busy${i}`, "read"); }
    expect(l.health().tracked).toBeLessThanOrEqual(10);
  });
});

describe("rate limits on the engine server", () => {
  it("refuses the 4th order in a burst with 429, Retry-After and a plain message, and nothing reaches the venue", async () => {
    const { handler, engine, advance } = await setup(SMALL);
    const place = vi.spyOn(engine.venue, "place");
    for (let i = 0; i < 3; i++) expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(i))).status).toBe(200);
    const refused = await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(3));
    expect(refused.status).toBe(429);
    expect(refused.headers["retry-after"]).toBe("1");
    expect(refused.body.error).toEqual({ code: "rate_limited", message: "Too many orders or changes in a short time. Nothing was sent; try again in 1 second.", retryAfterSeconds: 1 });
    expect(place).toHaveBeenCalledTimes(3);
    expect((await engine.venue.snapshot("acc_1")).state.orders).toHaveLength(3);
    // The same order (same clientId) goes through once the allowance is back.
    advance(1000);
    expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(3))).status).toBe(200);
    expect((await engine.venue.snapshot("acc_1")).state.orders).toHaveLength(4);
    expect(engine.status().limits?.refused.trade).toBe(1);
  });

  it("still lets the trader cancel and close while the order allowance is used up", async () => {
    const { handler, engine } = await setup(SMALL);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(i));
      ids.push(r.body.state.orders.at(-1).id);
    }
    expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(9))).status).toBe(429);
    for (const id of ids) expect((await call(handler, "DELETE", `/v1/accounts/acc_1/orders/${encodeURIComponent(id)}`)).status).toBe(200);
    expect((await engine.venue.snapshot("acc_1")).state.orders).toHaveLength(0);
  });

  it("counts each signed-in user separately and reads separately from orders", async () => {
    const { handler } = await setup(SMALL);
    for (let i = 0; i < 3; i++) await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(i));
    expect((await call(handler, "POST", "/v1/accounts/acc_2/orders", "other", order(1))).status).toBe(200);
    expect((await call(handler, "GET", "/v1/accounts/acc_1")).status).toBe(200);
    const reads = [];
    for (let i = 0; i < 4; i++) reads.push((await call(handler, "GET", "/v1/status")).status);
    expect(reads).toEqual([200, 200, 200, 429]);
  });

  it("checks sign-in first: a bad token is 401, never 429, and uses nobody's allowance", async () => {
    const { handler, engine } = await setup(SMALL);
    for (let i = 0; i < 10; i++) expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", "bad", order(i))).status).toBe(401);
    expect(engine.status().limits?.tracked).toBe(0);
    expect((await call(handler, "POST", "/v1/accounts/acc_1/orders", "good", order(1))).status).toBe(200);
  });

  it("is on by default with the default limits, and can be switched off", async () => {
    const on = await setup();
    expect(on.engine.status().limits).toMatchObject({ refused: { trade: 0, reduce: 0, read: 0 } });
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await call(on.handler, "POST", "/v1/accounts/acc_1/orders", "good", order(i))).status);
    expect(statuses.filter(s => s === 200)).toHaveLength(20);
    expect(statuses[20]).toBe(429);

    const off = await setup(false);
    expect(off.engine.status().limits).toBeUndefined();
    for (let i = 0; i < 25; i++) expect((await call(off.handler, "POST", "/v1/accounts/acc_1/orders", "good", order(i))).status).toBe(200);
  });

  it("reaches the terminal as a plain message through HttpGateway", async () => {
    const { handler } = await setup(SMALL);
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const r = await call(handler, init?.method ?? "GET", u.pathname + u.search, "good", init?.body ? JSON.parse(String(init.body)) : undefined);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    };
    const gw = new HttpGateway("https://engine.example", async () => "good", fetchImpl as never);
    for (let i = 0; i < 3; i++) await gw.placeOrder("acc_1", order(i) as never);
    await expect(gw.placeOrder("acc_1", order(3) as never)).rejects.toMatchObject({ code: "rate_limited", message: expect.stringMatching(/^Too many orders or changes in a short time\. Nothing was sent/) });
  });
});

import { describe, expect, it } from "vitest";
import type { RuleSet } from "@/engine/types";
import { MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { createEngineServer } from "@/engine/server";
import { HttpGateway } from "@/engine/gateway";
import { createHttpHandler, type NodeLikeRequest, type RequestLog } from "@/engine/http-adapter";
import { readEngineConfig } from "@/engine/config";
import { engineChecklist } from "@/engine/preflight";
import {
  addressKey, clientAddress, describeSignInGuard, parseSignInGuard, SignInGuard, DEFAULT_SIGN_IN_GUARD, type ClientAddressMode,
} from "@/engine/sign-in-guard";
import { FOREX_PAIRS } from "@/trade-access/instruments";

// Test values only: these prices exercise the plumbing and are not market prices.
const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const SITE = "https://www.fynxfunded.com";
const rules: RuleSet = { startingBalance: 25000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22 };
const ENV = { FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50", FYNX_ENGINE_ALLOWED_ORIGINS: SITE };

describe("visitor address", () => {
  it("normalises IPv4, ports, brackets, zone ids and IPv4-mapped IPv6", () => {
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey(" 203.0.113.7:51234 ")).toBe("203.0.113.7");
    expect(addressKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey("::FFFF:CB00:7107")).toBe("203.0.113.7");
    expect(addressKey("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(addressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("counts IPv6 per /64 network, so one connection cannot rotate through its own addresses", () => {
    const a = addressKey("2001:db8:aa:bb:1:2:3:4");
    expect(a).toBe("2001:db8:aa:bb::/64");
    expect(addressKey("2001:0db8:00aa:00bb:ffff::9")).toBe(a);
    expect(addressKey("2001:db8:aa:bc::1")).not.toBe(a);
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
  });

  it("refuses things that are not addresses", () => {
    for (const bad of ["", "unknown", "999.1.1.1", "1.2.3", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9", "g::1", "[2001:db8::1", undefined, null, "a".repeat(80)]) {
      expect(addressKey(bad as string)).toBeNull();
    }
  });

  it("reads the socket, or X-Forwarded-For counted from the right (left entries can be faked)", () => {
    const socket: ClientAddressMode = { from: "socket" };
    expect(clientAddress({ headers: { "x-forwarded-for": "1.1.1.1" }, socket: { remoteAddress: "::ffff:10.0.0.5" } }, socket)).toBe("10.0.0.5");
    expect(clientAddress({ headers: {} }, socket)).toBeNull();

    const one: ClientAddressMode = { from: "x-forwarded-for", trustedHops: 1 };
    const two: ClientAddressMode = { from: "x-forwarded-for", trustedHops: 2 };
    const faked = { headers: { "X-Forwarded-For": "6.6.6.6, 198.51.100.4, 10.0.0.9" } };
    expect(clientAddress(faked, one)).toBe("10.0.0.9");
    expect(clientAddress(faked, two)).toBe("198.51.100.4");
    expect(clientAddress({ headers: { "x-forwarded-for": ["6.6.6.6", "198.51.100.4"] } }, one)).toBe("198.51.100.4");
    // Fewer entries than proxies: the request did not come the expected way, so no address.
    expect(clientAddress({ headers: { "x-forwarded-for": "198.51.100.4" } }, two)).toBeNull();
    expect(clientAddress({ headers: {} }, one)).toBeNull();
  });
});

describe("settings", () => {
  it("is off until the owner says where the visitor address comes from", () => {
    expect(parseSignInGuard(undefined, undefined)).toEqual({ guard: null, problems: [] });
    expect(parseSignInGuard("", "10/60/60")).toEqual({ guard: null, problems: [] });
    expect(parseSignInGuard("x-forwarded-for", "off")).toEqual({ guard: null, problems: [] });
    expect(parseSignInGuard("socket", undefined).guard).toEqual({ address: { from: "socket" }, limits: DEFAULT_SIGN_IN_GUARD });
    expect(parseSignInGuard("X-Forwarded-For:2", "10/60/120").guard).toEqual({ address: { from: "x-forwarded-for", trustedHops: 2 }, limits: { maxFailures: 10, windowSeconds: 60, blockSeconds: 120 } });
  });

  it("names wrong values", () => {
    expect(parseSignInGuard("forwarded", undefined).problems[0]).toMatch(/FYNX_ENGINE_CLIENT_ADDRESS must be/);
    expect(parseSignInGuard("x-forwarded-for:9", undefined).problems[0]).toMatch(/1 to 5 proxies/);
    expect(parseSignInGuard("socket", "30 per 5 min").problems[0]).toMatch(/should look like 30\/300\/900/);
    expect(parseSignInGuard("socket", "1/60/60").problems[0]).toMatch(/from 3 to 1000/);
    expect(parseSignInGuard("socket", "30/5/60").problems[0]).toMatch(/counting window/);
    expect(parseSignInGuard("socket", "30/300/99999").problems[0]).toMatch(/refusal time/);
    expect(parseSignInGuard("socket", "1/60/60").guard).toBeNull();
  });

  it("is part of the engine settings, the readiness check and the start-up description", () => {
    expect(readEngineConfig(ENV, FOREX_PAIRS).signInGuard).toBeNull();
    expect(readEngineConfig({ ...ENV, FYNX_ENGINE_CLIENT_ADDRESS: "x-forwarded-for" }, FOREX_PAIRS).signInGuard).toEqual({ address: { from: "x-forwarded-for", trustedHops: 1 }, limits: DEFAULT_SIGN_IN_GUARD });
    expect(() => readEngineConfig({ ...ENV, FYNX_ENGINE_CLIENT_ADDRESS: "ip" }, FOREX_PAIRS)).toThrow(/FYNX_ENGINE_CLIENT_ADDRESS must be/);

    const off = engineChecklist(ENV, FOREX_PAIRS).find(i => i.name === "Trading settings")!;
    expect(off.status).toBe("ready");
    expect(off.detail).toContain(describeSignInGuard(null));
    expect(describeSignInGuard(null)).toMatch(/off: set FYNX_ENGINE_CLIENT_ADDRESS/);
    const on = engineChecklist({ ...ENV, FYNX_ENGINE_CLIENT_ADDRESS: "x-forwarded-for:2", FYNX_ENGINE_SIGNIN_LIMIT: "20/120/600" }, FOREX_PAIRS).find(i => i.name === "Trading settings")!;
    expect(on.detail).toContain("Failed sign-in protection: 20 failed sign-ins within 120 s from one address (read from X-Forwarded-For, 2 proxy hop(s) from the right) refuse it for 600 s.");
    const bad = engineChecklist({ ...ENV, FYNX_ENGINE_SIGNIN_LIMIT: "x" }, FOREX_PAIRS).find(i => i.name === "Trading settings")!;
    expect(bad.status).toBe("missing");
  });
});

describe("SignInGuard", () => {
  const limits = { maxFailures: 3, windowSeconds: 60, blockSeconds: 120 };

  it("refuses an address after too many failures in the window, then lets it try again", () => {
    let now = T0;
    const g = new SignInGuard(limits, () => now);
    expect(g.fail("a")).toBe(false);
    expect(g.fail("a")).toBe(false);
    expect(g.check("a")).toEqual({ ok: true });
    expect(g.fail("a")).toBe(true);
    expect(g.check("a")).toEqual({ ok: false, retryAfterSeconds: 120 });
    expect(g.check("b")).toEqual({ ok: true }); // other visitors are not affected
    now += 119_500;
    expect(g.check("a")).toEqual({ ok: false, retryAfterSeconds: 1 });
    // Failures while refused do not extend the refusal.
    expect(g.fail("a")).toBe(false);
    now += 500;
    expect(g.check("a")).toEqual({ ok: true });
    // A fresh count after the refusal.
    expect(g.fail("a")).toBe(false);
    expect(g.health()).toMatchObject({ refused: 2, blocks: 1, blockedNow: 0, lastBlockedAt: T0 });
  });

  it("forgets failures older than the window", () => {
    let now = T0;
    const g = new SignInGuard(limits, () => now);
    g.fail("a"); g.fail("a");
    now += 60_000;
    expect(g.fail("a")).toBe(false);
    expect(g.fail("a")).toBe(false);
    expect(g.fail("a")).toBe(true);
    expect(g.health().blockedNow).toBe(1);
  });

  it("a clock that goes backwards never drops failures early", () => {
    let now = T0;
    const g = new SignInGuard(limits, () => now);
    g.fail("a"); g.fail("a");
    now -= 30_000;
    expect(g.fail("a")).toBe(true);
  });

  it("keeps memory bounded: idle addresses go first, then the oldest", () => {
    let now = T0;
    const g = new SignInGuard(limits, () => now, 10);
    for (let i = 0; i < 10; i++) g.fail(`old${i}`);
    now += 61_000; // all idle now
    for (let i = 0; i < 5; i++) g.fail(`new${i}`);
    expect(g.health().tracked).toBe(5);
    for (let i = 0; i < 20; i++) g.fail(`busy${i}`);
    expect(g.health().tracked).toBeLessThanOrEqual(10);
  });

  it("refuses impossible limits", () => {
    expect(() => new SignInGuard({ maxFailures: 0, windowSeconds: 60, blockSeconds: 60 })).toThrow(/from 3 to 1000/);
  });
});

describe("HTTP adapter with failed sign-in protection", () => {
  function setup(address: ClientAddressMode = { from: "x-forwarded-for", trustedHops: 1 }) {
    let now = T0;
    const feed = new StaticQuoteFeed();
    let tokenChecks = 0;
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 },
      store: new MemoryStore(), rulesFor: async () => rules, feed, accounts: async () => [],
      verifyToken: async t => { tokenChecks += 1; return t === "good" ? "u1" : null; },
      canAccess: async (u, a) => u === "u1" && a.startsWith("acc_"),
      tradingEnabled: async () => true,
      clock: () => now,
    });
    engine.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    const guard = new SignInGuard({ maxFailures: 3, windowSeconds: 60, blockSeconds: 300 }, () => now);
    const blocked: string[] = [];
    const logs: RequestLog[] = [];
    const handler = createHttpHandler(engine, {
      allowedOrigins: [SITE], clock: () => now, log: l => logs.push(l),
      signInGuard: { guard, address, onBlock: a => blocked.push(a) },
    });
    return { handler, guard, blocked, logs, tokenChecks: () => tokenChecks, advance: (ms: number) => { now += ms; } };
  }

  async function call(handler: ReturnType<typeof createHttpHandler>, method: string, url: string, headers: Record<string, string>, body?: string, extra: Partial<NodeLikeRequest> = {}) {
    let read = false;
    const req: NodeLikeRequest = { method, url, headers, async *[Symbol.asyncIterator]() { read = true; if (body) yield body; }, ...extra };
    const out = { statusCode: 0, headers: {} as Record<string, string>, text: "" };
    await handler(req, { set statusCode(v: number) { out.statusCode = v; }, get statusCode() { return out.statusCode; }, setHeader: (n, v) => { out.headers[n.toLowerCase()] = v; }, end: b => { out.text = b ?? ""; } });
    return { status: out.statusCode, headers: out.headers, body: out.text ? JSON.parse(out.text) : undefined, bodyRead: read };
  }

  const from = (ip: string, token = "bad") => ({ Origin: SITE, Authorization: `Bearer ${token}`, "X-Forwarded-For": `6.6.6.6, ${ip}` });

  it("refuses an address after repeated failed sign-ins, before the body is read or the token checked", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) expect((await call(s.handler, "GET", "/v1/accounts/acc_1", from("198.51.100.4"))).status).toBe(401);
    expect(s.blocked).toEqual(["198.51.100.4"]);
    const checks = s.tokenChecks();

    const order = JSON.stringify({ symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, clientId: "c-1" });
    const refused = await call(s.handler, "POST", "/v1/accounts/acc_1/orders", { ...from("198.51.100.4", "good"), "Content-Type": "application/json" }, order);
    expect(refused.status).toBe(429);
    expect(refused.headers["retry-after"]).toBe("300");
    expect(refused.headers["access-control-allow-origin"]).toBe(SITE); // the browser can read the reason
    expect(refused.body.error).toMatchObject({ code: "too_many_failed_sign_ins", retryAfterSeconds: 300 });
    expect(refused.body.error.message).toBe("Too many failed sign-ins from this network. Nothing was sent; sign in again and retry in 5 minutes.");
    expect(refused.bodyRead).toBe(false);
    expect(s.tokenChecks()).toBe(checks);
    expect(s.logs.at(-1)).toMatchObject({ status: 429, code: "too_many_failed_sign_ins" });

    // Another visitor (same faked left entry, different real address) is unaffected.
    const other = await call(s.handler, "GET", "/v1/accounts/acc_1", from("203.0.113.9", "good"));
    expect(other.status).toBe(200);

    // Health checks and browser preflights from the refused address still work.
    expect((await call(s.handler, "GET", "/healthz", from("198.51.100.4"))).status).toBe(200);
    expect((await call(s.handler, "OPTIONS", "/v1/accounts/acc_1/orders", { ...from("198.51.100.4"), "Access-Control-Request-Method": "POST" })).status).toBe(204);

    // After the refusal time a valid sign-in works again.
    s.advance(300_000);
    expect((await call(s.handler, "GET", "/v1/accounts/acc_1", from("198.51.100.4", "good"))).status).toBe(200);
    expect(s.guard.health()).toMatchObject({ refused: 1, blocks: 1 });
  });

  it("does not count successful requests or other errors (403, 404, 400) as failed sign-ins", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) {
      expect((await call(s.handler, "GET", "/v1/accounts/acc_1", from("198.51.100.4", "good"))).status).toBe(200);
      expect((await call(s.handler, "GET", "/v1/accounts/zzz", from("198.51.100.4", "good"))).status).toBe(403);
      expect((await call(s.handler, "GET", "/v1/nothing", from("198.51.100.4", "good"))).status).toBe(404);
    }
    expect(s.blocked).toEqual([]);
    expect(s.guard.health().tracked).toBe(0);
  });

  it("the terminal gets the plain reason through HttpGateway", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) await call(s.handler, "GET", "/v1/accounts/acc_1", from("198.51.100.4"));
    const fetchVia = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const r = await call(s.handler, init?.method ?? "GET", u.pathname + u.search, { ...(init?.headers as Record<string, string>), ...from("198.51.100.4", "good") });
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    };
    const gw = new HttpGateway("https://engine.test", async () => "good", fetchVia as typeof fetch);
    await expect(gw.snapshot("acc_1")).rejects.toMatchObject({ code: "too_many_failed_sign_ins", message: expect.stringContaining("Too many failed sign-ins") });
  });

  it("skips requests whose address cannot be told, and uses the connection address in socket mode", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await call(s.handler, "GET", "/v1/accounts/acc_1", { Origin: SITE, Authorization: "Bearer bad" })).status).toBe(401);
    expect(s.blocked).toEqual([]);

    const direct = setup({ from: "socket" });
    const sock = { socket: { remoteAddress: "::ffff:192.0.2.10" } };
    for (let i = 0; i < 3; i++) await call(direct.handler, "GET", "/v1/accounts/acc_1", { Origin: SITE, Authorization: "Bearer bad", "X-Forwarded-For": "1.2.3.4" }, undefined, sock);
    expect(direct.blocked).toEqual(["192.0.2.10"]);
    expect((await call(direct.handler, "GET", "/v1/accounts/acc_1", { Origin: SITE, Authorization: "Bearer good" }, undefined, sock)).status).toBe(429);
    expect((await call(direct.handler, "GET", "/v1/accounts/acc_1", { Origin: SITE, Authorization: "Bearer good" }, undefined, { socket: { remoteAddress: "192.0.2.11" } })).status).toBe(200);
  });

  it("refused requests from browsers on other websites are still refused for the origin first", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) await call(s.handler, "GET", "/v1/accounts/acc_1", from("198.51.100.4"));
    const r = await call(s.handler, "GET", "/v1/accounts/acc_1", { ...from("198.51.100.4"), Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_not_allowed");
  });
});

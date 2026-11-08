import { describe, expect, it, vi } from "vitest";
import type { EngineEvent, RuleSet } from "@/engine/types";
import { EngineError } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed, type Snapshot } from "@/engine/venue";
import { EngineRunner, executionMessage } from "@/engine/runner";
import { createEngineServer } from "@/engine/server";
import { HttpGateway } from "@/engine/gateway";
import { StreamingQuoteFeed, type FeedTransport } from "@/engine/quote-feed";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const settings = { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 };

/** A hand-driven clock and timer list, so scheduling is tested without real time. */
function manualTime(start = T0) {
  let now = start;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    clock: () => now,
    schedule: (fn: () => void, ms: number) => { const id = next++; timers.push({ at: now + ms, fn, id }); return id; },
    cancel: (h: unknown) => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1); },
    timers,
    /** Moves the clock and fires due timers. */
    async advance(ms: number) {
      now += ms;
      for (;;) {
        const due = timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
        await flush();
      }
      await flush();
    },
    set(t: number) { now = t; },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function venueSetup() {
  const time = manualTime();
  const store = new MemoryStore();
  const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, settings), store, async () => rules, settings, time.clock);
  const feed = new StaticQuoteFeed(); venue.connect(feed);
  feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
  await venue.open("acc_1"); await venue.open("acc_2");
  return { time, store, venue, feed };
}

const snap = (positions = 0, orders = 0): Snapshot => ({ state: { positions: new Array(positions).fill({}), orders: new Array(orders).fill({}) } as never, metrics: {} as never, quotes: {} });

describe("EngineRunner (timer step)", () => {
  it("closes a position at its stop loss with nobody sending a request", async () => {
    const { time, store, venue, feed } = await venueSetup();
    const events: EngineEvent[] = [];
    venue.onEvents((_a, e) => events.push(...e));
    await venue.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.079 });
    const runner = new EngineRunner({ venue, accounts: () => ["acc_1"], clock: time.clock, schedule: time.schedule, cancel: time.cancel });

    feed.push({ symbol: "EURUSD", bid: 1.0785, ask: 1.0786, time: T0 + 1000 });
    time.set(T0 + 1000);
    expect((await store.load("acc_1"))?.positions).toHaveLength(1); // a price alone changes nothing
    const round = await runner.runOnce();
    expect(round).toMatchObject({ checked: 1, failed: 0 });
    const state = await store.load("acc_1");
    expect(state?.positions).toEqual([]);
    expect(state?.history[0]).toMatchObject({ reason: "stop_loss", exitPrice: 1.0785 });
    expect(events.some(e => e.type === "position_closed")).toBe(true);
  });

  it("fills a pending order on the timer step", async () => {
    const { time, store, venue, feed } = await venueSetup();
    await venue.place("acc_2", { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.5, price: 1.079 });
    const runner = new EngineRunner({ venue, accounts: async () => ["acc_2"], clock: time.clock });
    feed.push({ symbol: "EURUSD", bid: 1.0788, ask: 1.0789, time: T0 + 500 });
    time.set(T0 + 500);
    await runner.runOnce();
    const state = await store.load("acc_2");
    expect(state?.orders).toEqual([]);
    expect(state?.positions[0]).toMatchObject({ entryPrice: 1.0789, lots: 0.5 });
  });

  it("checks accounts with nothing open only every idleEveryMs, busy ones every round", async () => {
    const time = manualTime();
    const venue = { snapshot: vi.fn(async (id: string) => (id === "busy" ? snap(1) : snap())) };
    const runner = new EngineRunner({ venue, accounts: () => ["idle", "busy", "idle"], idleEveryMs: 60_000, clock: time.clock });
    expect(await runner.runOnce()).toMatchObject({ checked: 2, idleSkipped: 0 }); // duplicates ignored
    time.set(T0 + 1000);
    expect(await runner.runOnce()).toMatchObject({ checked: 1, idleSkipped: 1 });
    runner.watch("idle"); // e.g. it just placed an order
    expect(await runner.runOnce()).toMatchObject({ checked: 2, idleSkipped: 0 });
    time.set(T0 + 61_000);
    expect(await runner.runOnce()).toMatchObject({ checked: 2 });
    expect(venue.snapshot.mock.calls.map(c => c[0])).toEqual(["idle", "busy", "busy", "idle", "busy", "idle", "busy"]);
  });

  it("keeps a watched account that is not listed until it holds nothing, then drops it", async () => {
    let open = 1;
    const venue = { snapshot: vi.fn(async () => snap(open)) };
    const runner = new EngineRunner({ venue, accounts: () => [] });
    runner.watch("extra");
    expect(await runner.runOnce()).toMatchObject({ checked: 1 });
    open = 0;
    expect(await runner.runOnce()).toMatchObject({ checked: 1 });
    expect(await runner.runOnce()).toMatchObject({ checked: 0 });
    expect(runner.health().watched).toBe(0);
  });

  it("skips rounds while prices are not live and says so", async () => {
    let live = false;
    const venue = { snapshot: vi.fn(async () => snap()) };
    const runner = new EngineRunner({ venue, accounts: () => ["a"], ready: () => live, schedule: () => 0, cancel: () => undefined });
    runner.start();
    await flush();
    expect(runner.health()).toMatchObject({ running: true, healthy: false, lastRound: { waitingForPrices: true, checked: 0 } });
    expect(venue.snapshot).not.toHaveBeenCalled();
    expect(executionMessage(false, runner.health())).toMatch(/Waiting for prices/);
    live = true;
    await runner.runOnce();
    expect(runner.health().healthy).toBe(true);
    expect(executionMessage(true, runner.health())).toMatch(/^Trading engine live/);
    await runner.stop();
  });

  it("backs off a failing account without stopping the others; conflicts just retry", async () => {
    const time = manualTime();
    let brokenFails = true, conflictOnce = true;
    const errors: [string | null, unknown][] = [];
    const venue = {
      snapshot: vi.fn(async (id: string) => {
        if (id === "broken" && brokenFails) throw new Error("store down");
        if (id === "race" && conflictOnce) { conflictOnce = false; throw new EngineError("conflict", "The account changed; retry."); }
        return snap(1);
      }),
    };
    const runner = new EngineRunner({ venue, accounts: () => ["broken", "ok", "race"], failureBackoffMs: [1000, 5000], clock: time.clock, onError: (a, e) => errors.push([a, e]) });
    expect(await runner.runOnce()).toMatchObject({ checked: 1, failed: 1, conflicts: 1 });
    expect(errors).toHaveLength(1); // the conflict is not reported as an error
    expect(runner.health().failing).toEqual([{ accountId: "broken", failures: 1, retryAt: T0 + 1000, lastError: "store down" }]);
    expect(await runner.runOnce()).toMatchObject({ checked: 2, backoffSkipped: 1 });
    time.set(T0 + 1000);
    expect(await runner.runOnce()).toMatchObject({ failed: 1 });
    expect(runner.health().failing[0]).toMatchObject({ failures: 2, retryAt: T0 + 6000 });
    time.set(T0 + 6000); brokenFails = false;
    expect(await runner.runOnce()).toMatchObject({ checked: 3, failed: 0 });
    expect(runner.health().failing).toEqual([]);
  });

  it("reports a failing account list instead of crashing", async () => {
    const onError = vi.fn();
    const runner = new EngineRunner({ venue: { snapshot: async () => snap() }, accounts: async () => { throw new Error("query failed"); }, onError, schedule: () => 0, cancel: () => undefined });
    runner.start();
    await flush();
    expect(runner.health()).toMatchObject({ healthy: false, lastError: "query failed", lastRound: { listFailed: true } });
    expect(onError).toHaveBeenCalledWith(null, expect.any(Error));
    await runner.stop();
  });

  it("runs on an interval, never overlaps rounds, and runs once more after a nudge during a round", async () => {
    const time = manualTime();
    let inFlight = 0, maxInFlight = 0;
    const gates: (() => void)[] = [];
    const venue = { snapshot: vi.fn(() => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<Snapshot>(r => gates.push(() => { inFlight--; r(snap(1)); })); }) };
    const runner = new EngineRunner({ venue, accounts: () => ["a"], intervalMs: 1000, clock: time.clock, schedule: time.schedule, cancel: time.cancel });
    runner.start();
    await flush();
    expect(venue.snapshot).toHaveBeenCalledTimes(1); // first round starts at once
    runner.nudge(); runner.nudge(); // new prices while the round is running
    void runner.runOnce(); // and an outside round: it must wait
    await flush();
    expect(venue.snapshot).toHaveBeenCalledTimes(1);
    expect(runner.health().queuedWhileBusy).toBe(1);
    gates.shift()!(); await flush();
    expect(venue.snapshot).toHaveBeenCalledTimes(2);
    gates.shift()!(); await flush();
    gates.shift()?.(); await flush();
    expect(maxInFlight).toBe(1);
    const calls = venue.snapshot.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3); // one queued nudge round, one outside round
    expect(time.timers).toHaveLength(1); // the next interval round is scheduled
    await time.advance(1000);
    expect(venue.snapshot).toHaveBeenCalledTimes(calls + 1);
    gates.shift()!(); await flush();
    expect(maxInFlight).toBe(1);
    await runner.stop();
    expect(time.timers).toHaveLength(0);
    await time.advance(5000);
    expect(venue.snapshot).toHaveBeenCalledTimes(calls + 1);
  });

  it("waits minGapMs between nudged rounds so a burst of prices is one round", async () => {
    const time = manualTime();
    const venue = { snapshot: vi.fn(async () => snap(1)) };
    const runner = new EngineRunner({ venue, accounts: () => ["a"], intervalMs: 1000, minGapMs: 200, clock: time.clock, schedule: time.schedule, cancel: time.cancel });
    runner.start();
    await flush();
    expect(venue.snapshot).toHaveBeenCalledTimes(1);
    await time.advance(50);
    runner.nudge(); runner.nudge(); runner.nudge();
    await flush();
    expect(venue.snapshot).toHaveBeenCalledTimes(1); // too soon after the last round
    await time.advance(150); // 200 ms after the last start
    expect(venue.snapshot).toHaveBeenCalledTimes(2);
    await time.advance(999);
    expect(venue.snapshot).toHaveBeenCalledTimes(2);
    await time.advance(1);
    expect(venue.snapshot).toHaveBeenCalledTimes(3); // back on the interval
    await runner.stop();
  });

  it("is unhealthy when rounds stop arriving", async () => {
    const time = manualTime();
    const runner = new EngineRunner({ venue: { snapshot: async () => snap() }, accounts: () => [], intervalMs: 1000, clock: time.clock, schedule: () => 0, cancel: () => undefined });
    runner.start();
    await flush();
    expect(runner.health().healthy).toBe(true);
    time.set(T0 + 5001);
    expect(runner.health().healthy).toBe(false);
    expect(executionMessage(true, runner.health())).toMatch(/delayed/);
    await runner.stop();
    expect(executionMessage(true, runner.health())).toMatch(/stopped/);
  });

  it("refuses a zero interval", () => {
    expect(() => new EngineRunner({ venue: { snapshot: async () => snap() }, accounts: () => [], intervalMs: 0 })).toThrow(/intervalMs/);
  });
});

function fakeTransport() {
  const streams: { send: (m: unknown) => void; closed: boolean }[] = [];
  const transport: FeedTransport = { open(_symbols, onMessage) { const s = { send: onMessage, closed: false }; streams.push(s); return () => { s.closed = true; }; } };
  return { transport, streams };
}

describe("createEngineServer (everything wired in one call)", () => {
  async function server(enabled = true) {
    const time = manualTime();
    const { transport, streams } = fakeTransport();
    const feed = new StreamingQuoteFeed({ transport, parse: m => [m as never], pipSize: s => FOREX_PAIRS.find(p => p.symbol === s)?.pipSize, clock: time.clock, schedule: time.schedule, cancel: time.cancel });
    const store = new MemoryStore();
    const events: string[] = [];
    const trading = { enabled };
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings, store, rulesFor: async () => rules, feed,
      accounts: () => ["acc_1"],
      verifyToken: async t => (t === "good" ? "u1" : null),
      canAccess: async (u, a) => u === "u1" && a === "acc_1",
      tradingEnabled: async () => trading.enabled,
      onEvents: (_a, e) => events.push(...e.map(x => x.type)),
      runner: { intervalMs: 1000, schedule: time.schedule, cancel: time.cancel },
      clock: time.clock,
    });
    await engine.venue.open("acc_1");
    const fetcher = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const r = await engine.handle({ method: init?.method ?? "GET", path: u.pathname + u.search, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
    const gw = new HttpGateway("https://api.example.com", async () => "good", fetcher);
    const price = (bid: number, ask: number) => streams[streams.length - 1].send({ symbol: "EURUSD", bid, ask, time: time.clock() });
    return { time, store, engine, gw, price, streams, events, trading };
  }

  it("reports waiting for prices, then live, in GET /v1/status", async () => {
    const { engine, gw, price, time } = await server();
    engine.start();
    await flush();
    expect(await gw.status()).toMatchObject({ connected: true, priceFeed: false, execution: false, message: expect.stringMatching(/Waiting for prices/) });
    price(1.08, 1.0801);
    await time.advance(1000);
    const status = await gw.status();
    expect(status).toMatchObject({ priceFeed: true, execution: true, message: expect.stringMatching(/^Trading engine live/) });
    expect(status.markets?.EURUSD.open).toBe(true);
    expect(engine.status().runner.rounds).toBeGreaterThan(0);
    await engine.stop();
  });

  it("an order placed through the terminal contract is stopped out by the server on the next price", async () => {
    const { engine, gw, price, time, store, events } = await server();
    engine.start();
    price(1.08, 1.0801);
    await time.advance(1000);
    const placed = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.079, clientId: "c-1" });
    expect(placed.state.positions).toHaveLength(1);
    time.set(time.clock() + 300);
    price(1.0789, 1.079); // through the stop; no request from the terminal
    await flush();
    const state = await store.load("acc_1");
    expect(state?.positions).toEqual([]);
    expect(state?.history[0]).toMatchObject({ reason: "stop_loss", clientId: "c-1" });
    expect(events).toContain("position_closed");
    expect((await gw.snapshot("acc_1")).state.history).toHaveLength(1);
    await engine.stop();
  });

  it("keeps the owner's trading switch and stops cleanly", async () => {
    const { engine, gw, price, time, streams } = await server(false);
    engine.start();
    engine.start(); // twice is harmless
    price(1.08, 1.0801);
    await time.advance(1000);
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).rejects.toMatchObject({ code: "trading_disabled" });
    expect(streams).toHaveLength(1);
    await engine.stop();
    expect(streams[0].closed).toBe(true);
    expect(engine.status()).toMatchObject({ execution: false, runner: { running: false } });
  });
});

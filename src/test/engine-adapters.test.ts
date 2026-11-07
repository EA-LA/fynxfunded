import { describe, expect, it } from "vitest";
import type { RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue } from "@/engine/venue";
import { FirestoreAccountStore, fromFirestoreData, toFirestoreData, type DocRefLike, type FirestoreLike } from "@/engine/firestore-store";
import { StreamingQuoteFeed, validatePrice, type FeedTransport } from "@/engine/quote-feed";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };

/** In-memory stand-in for the Admin SDK with real transaction semantics (reads then writes, all or nothing). */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const ref = (path: string): DocRefLike & { path: string } => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) }),
  });
  const db: FirestoreLike = {
    collection: c => ({ doc: id => ref(`${c}/${id}`) }),
    async runTransaction(fn) {
      const pending: [string, Record<string, unknown>][] = [];
      const result = await fn({
        get: r => r.get(),
        set: (r, data) => {
          if (Object.values(data).some(v => v === undefined)) throw new Error("Firestore refuses undefined");
          pending.push([(r as DocRefLike & { path: string }).path, data]);
        },
      });
      pending.forEach(([p, d]) => { docs.set(p, structuredClone(d)); writes.push(p); });
      return result;
    },
  };
  return { db, docs, writes };
}

describe("FirestoreAccountStore", () => {
  it("runs a venue end to end: create, trade, reload from the stored document", async () => {
    const { db, docs } = fakeFirestore();
    const store = new FirestoreAccountStore(db, { collection: "engineAccounts", clock: () => T0 });
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), store, async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    venue.quotes.EURUSD = { symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 };
    await venue.open("acc_1");
    const placed = await venue.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c-1" });
    expect(docs.get("engineAccounts/acc_1")).toMatchObject({ accountId: "acc_1", sequence: placed.state.sequence, updatedAt: T0 });
    const reloaded = await store.load("acc_1");
    expect(reloaded).toEqual(JSON.parse(JSON.stringify(placed.state)));
    expect(reloaded).not.toHaveProperty("updatedAt");
    const closed = await venue.close("acc_1", placed.state.positions[0].id);
    expect((await store.load("acc_1"))!.history).toHaveLength(closed.state.history.length);
  });

  it("refuses stale writes and double creation (optimistic lock on sequence)", async () => {
    const { db, writes } = fakeFirestore();
    const store = new FirestoreAccountStore(db);
    const base = { accountId: "a1", currency: "USD", status: "active", balance: 100, dayStartBalance: 100, tradingDay: "2026-11-04", tradingDays: [], positions: [], orders: [], history: [], sequence: 0 } as const;
    await store.save({ ...base, tradingDays: [], positions: [], orders: [], history: [] }, -1);
    await expect(store.save({ ...base, tradingDays: [], positions: [], orders: [], history: [] }, -1)).rejects.toMatchObject({ code: "conflict" });
    await store.save({ ...base, tradingDays: [], positions: [], orders: [], history: [], sequence: 1 }, 0);
    await expect(store.save({ ...base, tradingDays: [], positions: [], orders: [], history: [], sequence: 1 }, 0)).rejects.toMatchObject({ code: "conflict" });
    expect(writes).toEqual(["engineAccounts/a1", "engineAccounts/a1"]);
    expect(await store.load("missing")).toBeNull();
  });

  it("drops undefined fields, refuses oversize states, odd ids and malformed documents", async () => {
    const { db, docs } = fakeFirestore();
    const store = new FirestoreAccountStore(db, { maxDocumentBytes: 400 });
    const state = { accountId: "a1", currency: "USD" as const, status: "active" as const, balance: 1, dayStartBalance: 1, tradingDay: "d", tradingDays: [], positions: [], orders: [], history: [], sequence: 0, breachReason: undefined };
    expect(toFirestoreData(state)).not.toHaveProperty("breachReason");
    await store.save(state, -1);
    const big = { ...state, tradingDays: Array.from({ length: 50 }, (_, i) => `2026-01-${i}`) };
    await expect(store.save(big, 0)).rejects.toMatchObject({ code: "state_too_large" });
    await expect(store.load("../other")).rejects.toMatchObject({ code: "bad_request" });
    docs.set("engineAccounts/bad", { accountId: "bad", balance: "lots" });
    await expect(store.load("bad")).rejects.toMatchObject({ code: "bad_state" });
    expect(() => fromFirestoreData("a2", toFirestoreData(state))).toThrow(/malformed/);
  });
});

function fakeTransport() {
  const opened: { symbols: string[]; send: (m: unknown) => void; end: (r?: string) => void; closed: boolean }[] = [];
  const transport: FeedTransport = {
    open(symbols, onMessage, onClose) {
      const s = { symbols, send: onMessage, end: onClose, closed: false };
      opened.push(s);
      return () => { s.closed = true; };
    },
  };
  return { transport, opened };
}

describe("StreamingQuoteFeed (price feed template)", () => {
  const pip = (s: string) => FOREX_PAIRS.find(p => p.symbol === s)?.pipSize;

  it("validates prices before the engine can fill on them", () => {
    const o = { now: T0, pipSize: 0.0001, maxSpreadPips: 50, maxFutureMs: 5000 };
    expect(validatePrice({ symbol: "x", bid: "1.08", ask: 1.0802, time: new Date(T0).toISOString() }, "EURUSD", o)).toEqual({ symbol: "EURUSD", bid: 1.08, ask: 1.0802, time: T0 });
    expect(validatePrice({ symbol: "x", bid: null, ask: 1, time: T0 }, "EURUSD", o)).toBe("bad_number");
    expect(validatePrice({ symbol: "x", bid: -1, ask: 1, time: T0 }, "EURUSD", o)).toBe("bad_number");
    expect(validatePrice({ symbol: "x", bid: 1.09, ask: 1.08, time: T0 }, "EURUSD", o)).toBe("crossed");
    expect(validatePrice({ symbol: "x", bid: 1.08, ask: 1.0851, time: T0 }, "EURUSD", o)).toBe("wide_spread");
    expect(validatePrice({ symbol: "x", bid: 1.08, ask: 1.0801, time: T0 + 6000 }, "EURUSD", o)).toBe("future_time");
    expect(validatePrice({ symbol: "x", bid: 1.08, ask: 1.0801, time: T0 - 1 }, "EURUSD", { ...o, lastTime: T0 })).toBe("out_of_order");
  });

  it("maps provider symbols, feeds a venue and reports health", async () => {
    let now = T0;
    const { transport, opened } = fakeTransport();
    const feed = new StreamingQuoteFeed({
      transport, symbolMap: { EURUSD: "EUR/USD", USDJPY: "USD/JPY" }, pipSize: pip, clock: () => now,
      parse: m => (m as { prices: { s: string; b: number; a: number; t: number }[] }).prices.map(p => ({ symbol: p.s, bid: p.b, ask: p.a, time: p.t })),
    });
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 }), { load: async () => null, save: async () => undefined }, async () => rules, { maxQuoteAgeMs: 60_000 }, () => now);
    const stop = venue.connect(feed);
    expect(opened[0].symbols).toContain("EUR/USD");
    expect(opened[0].symbols).toContain("GBPUSD");
    expect(feed.health()).toMatchObject({ connected: true, live: false });
    opened[0].send({ prices: [{ s: "EUR/USD", b: 1.08, a: 1.0801, t: T0 }, { s: "USD/JPY", b: 150, a: 149, t: T0 }, { s: "BTC/USD", b: 1, a: 2, t: T0 }] });
    expect(venue.quotes.EURUSD).toEqual({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    expect(venue.quotes.USDJPY).toBeUndefined();
    const h = feed.health();
    expect(h).toMatchObject({ live: true, accepted: 1, lastQuoteAt: T0 });
    expect(h.rejected).toMatchObject({ crossed: 1, unknown_symbol: 1 });
    opened[0].send("not json at all");
    expect(feed.health().rejected.parse_error).toBe(1);
    now += 20_000;
    expect(feed.health().live).toBe(false);
    stop();
    expect(opened[0].closed).toBe(true);
    expect(feed.health().connected).toBe(false);
  });

  it("reconnects with backoff and stops cleanly", () => {
    const timers: { fn: () => void; ms: number; cancelled?: boolean }[] = [];
    const { transport, opened } = fakeTransport();
    const feed = new StreamingQuoteFeed({
      transport, parse: m => m as never, clock: () => T0, backoffMs: [100, 500],
      schedule: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
      cancel: h => { (h as { cancelled: boolean }).cancelled = true; },
    });
    const got: number[] = [];
    const stop = feed.subscribe(["EURUSD"], q => got.push(q.bid));
    opened[0].end("socket error");
    expect(feed.health()).toMatchObject({ connected: false, lastError: "socket error" });
    expect(timers.map(t => t.ms)).toEqual([100]);
    timers[0].fn();
    expect(opened).toHaveLength(2);
    opened[1].end();
    timers[1].fn();
    opened[2].end();
    expect(timers.map(t => t.ms)).toEqual([100, 500, 500]);
    timers[2].fn();
    opened[3].send([{ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 }]);
    expect(got).toEqual([1.08]);
    expect(feed.health()).toMatchObject({ reconnects: 3, live: true });
    opened[3].end();
    stop();
    expect(timers[3].cancelled).toBe(true);
    opened[3].send([{ symbol: "EURUSD", bid: 1.09, ask: 1.0901, time: T0 }]);
    expect(got).toEqual([1.08]);
  });

  it("treats a transport that throws on open as a dropped connection", () => {
    const timers: number[] = [];
    const feed = new StreamingQuoteFeed({ transport: { open: () => { throw new Error("no network"); } }, parse: () => [], schedule: (_f, ms) => timers.push(ms), cancel: () => undefined });
    feed.subscribe(["EURUSD"], () => undefined);
    expect(feed.health()).toMatchObject({ connected: false, lastError: "no network" });
    expect(timers).toEqual([1000]);
  });
});

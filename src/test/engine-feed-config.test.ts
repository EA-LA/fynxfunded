import { describe, expect, it } from "vitest";
import type { RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, type AccountStore } from "@/engine/venue";
import { createFeedFromEnv, fieldParser, providerSymbol, readFeedConfig, readPath, webSocketTransport, type SocketLike } from "@/engine/feed-config";
import { engineChecklist, formatReport, probeFeed, runEngineCheck } from "@/engine/preflight";
import { FOREX_PAIRS } from "@/trade-access/instruments";

// Test values only: these numbers exercise the parser and are not market prices.
const T0 = Date.parse("2026-11-04T10:00:00Z");
const KEY = "sk_test_ABC123";

const baseEnv = {
  FYNX_FEED_URL: "wss://stream.provider.test/fx?apiKey={key}",
  FYNX_FEED_API_KEY: KEY,
  FYNX_FEED_SUBSCRIBE: '{"action":"subscribe","pairs":{symbols},"csv":"{symbols_csv}"}',
  FYNX_FEED_FIELDS: '{"items":"data","match":{"type":"quote"},"symbol":"pair","bid":"b","ask":"a","time":"t"}',
  FYNX_FEED_SYMBOL_FORMAT: "{base}/{quote}",
};
const engineEnv = {
  FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50",
  FYNX_ENGINE_ALLOWED_ORIGINS: "https://www.fynxfunded.com",
};

/** Fake WebSocket: the test drives open / message / close. */
function fakeSockets() {
  const made: (SocketLike & { url: string; sent: string[]; closed: boolean })[] = [];
  const factory = (url: string) => {
    const s = { url, sent: [] as string[], closed: false, onopen: null, onmessage: null, onclose: null, onerror: null,
      send(d: string) { this.sent.push(d); }, close() { this.closed = true; } };
    made.push(s);
    return s;
  };
  return { made, factory };
}

/** Manual timers. */
function timers() {
  let now = T0, seq = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  return {
    clock: () => now,
    schedule: (fn: () => void, ms: number) => { const id = ++seq; jobs.set(id, { at: now + ms, fn }); return id; },
    cancel: (h: unknown) => { jobs.delete(h as number); },
    advance(ms: number) {
      now += ms;
      for (const [id, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (j.at <= now && jobs.has(id)) { jobs.delete(id); j.fn(); }
    },
    pending: () => jobs.size,
  };
}

describe("readFeedConfig", () => {
  it("builds the address, subscribe message and a provider name for all 45 pairs", () => {
    const c = readFeedConfig(baseEnv, FOREX_PAIRS);
    expect(c.url).toBe(`wss://stream.provider.test/fx?apiKey=${KEY}`);
    expect(c.safeUrl).toBe("wss://stream.provider.test/fx?apiKey=•••");
    expect(Object.keys(c.symbolMap)).toHaveLength(45);
    expect(c.symbolMap.EURUSD).toBe("EUR/USD");
    expect(c.subscribe!(["EUR/USD", "USD/JPY"])).toBe('{"action":"subscribe","pairs":["EUR/USD","USD/JPY"],"csv":"EUR/USD,USD/JPY"}');
    expect(c).toMatchObject({ timeUnit: "ms", maxSpreadPips: 50, idleReconnectMs: 60_000 });
  });

  it("URL-encodes the key in the address and keeps exceptions from the symbol map", () => {
    const c = readFeedConfig({ ...baseEnv, FYNX_FEED_API_KEY: "a+b/c", FYNX_FEED_SYMBOL_MAP: '{"USDHUF":"USD-HUF"}', FYNX_FEED_SYMBOL_FORMAT: "C:{symbol}" }, FOREX_PAIRS);
    expect(c.url).toContain("apiKey=a%2Bb%2Fc");
    expect(c.symbolMap).toMatchObject({ EURUSD: "C:EURUSD", USDHUF: "USD-HUF" });
    expect(providerSymbol("{base_lower}{quote_lower}", FOREX_PAIRS[0])).toBe(FOREX_PAIRS[0].symbol.toLowerCase());
  });

  it("lists every problem at once and never repeats the key", () => {
    let message = "";
    try {
      readFeedConfig({
        FYNX_FEED_URL: "ws://stream.provider.test/fx", FYNX_FEED_API_KEY: KEY, FYNX_FEED_FIELDS: '{"symbol":"pair","bid":"b"}',
        FYNX_FEED_TIME_UNIT: "minutes", FYNX_FEED_SYMBOL_FORMAT: "fx", FYNX_FEED_MAX_SPREAD_PIPS: "-1",
      }, FOREX_PAIRS);
    } catch (e) { message = (e as Error).message; }
    expect(message).toContain("must start with wss://");
    expect(message).toContain("FYNX_FEED_API_KEY is set but not used");
    expect(message).toContain('"ask" must be a path');
    expect(message).toContain("FYNX_FEED_TIME_UNIT must be ms, s or iso");
    expect(message).toContain("FYNX_FEED_SYMBOL_FORMAT must contain");
    expect(message).toContain("FYNX_FEED_MAX_SPREAD_PIPS must be a number");
    expect(message).not.toContain(KEY);
  });

  it("refuses missing settings, {key} without a key, credentials in the address, clashing names and unknown pairs", () => {
    expect(() => readFeedConfig({}, FOREX_PAIRS)).toThrow(/FYNX_FEED_URL is missing[\s\S]*FYNX_FEED_FIELDS is missing/);
    expect(() => readFeedConfig({ ...baseEnv, FYNX_FEED_API_KEY: "" }, FOREX_PAIRS)).toThrow(/uses \{key\} but FYNX_FEED_API_KEY is missing/);
    expect(() => readFeedConfig({ ...baseEnv, FYNX_FEED_URL: "wss://u:p@stream.provider.test/{key}" }, FOREX_PAIRS)).toThrow(/user name or password/);
    expect(() => readFeedConfig({ ...baseEnv, FYNX_FEED_SYMBOL_FORMAT: "{base}" }, FOREX_PAIRS)).toThrow(/would both be/);
    expect(() => readFeedConfig({ ...baseEnv, FYNX_FEED_SYMBOL_MAP: '{"BTCUSD":"X"}' }, FOREX_PAIRS)).toThrow(/BTCUSD is not a FYNX Trade pair/);
    expect(() => readFeedConfig({ ...baseEnv, FYNX_FEED_FIELDS: '{"symbol":"p","bid":"b","ask":"a","price":"x"}' }, FOREX_PAIRS)).toThrow(/unknown key\(s\) price/);
    expect(() => readFeedConfig({ ...baseEnv, FYNX_FEED_API_KEY: 'has "quote' }, FOREX_PAIRS)).toThrow(/quotes or backslashes/);
    // ws:// is accepted for a local test server only.
    expect(readFeedConfig({ ...baseEnv, FYNX_FEED_URL: "ws://localhost:9000/{key}" }, FOREX_PAIRS).url).toBe(`ws://localhost:9000/${KEY}`);
  });
});

describe("fieldParser", () => {
  it("reads a list inside matching messages, skips heartbeats and other message types", () => {
    const parse = fieldParser({ items: "data", match: { type: "quote" }, symbol: "pair", bid: "b", ask: "a", time: "t" }, "ms");
    expect(parse('{"type":"heartbeat"}')).toEqual([]);
    expect(parse('{"type":"status","data":[{"pair":"EUR/USD","b":1,"a":1,"t":1}]}')).toEqual([]);
    expect(parse(JSON.stringify({ type: "quote", data: [{ pair: "EUR/USD", b: "1.1", a: "1.1001", t: T0 }, { note: "x" }] })))
      .toEqual([{ symbol: "EUR/USD", bid: "1.1", ask: "1.1001", time: T0 }]);
    expect(() => parse("not json")).toThrow();
  });

  it("reads top-level lists, nested paths, seconds, ISO times, numeric strings and arrival time", () => {
    expect(readPath({ a: [{ b: 2 }] }, "a.0.b")).toBe(2);
    const secs = fieldParser({ symbol: "s", bid: "q.bid", ask: "q.ask", time: "ts" }, "s");
    expect(secs(JSON.stringify([{ s: "EURUSD", q: { bid: 1, ask: 2 }, ts: T0 / 1000 }, { s: "GBPUSD", q: { bid: 1, ask: 2 }, ts: String(T0 / 1000) }])).map(r => r.time)).toEqual([T0, T0]);
    const iso = fieldParser({ symbol: "s", bid: "b", ask: "a", time: "t" }, "iso");
    expect(iso({ s: "EURUSD", b: 1, a: 2, t: "2026-11-04T10:00:00Z" })[0].time).toBe(T0);
    const arrival = fieldParser({ symbol: "s", bid: "b", ask: "a" }, "ms", () => T0 + 5);
    expect(arrival({ s: "EURUSD", b: 1, a: 2 })[0].time).toBe(T0 + 5);
  });
});

describe("webSocketTransport", () => {
  it("subscribes on open, forwards text and binary messages, and closes without reporting when asked", () => {
    const { made, factory } = fakeSockets();
    const t = timers();
    const got: unknown[] = [], closes: (string | undefined)[] = [];
    const close = webSocketTransport({ url: "wss://x.test", subscribe: s => `sub:${s.join(",")}`, socket: factory, schedule: t.schedule, cancel: t.cancel })
      .open(["EUR/USD"], m => got.push(m), r => closes.push(r));
    made[0].onopen!({});
    expect(made[0].sent).toEqual(["sub:EUR/USD"]);
    made[0].onmessage!({ data: "hello" });
    made[0].onmessage!({ data: new TextEncoder().encode("bytes").buffer });
    made[0].onmessage!({ data: new TextEncoder().encode("view") });
    expect(got).toEqual(["hello", "bytes", "view"]);
    close();
    expect(made[0].closed).toBe(true);
    made[0].onclose!({ code: 1000 });
    expect(closes).toEqual([]);
    expect(t.pending()).toBe(0);
  });

  it("reports a provider close, an error and a silent connection once each, without the address", () => {
    for (const trigger of ["close", "error", "idle"] as const) {
      const { made, factory } = fakeSockets();
      const t = timers();
      const closes: (string | undefined)[] = [];
      webSocketTransport({ url: `wss://x.test/?k=${KEY}`, socket: factory, idleReconnectMs: 30_000, schedule: t.schedule, cancel: t.cancel })
        .open([], () => {}, r => closes.push(r));
      made[0].onopen!({});
      if (trigger === "close") { made[0].onclose!({ code: 1006 }); made[0].onerror!({}); }
      if (trigger === "error") { made[0].onerror!({}); made[0].onclose!({ code: 1006 }); }
      if (trigger === "idle") { t.advance(29_000); made[0].onmessage!({ data: "{}" }); t.advance(29_000); expect(closes).toEqual([]); t.advance(2_000); }
      expect(closes).toEqual([{ close: "closed by the provider (code 1006)", error: "connection error", idle: "no data for 30 s" }[trigger]]);
      expect(closes[0]).not.toContain(KEY);
      expect(made[0].closed).toBe(true);
    }
  });
});

describe("createFeedFromEnv", () => {
  it("feeds a venue end to end: prices fill a market order, bad ones are refused, the feed reconnects", async () => {
    const { made, factory } = fakeSockets();
    const t = timers();
    const { feed, config } = createFeedFromEnv(baseEnv, FOREX_PAIRS, { socket: factory, clock: t.clock, schedule: t.schedule, cancel: t.cancel });
    const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
    const docs = new Map<string, unknown>();
    const store: AccountStore = { load: async id => (docs.get(id) as never) ?? null, save: async s => { docs.set(s.accountId, structuredClone(s)); } };
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, hours: null }), store, async () => rules, { maxQuoteAgeMs: 60_000 }, t.clock);
    const stop = venue.connect(feed);

    expect(made[0].url).toBe(config.url);
    made[0].onopen!({});
    expect(JSON.parse(made[0].sent[0]).pairs).toHaveLength(45);
    const send = (data: unknown) => made[made.length - 1].onmessage!({ data: JSON.stringify(data) });
    send({ type: "quote", data: [
      { pair: "EUR/USD", b: 1.1, a: 1.1002, t: T0 },
      { pair: "EUR/USD", b: 1.1, a: 1.2, t: T0 },          // 1000-pip spread: refused
      { pair: "GBP/USD", b: 1.3, a: 1.2, t: T0 },          // bid above ask: refused
      { pair: "ABC/DEF", b: 1, a: 1.0001, t: T0 },         // not a FYNX pair
    ] });
    send("ping");
    expect(feed.health()).toMatchObject({ live: true, accepted: 1, rejected: { wide_spread: 1, crossed: 1, unknown_symbol: 1, parse_error: 0 } });

    await venue.open("acc_1");
    const placed = await venue.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, clientId: "c1" });
    expect(placed.state.positions[0]).toMatchObject({ symbol: "EURUSD", entryPrice: 1.1002 });

    made[0].onclose!({ code: 1006 });
    expect(feed.health()).toMatchObject({ connected: false, live: false, lastError: "closed by the provider (code 1006)" });
    t.advance(1_000);
    expect(made).toHaveLength(2);
    made[1].onopen!({});
    send({ type: "quote", data: [{ pair: "EUR/USD", b: 1.1001, a: 1.1003, t: T0 + 2_000 }] });
    expect(feed.health()).toMatchObject({ live: true, reconnects: 1, accepted: 2 });
    stop();
    expect(made[1].closed).toBe(true);
  });
});

describe("engine readiness check", () => {
  it("lists what is missing on an empty host, and reports ready with every setting in place", () => {
    const empty = engineChecklist({}, FOREX_PAIRS);
    expect(empty.map(i => [i.name, i.status])).toEqual([
      ["Trading settings", "missing"], ["Price feed settings", "missing"], ["Firebase access", "warn"], ["Trading switch", "info"], ["Email notices", "info"], ["Port", "info"],
    ]);
    expect(empty[4].detail[0]).toContain("no emails are sent");
    expect(empty[0].detail).toContain("FYNX_ENGINE_LEVERAGE is missing.");
    const full = engineChecklist({ ...engineEnv, ...baseEnv, K_SERVICE: "fynx-engine", FYNX_ENGINE_ALLOW_TRADING: "true", PORT: "8080" }, FOREX_PAIRS);
    expect(full.map(i => i.status)).toEqual(["ready", "ready", "ready", "info", "info", "info"]);
    expect(full[3].detail[0]).toContain("orders are accepted");
    const report = formatReport(full);
    expect(report).toContain("Ready to start");
    expect(report).toContain("apiKey=•••");
    expect(report).not.toContain(KEY);
    expect(formatReport(empty)).toContain("Not ready: 2 item(s)");
  });

  it("probes the feed for a few seconds and names silent pairs and refusals", async () => {
    const { made, factory } = fakeSockets();
    const t = timers();
    const { feed } = createFeedFromEnv(baseEnv, FOREX_PAIRS, { socket: factory, clock: t.clock, schedule: t.schedule, cancel: t.cancel });
    const probe = await probeFeed(feed, FOREX_PAIRS, 5, async ms => {
      made[0].onopen!({});
      made[0].onmessage!({ data: JSON.stringify({ type: "quote", data: [
        { pair: "EUR/USD", b: 1.1, a: 1.10012, t: T0 }, { pair: "EUR/USD", b: 1.1, a: 1.10012, t: T0 + 1 }, { pair: "Z/Z", b: 1, a: 1, t: T0 },
      ] }) });
      t.advance(ms);
    });
    expect(probe).toMatchObject({ seconds: 5, verdict: "partial", rejected: { unknown_symbol: 1 } });
    expect(probe.received).toEqual([{ symbol: "EURUSD", count: 2, bid: 1.1, ask: 1.10012, spreadPips: 1.2 }]);
    expect(probe.silent).toHaveLength(44);
    expect(made[0].closed).toBe(true);
    const text = formatReport(engineChecklist({ ...engineEnv, ...baseEnv }, FOREX_PAIRS), probe);
    expect(text).toContain("Prices received for 1 of 45 pairs.");
    expect(text).toContain("pair name not recognised");
  });

  it("runEngineCheck returns 1 until ready, refuses the feed test without settings and returns 0 when ready", async () => {
    const out: string[] = [];
    expect(await runEngineCheck({ env: {}, argv: ["--feed", "5"], pairs: FOREX_PAIRS, write: s => out.push(s) })).toBe(1);
    expect(out[0]).toContain("Price feed test: fill in the price feed settings first.");
    const { made, factory } = fakeSockets();
    const code = await runEngineCheck({
      env: { ...engineEnv, ...baseEnv }, argv: ["--feed", "3"], pairs: FOREX_PAIRS, socket: factory, write: s => out.push(s),
      wait: async () => {
        made[0].onopen!({});
        made[0].onmessage!({ data: JSON.stringify({ type: "quote", data: FOREX_PAIRS.map(p => ({ pair: `${p.base}/${p.quote}`, b: 1, a: 1, t: Date.now() })) }) });
      },
    });
    expect(code).toBe(0);
    expect(out[1]).toContain("Prices received for 45 of 45 pairs.");
    expect(out[1]).not.toContain(KEY);
  });
});

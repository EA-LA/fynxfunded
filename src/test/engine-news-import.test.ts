/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  mergeImported, NewsImporter, parseCalendar, readNewsImportConfig, type ImportedEvent, type NewsFetch,
} from "@/engine/news-import";
import { readNewsDocument, NEWS_MAX_EVENTS } from "@/engine/news";
import { engineChecklist, runEngineCheck } from "@/engine/preflight";
import { nodeListen, startEngineHost, type HostFirestore } from "@/engine/host-main";
import type { FirestoreLike } from "@/engine/firestore-store";
import { FOREX_PAIRS } from "@/trade-access/instruments";

// Test fixtures only: invented release names and times that exercise the import, not a real calendar.
const T0 = Date.parse("2026-11-04T10:00:00Z");
const KEY = "nk_test_SECRET_77";
const BASE = {
  FYNX_NEWS_URL: "https://calendar.provider.test/v1/events?from={from}&to={to}&token={key}",
  FYNX_NEWS_API_KEY: KEY,
  FYNX_NEWS_FIELDS: '{"items":"data","title":"event","time":"date","currency":"currency","country":"country","impact":"impact","id":"uid"}',
  FYNX_NEWS_IMPACT: "High, 3",
};

const answer = {
  data: [
    { uid: "a1", event: "Test release A", date: "2026-11-04T13:30:00Z", currency: "USD", impact: "High" },
    { uid: "a2", event: "Test release B", date: "2026-11-05T09:00:00+01:00", country: "Euro Area", impact: 3 },
    { uid: "a3", event: "Low test release", date: "2026-11-05T10:00:00Z", currency: "USD", impact: "Low" },
    { uid: "a4", event: "Test release C", date: "2026-11-06 12:00:00", currency: "GBP", impact: "high" },
    { uid: "a5", event: "Already over", date: "2026-11-01T12:00:00Z", currency: "JPY", impact: "High" },
    { uid: "a6", event: "Far ahead", date: "2026-12-30T12:00:00Z", currency: "JPY", impact: "High" },
    { uid: "a7", event: "No currency", date: "2026-11-06T12:00:00Z", currency: "ALL", impact: "High" },
    { uid: "a8", event: "Test release D", date: "2026-11-07T08:00:00Z", currency: "usd, cad", impact: "High" },
  ],
};

function memoryDb(docs = new Map<string, Record<string, unknown>>()) {
  const ref = (p: string) => ({ path: p, get: async () => ({ exists: docs.has(p), data: () => (docs.has(p) ? structuredClone(docs.get(p)) : undefined) }) });
  // Account lists (used by the host program) come back empty: no purchases in these tests.
  const query = (): Record<string, unknown> => ({ where: () => query(), limit: () => query(), get: async () => ({ docs: [] }) });
  const db = {
    collection: (c: string) => Object.assign(query(), { doc: (id: string) => ref(`${c}/${id}`) }),
    async runTransaction<T>(fn: (tx: { get: (r: { get(): Promise<unknown> }) => Promise<unknown>; set: (r: { path: string }, d: Record<string, unknown>) => void }) => Promise<T>) {
      const pending: [string, Record<string, unknown>][] = [];
      const out = await fn({ get: r => r.get(), set: (r, d) => { pending.push([r.path, d]); } });
      for (const [p, d] of pending) docs.set(p, structuredClone(d));
      return out;
    },
  };
  return { docs, db: db as unknown as FirestoreLike };
}

function fakeFetch(respond: (url: string) => { status?: number; body: string } | Promise<never>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f: NewsFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = await respond(url);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => r.body };
  };
  return { f, calls };
}

describe("news calendar import settings", () => {
  it("is off without FYNX_NEWS_URL", () => {
    expect(readNewsImportConfig({})).toBeNull();
  });

  it("fills the address for the period and keeps the key out of the safe address", () => {
    const c = readNewsImportConfig(BASE)!;
    expect(c.url(T0, T0 + 14 * 86_400_000)).toBe(`https://calendar.provider.test/v1/events?from=2026-11-04&to=2026-11-18&token=${KEY}`);
    expect(c.safeUrl).toBe("https://calendar.provider.test/v1/events?from={from}&to={to}&token=•••");
    expect(c.impact).toEqual(["high", "3"]);
    expect(c.timeUnit).toBe("iso");
    expect(c.everyMs).toBe(360 * 60_000);
    expect(c.days).toBe(14);
  });

  it("puts the key in a header when asked", () => {
    const c = readNewsImportConfig({ ...BASE, FYNX_NEWS_URL: "https://calendar.provider.test/v1/events?from={from_unix}", FYNX_NEWS_HEADERS: '{"Authorization":"Bearer {key}"}' })!;
    expect(c.headers).toEqual({ Authorization: `Bearer ${KEY}` });
    expect(c.url(T0, T0)).toBe(`https://calendar.provider.test/v1/events?from=${T0 / 1000}`);
  });

  it("lists every problem at once and never the key", () => {
    let message = "";
    try {
      readNewsImportConfig({
        FYNX_NEWS_URL: "http://calendar.provider.test/v1", FYNX_NEWS_API_KEY: KEY,
        FYNX_NEWS_FIELDS: '{"title":"event","when":"date"}', FYNX_NEWS_IMPACT: "High",
        FYNX_NEWS_TIME_UNIT: "minutes", FYNX_NEWS_EVERY_MINUTES: "5", FYNX_NEWS_DAYS: "90", FYNX_NEWS_HEADERS: '{"X Bad":"v"}',
      });
    } catch (e) { message = (e as Error).message; }
    expect(message).toContain("must start with https://");
    expect(message).toContain("FYNX_NEWS_API_KEY is set but not used");
    expect(message).toContain('unknown key(s) when');
    expect(message).toContain('"time" is required');
    expect(message).toContain('give "currency" or "country"');
    expect(message).toContain('has no "impact" path');
    expect(message).toContain("must be iso, iso-utc, s or ms");
    expect(message).toContain("FYNX_NEWS_EVERY_MINUTES must be a whole number from 15 to 1440");
    expect(message).toContain("FYNX_NEWS_DAYS must be a whole number from 1 to 60");
    expect(message).toContain('FYNX_NEWS_HEADERS: "X Bad"');
    expect(message).not.toContain(KEY);
  });

  it("asks for the key when the address uses {key} without one", () => {
    expect(() => readNewsImportConfig({ ...BASE, FYNX_NEWS_API_KEY: "" })).toThrow(/\{key\} is used but FYNX_NEWS_API_KEY is missing/);
  });
});

describe("reading the provider's answer", () => {
  const c = readNewsImportConfig(BASE)!;

  it("keeps high-impact releases in the period, maps countries to currencies and names what it skipped", () => {
    const r = parseCalendar(answer, c, T0);
    expect(r.found).toBe(8);
    expect(r.lowImpact).toBe(1);
    expect(r.outsidePeriod).toBe(2);
    expect(r.unreadable).toBe(2); // zone-less time under "iso", unknown currency
    expect(r.events.map(e => [e.id, e.at, e.currencies])).toEqual([
      ["imp-a1", "2026-11-04T13:30:00.000Z", ["USD"]],
      ["imp-a2", "2026-11-05T08:00:00.000Z", ["EUR"]],
      ["imp-a8", "2026-11-07T08:00:00.000Z", ["USD", "CAD"]],
    ]);
    expect(r.events.every(e => e.source === "import")).toBe(true);
    expect(r.problems.join(" ")).toContain('Release 4 ("Test release C") has no readable time');
    expect(r.problems.join(" ")).toContain("FYNX_NEWS_TIME_UNIT=iso-utc");
    expect(r.problems.join(" ")).toContain('Release 7 ("No currency") has no currency or country');
  });

  it("reads zone-less times as UTC with iso-utc, and seconds", () => {
    const utc = parseCalendar(answer, { ...c, timeUnit: "iso-utc" }, T0);
    expect(utc.events.find(e => e.id === "imp-a4")?.at).toBe("2026-11-06T12:00:00.000Z");
    const secs = parseCalendar([{ event: "Seconds", date: Date.parse("2026-11-05T12:00:00Z") / 1000, currency: "JPY" }], { ...c, fields: { title: "event", time: "date", currency: "currency" }, impact: null, timeUnit: "s" }, T0);
    expect(secs.events[0]).toMatchObject({ at: "2026-11-05T12:00:00.000Z", currencies: ["JPY"] });
  });

  it("gives releases without a provider id a stable id and drops duplicates", () => {
    const cfg = { ...c, fields: { title: "event", time: "date", currency: "currency" }, impact: null };
    const item = { event: "Repeat", date: "2026-11-05T12:00:00Z", currency: "CHF" };
    const a = parseCalendar([item, { ...item }], cfg, T0);
    const b = parseCalendar([{ ...item, event: "  repeat " }], cfg, T0);
    expect(a.events).toHaveLength(1);
    expect(a.events[0].id).toMatch(/^imp-20261105T1200-CHF-[0-9a-f]{8}$/);
    expect(b.events[0].id).toBe(a.events[0].id);
  });

  it("refuses an answer without the list", () => {
    expect(() => parseCalendar({ results: [] }, c, T0)).toThrow(/no list at "data"/);
    expect(() => parseCalendar({}, { ...c, fields: { ...c.fields, items: undefined } }, T0)).toThrow(/not a list/);
  });
});

describe("merging into engineControl/news", () => {
  const imported = (id: string, at: string, currencies: string[]): ImportedEvent => ({ id, title: id, at, currencies, source: "import" });

  it("keeps the owner's settings and own events, replaces the previous import and skips releases the owner already lists", () => {
    const owner = { title: "NFP (owner)", at: "2026-11-06T13:30:00Z", currencies: ["USD"], beforeMinutes: 10 };
    const doc = mergeImported(
      { enforce: true, holdPending: true, beforeMinutes: 3, events: [owner, imported("imp-old", "2026-11-05T10:00:00Z", ["JPY"])] },
      [imported("imp-n1", "2026-11-06T13:30:00Z", ["USD"]), imported("imp-n2", "2026-11-06T13:30:00Z", ["GBP"]), imported("imp-n3", "2026-11-07T10:00:00Z", ["EUR"])],
      { at: T0, source: "calendar.provider.test", problems: [] },
    );
    expect(doc).toMatchObject({ enforce: true, holdPending: true, beforeMinutes: 3 });
    expect((doc.events as { id?: string; title: string }[]).map(e => e.id ?? e.title)).toEqual(["NFP (owner)", "imp-n2", "imp-n3"]);
    expect(doc.imported).toEqual({ at: "2026-11-04T10:00:00.000Z", source: "calendar.provider.test", events: 2, alreadyListed: 1, problems: [] });

    // The engine reads the merged document like a hand-typed one.
    const r = readNewsDocument(doc, T0);
    expect(r.problems).toEqual([]);
    expect(r.state.enforce).toBe(true);
    expect(r.state.windows.map(w => w.id)).toEqual(["2026-11-06T13:30-USD", "imp-n2", "imp-n3"]);
    expect(r.state.windows[0].from).toBe(Date.parse("2026-11-06T13:20:00Z")); // the owner's own minutes
  });

  it("never grows the calendar past its limit", () => {
    const own = Array.from({ length: NEWS_MAX_EVENTS - 1 }, (_, i) => ({ title: `own ${i}`, at: "2026-11-20T10:00:00Z", currencies: ["AUD"] }));
    const doc = mergeImported({ events: own }, [imported("imp-a", "2026-11-05T10:00:00Z", ["USD"]), imported("imp-b", "2026-11-06T10:00:00Z", ["USD"])], { at: T0, source: "x", problems: [] });
    expect((doc.events as unknown[]).length).toBe(NEWS_MAX_EVENTS);
    expect((doc.imported as { problems: string[] }).problems[0]).toContain("Only 1 of 2 imported releases fit");
  });
});

describe("NewsImporter", () => {
  const config = readNewsImportConfig(BASE)!;

  it("downloads, writes the calendar and keeps it when a later download fails", async () => {
    const { docs, db } = memoryDb(new Map([["engineControl/news", { enforce: false, events: [{ title: "Own", at: "2026-11-09T12:00:00Z", currencies: "NZD" }] }]]));
    let mode: "ok" | "500" | "bad" | "empty" | "hang" = "ok";
    const { f, calls } = fakeFetch(() => mode === "ok" ? { body: JSON.stringify(answer) } : mode === "500" ? { status: 500, body: "" } : mode === "bad" ? { body: "<html>" } : mode === "empty" ? { body: '{"data":[]}' } : new Promise<never>(() => {}));
    const results: boolean[] = [];
    const imp = new NewsImporter({ config, db, fetch: f, clock: () => T0, timeoutMs: 50, onResult: r => results.push(r.written) });

    const first = await imp.run();
    expect(first).toMatchObject({ ok: true, written: true, imported: 3, error: null });
    expect(calls[0].url).toContain("from=2026-11-04&to=2026-11-18");
    expect(calls[0].headers.Accept).toBe("application/json");
    const written = docs.get("engineControl/news")!;
    expect(written.enforce).toBe(false); // importing never switches the rule on
    expect((written.events as { title: string }[]).map(e => e.title)).toEqual(["Own", "Test release A", "Test release B", "Test release D"]);
    expect(imp.health()).toMatchObject({ source: "calendar.provider.test", lastImported: 3, failuresInARow: 0, lastError: null });

    for (const [m, text] of [["500", "answered HTTP 500"], ["bad", "not JSON"], ["empty", "no releases for the period"], ["hang", "did not answer within"]] as const) {
      mode = m;
      const r = await imp.run();
      expect(r.written).toBe(false);
      expect(r.error).toContain(text);
      expect(docs.get("engineControl/news")).toEqual(written);
    }
    expect(imp.health().failuresInARow).toBe(4);
    expect(results).toEqual([true, false, false, false, false]);
  });

  it("never puts the key in an error and shares one run between overlapping calls", async () => {
    const { db } = memoryDb();
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    let n = 0;
    const f: NewsFetch = async url => { n += 1; await gate; throw new Error(`connect failed for ${url}`); };
    const imp = new NewsImporter({ config, db, fetch: f, clock: () => T0 });
    const a = imp.run(), b = imp.run();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(n).toBe(1);
    expect(ra).toBe(rb);
    expect(ra.error).toContain("token=•••");
    expect(ra.error).not.toContain(KEY);
  });

  it("explains 401 answers", async () => {
    const { db } = memoryDb();
    const { f } = fakeFetch(() => ({ status: 401, body: "" }));
    const r = await new NewsImporter({ config, db, fetch: f, clock: () => T0 }).run();
    expect(r.error).toContain("check FYNX_NEWS_API_KEY");
  });
});

describe("readiness check", () => {
  const ENV = {
    FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50",
    FYNX_ENGINE_ALLOWED_ORIGINS: "https://www.fynxfunded.com",
    FYNX_FEED_URL: "wss://stream.provider.test/fx", FYNX_FEED_FIELDS: '{"symbol":"pair","bid":"b","ask":"a"}', K_SERVICE: "fynx-engine",
  };

  it("shows the import as off, ready or missing", () => {
    const item = (env: Record<string, string>) => engineChecklist(env, FOREX_PAIRS).find(i => i.name === "News calendar import")!;
    expect(item(ENV).status).toBe("info");
    const ready = item({ ...ENV, ...BASE });
    expect(ready.status).toBe("ready");
    expect(ready.detail.join(" ")).toContain("token=•••");
    expect(ready.detail.join(" ")).not.toContain(KEY);
    expect(ready.detail.join(" ")).toContain("every 6 hour(s)");
    expect(item({ ...ENV, FYNX_NEWS_URL: "ftp://x" }).status).toBe("missing");
  });

  it("--news downloads once, lists what would be imported and writes nothing", async () => {
    const { f } = fakeFetch(() => ({ body: JSON.stringify(answer) }));
    let out = "";
    const code = await runEngineCheck({ env: { ...ENV, ...BASE }, argv: ["--news"], pairs: FOREX_PAIRS, fetch: f, write: t => { out = t; }, clock: () => T0 });
    expect(code).toBe(0);
    expect(out).toContain("[ready]   News calendar test (downloaded once, nothing written)");
    expect(out).toContain("8 release(s) in the answer; 3 would be imported, 1 below the impact filter, 2 outside the period, 2 unreadable.");
    expect(out).toContain("2026-11-04 13:30 UTC  USD  Test release A");
    expect(out).not.toContain(KEY);

    const off = await runEngineCheck({ env: ENV, argv: ["--news"], pairs: FOREX_PAIRS, fetch: f, write: t => { out = t; } });
    expect(off).toBe(1);
    expect(out).toContain("[missing] News calendar test: set FYNX_NEWS_URL");
  });
});

describe("engine host with the calendar import", () => {
  it("imports on start, refreshes the windows traders see and stops cleanly", async () => {
    const { docs, db } = memoryDb();
    const { f } = fakeFetch(() => ({ body: JSON.stringify(answer) }));
    const lines: string[] = [];
    const running = await startEngineHost({
      env: {
        FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50",
        FYNX_ENGINE_ALLOWED_ORIGINS: "https://www.fynxfunded.com", FYNX_FEED_URL: "wss://stream.provider.test/fx",
        FYNX_FEED_FIELDS: '{"symbol":"pair","bid":"b","ask":"a"}', K_SERVICE: "fynx-engine", PORT: "0", FYNX_ENGINE_LEDGER_CATCHUP_DAYS: "0", ...BASE,
      },
      pairs: FOREX_PAIRS, db: db as unknown as HostFirestore,
      verifyIdToken: async () => { throw new Error("no"); },
      socket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} }),
      listen: nodeListen(handler => createServer(handler)),
      log: l => lines.push(l), healthLogEveryMs: 0, clock: () => T0, fetch: f,
    });
    try {
      const first = await running.newsImport!.run();
      expect(first.written).toBe(true);
      expect((docs.get("engineControl/news")!.imported as { events: number }).events).toBe(3);
      await running.news.refresh();
      expect(running.news.current().windows.map(w => w.id)).toEqual(["imp-a1", "imp-a2", "imp-a8"]);
      const parsed = lines.map(l => JSON.parse(l));
      expect(parsed.find(l => l.message === "FYNX trading engine started.")?.newsImport).toBe("from calendar.provider.test, next 14 day(s), every 360 min");
      expect(parsed.some(l => String(l.message).startsWith("News calendar imported into engineControl/news"))).toBe(true);
      expect(lines.join("\n")).not.toContain(KEY);
    } finally {
      await running.stop();
    }
  });
});

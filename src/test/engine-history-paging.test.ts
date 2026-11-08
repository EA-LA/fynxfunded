import { describe, expect, it, vi } from "vitest";
import type { AccountState, Deal, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, type AccountStore } from "@/engine/venue";
import { DisconnectedGateway, HttpGateway, LocalGatewayAdapter, parseHistoryPage } from "@/engine/gateway";
import { handleEngineRequest, parseChunk, type HostOptions } from "@/engine/host";
import { FirestoreAccountStore, type DocRefLike, type FirestoreLike } from "@/engine/firestore-store";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-02T10:00:00Z"); // Monday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22, consistencyPercent: 40 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });

async function trade(venue: LocalVenue, n: number, clock: { now: number }, account = "acc_1") {
  for (let i = 0; i < n; i++) {
    clock.now += 3_600_000;
    venue.quotes.EURUSD = { symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: clock.now };
    const opened = await venue.place(account, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, clientId: `c-${account}-${clock.now}` });
    venue.quotes.EURUSD = { symbol: "EURUSD", bid: 1.0806, ask: 1.0807, time: clock.now };
    await venue.close(account, opened.state.positions[0].id);
  }
}

function fakeFirestore(): FirestoreLike {
  const docs = new Map<string, Record<string, unknown>>();
  const ref = (path: string): DocRefLike & { path: string } => ({ path, get: async () => ({ exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) }) });
  return {
    collection: c => ({ doc: id => ref(`${c}/${id}`) }),
    async runTransaction(fn) {
      const pending: [string, Record<string, unknown>][] = [];
      const result = await fn({ get: r => r.get(), set: (r, d) => { pending.push([(r as DocRefLike & { path: string }).path, d]); } });
      pending.forEach(([p, d]) => docs.set(p, structuredClone(d)));
      return result;
    },
  };
}

function host(venue: LocalVenue) {
  const opts: HostOptions = {
    venue,
    verifyToken: async t => (t === "good" ? "u1" : t === "other" ? "u2" : null),
    canAccess: async (u, a) => u === "u1" && a === "acc_1",
    tradingEnabled: async () => false,
    status: () => ({ priceFeed: true, execution: true, message: "ok" }),
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const r = await handleEngineRequest({ method: init?.method ?? "GET", path: `${u.pathname}${u.search}`, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  return { opts, fetcher, gw: new HttpGateway("https://api.example.com", async () => "good", fetcher) };
}

/** Reads every archive page through a gateway (newest first, like the terminal) and returns them oldest first. */
async function readAll(gw: { archivedDeals(id: string, i: number): Promise<{ deals: Deal[]; chunks: number }> }, chunks: number) {
  const out: Deal[][] = [];
  for (let i = chunks - 1; i >= 0; i--) out.unshift((await gw.archivedDeals("acc_1", i)).deals);
  return out.flat();
}

describe("archived history paging", () => {
  it("MemoryStore archives like the Firestore store and the venue pages through it without changing the account", async () => {
    const clock = { now: T0 };
    const archiving = new MemoryStore({ archive: { aboveDeals: 6, keepRecentDeals: 3, chunkSize: 2, resetHourUtc: 22 } });
    const plain = new MemoryStore();
    const counter = () => { let n = 0; return (p: string) => `${p}_${++n}`; };
    const venue = new LocalVenue(specs, archiving, async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock.now, counter());
    const twin = new LocalVenue(specs, plain, async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock.now, counter());
    await venue.open("acc_1"); await twin.open("acc_1");
    await trade(venue, 10, clock); clock.now = T0; await trade(twin, 10, clock);

    const state = (await archiving.load("acc_1"))!;
    const full = (await plain.load("acc_1"))!;
    expect(state.archived!.deals + state.history.length).toBe(10);
    expect(state.archived!.chunks).toBeGreaterThan(1);
    const pages = await readAll(new LocalGatewayAdapter(venue), state.archived!.chunks);
    expect([...pages, ...state.history]).toEqual(full.history);

    const page = await venue.history("acc_1", 0);
    expect(page).toMatchObject({ accountId: "acc_1", index: 0, chunks: state.archived!.chunks });
    expect(page.firstClosedAt).toBe(page.deals[0].closedAt);
    expect((await archiving.load("acc_1"))!.sequence).toBe(state.sequence); // read-only
    await expect(venue.history("acc_1", state.archived!.chunks)).rejects.toMatchObject({ code: "no_chunk" });
    await expect(venue.history("acc_1", -1)).rejects.toMatchObject({ code: "bad_request" });
    await expect(venue.history("acc_1", 1.5)).rejects.toMatchObject({ code: "bad_request" });
    await expect(venue.history("nobody", 0)).rejects.toMatchObject({ code: "no_account" });
    await expect(twin.history("acc_1", 0)).rejects.toMatchObject({ code: "no_chunk", message: "This account has no archived trades." });
  });

  it("says when the store cannot read archives, or a page is missing or belongs to someone else", async () => {
    const archived: AccountState = { accountId: "acc_1", currency: "USD", status: "active", balance: 10000, dayStartBalance: 10000, tradingDay: "2026-11-01", tradingDays: [], positions: [], orders: [], history: [], sequence: 3,
      archived: { deals: 4, chunks: 2, netProfit: 0, dailyResults: {}, resetHourUtc: 22, clientIds: [], firstClosedAt: T0, lastClosedAt: T0 } };
    const noReader: AccountStore = { load: async () => archived, save: async () => undefined };
    await expect(new LocalVenue(specs, noReader, async () => rules, { maxQuoteAgeMs: 60_000 }).history("acc_1", 0)).rejects.toMatchObject({ code: "no_archive" });
    const missing: AccountStore = { ...noReader, archivedDeals: async () => null };
    await expect(new LocalVenue(specs, missing, async () => rules, { maxQuoteAgeMs: 60_000 }).history("acc_1", 1)).rejects.toMatchObject({ code: "no_chunk" });
    const foreign: AccountStore = { ...noReader, archivedDeals: async () => ({ accountId: "acc_2", index: 1, firstClosedAt: T0, lastClosedAt: T0, deals: [] }) };
    await expect(new LocalVenue(specs, foreign, async () => rules, { maxQuoteAgeMs: 60_000 }).history("acc_1", 1)).rejects.toMatchObject({ code: "bad_state" });
  });

  it("serves GET /v1/accounts/{id}/history?chunk=n to HttpGateway from the Firestore store", async () => {
    const clock = { now: T0 };
    const store = new FirestoreAccountStore(fakeFirestore(), { clock: () => clock.now, archive: { aboveBytes: 3_000, keepRecentDeals: 2, chunkSize: 3 } });
    const mem = new MemoryStore();
    const counter = () => { let n = 0; return (p: string) => `${p}_${++n}`; };
    const venue = new LocalVenue(specs, store, async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock.now, counter());
    const twin = new LocalVenue(specs, mem, async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock.now, counter());
    await venue.open("acc_1"); await twin.open("acc_1");
    await trade(venue, 12, clock); clock.now = T0; await trade(twin, 12, clock);
    const { gw, fetcher } = host(venue);

    const snap = await gw.snapshot("acc_1");
    const chunks = snap.state.archived!.chunks;
    expect(chunks).toBeGreaterThan(1);
    const pages = await readAll(gw, chunks);
    expect([...pages, ...snap.state.history]).toEqual(JSON.parse(JSON.stringify((await mem.load("acc_1"))!.history)));
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/accounts/acc_1/history?chunk=0", expect.objectContaining({ method: "GET" }));
    await expect(gw.archivedDeals("acc_1", chunks)).rejects.toMatchObject({ code: "no_chunk" });
    await expect(gw.archivedDeals("acc_1", -1)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("checks the address, the chunk number, the token and who owns the account", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    await venue.open("acc_1"); await venue.open("acc_2");
    const { opts } = host(venue);
    const get = (path: string, token = "good", method = "GET") => handleEngineRequest({ method, path, headers: { Authorization: `Bearer ${token}` } }, opts);
    expect(await get("/v1/accounts/acc_1/history")).toMatchObject({ status: 400, body: { error: { code: "bad_request" } } });
    for (const q of ["-1", "1.5", "abc", "", "1e3", "9999999"]) expect((await get(`/v1/accounts/acc_1/history?chunk=${q}`)).status).toBe(400);
    expect(await get("/v1/accounts/acc_1/history?chunk=0")).toMatchObject({ status: 404, body: { error: { code: "no_chunk" } } });
    expect((await get("/v1/accounts/acc_2/history?chunk=0")).status).toBe(403);
    expect((await get("/v1/accounts/acc_1/history?chunk=0", "bad")).status).toBe(401);
    expect((await get("/v1/accounts/acc_1/history?chunk=0", "good", "POST")).status).toBe(405);
    expect((await get("/v1/accounts/acc_1/history/0")).status).toBe(404);
    expect(parseChunk({ path: "/x", query: { chunk: "7" } })).toBe(7);
    expect(parseChunk({ path: "/x?chunk=2&other=1" })).toBe(2);
    expect(() => parseChunk({ path: "/x?chunk=2", query: {} })).toThrow(/chunk=n/); // the parsed query wins
  });

  it("refuses an archive page from the server that is for another account or page, or has a malformed trade", () => {
    const deal: Deal = { id: "p:1", positionId: "p", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.081, openedAt: T0, closedAt: T0 + 1, grossProfit: 100, commission: 7, netProfit: 93, reason: "manual" };
    const good = { accountId: "acc_1", index: 1, chunks: 3, firstClosedAt: T0 + 1, lastClosedAt: T0 + 1, deals: [deal] };
    expect(parseHistoryPage(good, "acc_1", 1)).toEqual(good);
    expect(parseHistoryPage({ ...good, extra: "ignored" }, "acc_1", 1)).toEqual(good);
    for (const bad of [null, "x", { ...good, accountId: "acc_2" }, { ...good, index: 0 }, { ...good, chunks: 1 }, { ...good, deals: "no" }, { ...good, lastClosedAt: "soon" },
      { ...good, deals: [{ ...deal, netProfit: "93" }] }, { ...good, deals: [{ ...deal, reason: "magic" }] }, { ...good, deals: [{ ...deal, symbol: "<b>" }] }, { ...good, deals: [{ ...deal, swap: Number.NaN }] }]) {
      expect(() => parseHistoryPage(bad, "acc_1", 1)).toThrow(/archive page/);
    }
  });

  it("sends nothing while disconnected", async () => {
    await expect(new DisconnectedGateway().archivedDeals()).rejects.toMatchObject({ code: "not_connected" });
  });
});

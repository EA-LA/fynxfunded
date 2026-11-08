import { describe, expect, it } from "vitest";
import { archiveHistory, dailyResults, placeOrder, targetReport, type EngineContext } from "@/engine/core";
import type { AccountState, Deal, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore } from "@/engine/venue";
import { archiveChunkId, FirestoreAccountStore, toFirestoreData, type DocRefLike, type FirestoreLike } from "@/engine/firestore-store";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-02T10:00:00Z"); // Monday, market open
const DAY = 86_400_000;
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22, consistencyPercent: 40 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });

function deal(i: number, netProfit: number, closedAt: number, clientId?: string): Deal {
  return { id: `pos_${i}:${i + 1}`, positionId: `pos_${i}`, symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.081, openedAt: closedAt - 60_000, closedAt, grossProfit: netProfit, commission: 0, netProfit, reason: "manual", ...(clientId ? { clientId } : {}) };
}
function account(history: Deal[]): AccountState {
  const balance = 10000 + history.reduce((t, d) => t + d.netProfit, 0);
  return { accountId: "acc_1", currency: "USD", status: "active", balance, dayStartBalance: balance, tradingDay: "2026-11-05", tradingDays: ["2026-11-01", "2026-11-02", "2026-11-03"], positions: [], orders: [], history, sequence: 40 };
}

describe("archiveHistory", () => {
  const history = [deal(0, 120, T0, "c-0"), deal(1, -40, T0 + 1000), deal(2, 300, T0 + DAY, "c-2"), deal(3, 80, T0 + 2 * DAY), deal(4, 50, T0 + 2 * DAY + 5000, "c-4")];

  it("keeps the newest deals, numbers the chunks and leaves trading state alone", () => {
    const before = account(history);
    const { state, chunks } = archiveHistory(before, { keep: 2, resetHourUtc: 22, chunkSize: 2 });
    expect(state.history.map(d => d.id)).toEqual(["pos_3:4", "pos_4:5"]);
    expect(chunks.map(c => [c.index, c.deals.map(d => d.id)])).toEqual([[0, ["pos_0:1", "pos_1:2"]], [1, ["pos_2:3"]]]);
    expect(state.archived).toEqual({ deals: 3, chunks: 2, netProfit: 380, dailyResults: { "2026-11-01": 80, "2026-11-02": 300 }, resetHourUtc: 22, clientIds: ["c-0", "c-2"], firstClosedAt: T0, lastClosedAt: T0 + DAY });
    expect({ ...state, history: before.history, archived: undefined }).toEqual({ ...before, archived: undefined });
    expect(before.history).toHaveLength(5); // input not mutated
    expect(archiveHistory(state, { keep: 5, resetHourUtc: 22 }).state).toBe(state); // nothing to move
  });

  it("gives the same daily results and target report after archiving, also across several archives", () => {
    const before = account(history);
    const once = archiveHistory(before, { keep: 3, resetHourUtc: 22 });
    const twice = archiveHistory(once.state, { keep: 0, resetHourUtc: 22, chunkSize: 1 });
    expect(twice.chunks.map(c => c.index)).toEqual([1, 2, 3]);
    expect(twice.state.archived).toMatchObject({ deals: 5, chunks: 4, netProfit: 510, clientIds: ["c-0", "c-2", "c-4"], firstClosedAt: T0, lastClosedAt: T0 + 2 * DAY + 5000 });
    for (const s of [once.state, twice.state]) {
      expect(dailyResults(s, 22)).toEqual(dailyResults(before, 22));
      expect(targetReport(s, rules)).toEqual(targetReport(before, rules));
    }
    expect(targetReport(twice.state, rules).bestDay).toEqual({ day: "2026-11-02", profit: 300 });
    expect(() => dailyResults(twice.state, 21)).toThrow(/reset hour/);
  });

  it("caps remembered client ids at the newest ones", () => {
    const { state } = archiveHistory(account(history), { keep: 0, resetHourUtc: 22, maxClientIds: 2 });
    expect(state.archived!.clientIds).toEqual(["c-2", "c-4"]);
    expect(archiveHistory(account(history), { keep: 0, resetHourUtc: 22, maxClientIds: 0 }).state.archived!.clientIds).toEqual([]);
  });

  it("still recognises a retried order whose deal was archived", () => {
    const { state } = archiveHistory(account(history), { keep: 1, resetHourUtc: 22 });
    const ctx: EngineContext = { specs, quotes: { EURUSD: { symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 + 3 * DAY } }, rules, now: T0 + 3 * DAY, maxQuoteAgeMs: 60_000, newId: p => `${p}_x` };
    const replay = placeOrder(state, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c-0" }, ctx);
    expect(replay.state).toBe(state);
    expect(replay.events).toEqual([]);
    expect(placeOrder(state, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c-new" }, ctx).state.positions).toHaveLength(1);
  });
});

/** In-memory Admin SDK stand-in with all-or-nothing transactions; `failNext` makes the next commit fail. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  const commits: string[][] = [];
  let failNext = false;
  const ref = (path: string): DocRefLike & { path: string } => ({ path, get: async () => ({ exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) }) });
  const db: FirestoreLike = {
    collection: c => ({ doc: id => ref(`${c}/${id}`) }),
    async runTransaction(fn) {
      const pending: [string, Record<string, unknown>][] = [];
      const result = await fn({ get: r => r.get(), set: (r, d) => { pending.push([(r as DocRefLike & { path: string }).path, d]); } });
      if (failNext) { failNext = false; throw new Error("commit failed"); }
      pending.forEach(([p, d]) => docs.set(p, structuredClone(d)));
      commits.push(pending.map(([p]) => p));
      return result;
    },
  };
  return { db, docs, commits, failNextCommit: () => { failNext = true; } };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe("FirestoreAccountStore history archive", () => {
  async function trade(venue: LocalVenue, n: number, start: number, clock: { now: number }) {
    for (let i = 0; i < n; i++) {
      clock.now = start + i * 3_600_000;
      const bid = 1.08 + (i % 3) * 0.0004;
      venue.quotes.EURUSD = { symbol: "EURUSD", bid, ask: bid + 0.0001, time: clock.now };
      const opened = await venue.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5, clientId: `c-${start}-${i}` });
      venue.quotes.EURUSD = { symbol: "EURUSD", bid: bid + 0.0006, ask: bid + 0.0007, time: clock.now };
      await venue.close("acc_1", opened.state.positions[0].id);
    }
  }

  it("moves old deals to numbered chunks in the same write once the document is big, and the engine keeps every result", async () => {
    const fs = fakeFirestore();
    const clock = { now: T0 };
    const store = new FirestoreAccountStore(fs.db, { clock: () => clock.now, archive: { aboveBytes: 6_000, keepRecentDeals: 5, chunkSize: 4 } });
    // Same id sequence on both venues so the stored histories can be compared deal by deal.
    const counter = () => { let n = 0; return (p: string) => `${p}_${++n}`; };
    const venue = new LocalVenue(specs, store, async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock.now, counter());
    const mem = new MemoryStore();
    const twin = new LocalVenue(specs, mem, async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock.now, counter());
    await venue.open("acc_1"); await twin.open("acc_1");
    await trade(venue, 12, T0, clock); await trade(twin, 12, T0, clock);
    await trade(venue, 12, T0 + DAY, clock); await trade(twin, 12, T0 + DAY, clock);

    const doc = fs.docs.get("engineAccounts/acc_1")!;
    expect(bytes(doc)).toBeLessThanOrEqual(6_000 + 1_500);
    const stored = (await store.load("acc_1"))!;
    const full = (await mem.load("acc_1"))!;
    expect(stored.archived!.deals + stored.history.length).toBe(24);
    expect(stored.history.length).toBeLessThan(24);
    expect(stored.balance).toBe(full.balance);
    expect(stored.sequence).toBe(full.sequence);
    expect(targetReport(stored, rules)).toEqual(targetReport(full, rules));
    expect(stored.history.map(d => d.id)).toEqual(full.history.slice(-stored.history.length).map(d => d.id));

    // Every archived chunk is there, in order, and together with the account they are the full history.
    const archived: Deal[] = [];
    for (let i = 0; i < stored.archived!.chunks; i++) {
      const chunk = (await store.archivedDeals("acc_1", i))!;
      expect(chunk).toMatchObject({ accountId: "acc_1", index: i });
      expect(fs.docs.has(`engineAccounts/acc_1/history/${archiveChunkId(i)}`)).toBe(true);
      archived.push(...chunk.deals);
    }
    expect([...archived, ...stored.history]).toEqual(JSON.parse(JSON.stringify(full.history)));
    expect(await store.archivedDeals("acc_1", stored.archived!.chunks)).toBeNull();
    await expect(store.archivedDeals("acc_1", -1)).rejects.toMatchObject({ code: "bad_request" });

    // Chunks were written in the same commit as the account document.
    const archiveCommit = fs.commits.find(c => c.some(p => p.includes("/history/")))!;
    expect(archiveCommit).toContain("engineAccounts/acc_1");

    // A retry whose deal is archived is still recognised: nothing new opens.
    const replay = await venue.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5, clientId: `c-${T0}-0` });
    expect(replay.state.positions).toEqual([]);
  });

  it("writes nothing when the commit fails, and a conflict leaves the archive untouched", async () => {
    const fs = fakeFirestore();
    const store = new FirestoreAccountStore(fs.db, { archive: { aboveBytes: 1, keepRecentDeals: 1 } });
    const s = account([deal(0, 10, T0), deal(1, 20, T0 + 1), deal(2, 30, T0 + 2)]);
    await store.save({ ...s, history: [] }, -1);
    const first = structuredClone(fs.docs.get("engineAccounts/acc_1"));
    fs.failNextCommit();
    await expect(store.save({ ...s, sequence: 41 }, 40)).rejects.toThrow("commit failed");
    expect(fs.docs.get("engineAccounts/acc_1")).toEqual(first);
    expect([...fs.docs.keys()].some(k => k.includes("/history/"))).toBe(false);
    await expect(store.save({ ...s, sequence: 42 }, 39)).rejects.toMatchObject({ code: "conflict" });
    expect([...fs.docs.keys()].some(k => k.includes("/history/"))).toBe(false);
    await store.save({ ...s, sequence: 41 }, 40);
    expect((await store.load("acc_1"))!.history.map(d => d.id)).toEqual(["pos_2:3"]);
  });

  it("can be turned off, and refuses a malformed archive summary", async () => {
    const fs = fakeFirestore();
    const off = new FirestoreAccountStore(fs.db, { archive: false, maxDocumentBytes: 1_000 });
    const s = account(Array.from({ length: 10 }, (_, i) => deal(i, 1, T0 + i)));
    await expect(off.save(s, -1)).rejects.toMatchObject({ code: "state_too_large" });
    const { state } = archiveHistory(s, { keep: 1, resetHourUtc: 22 });
    fs.docs.set("engineAccounts/acc_1", toFirestoreData(state));
    expect((await off.load("acc_1"))!.archived!.deals).toBe(9);
    fs.docs.set("engineAccounts/acc_1", { ...toFirestoreData(state), archived: { ...state.archived, deals: -1 } });
    await expect(off.load("acc_1")).rejects.toMatchObject({ code: "bad_state" });
    fs.docs.set("engineAccounts/acc_1", { ...toFirestoreData(state), archived: { ...state.archived, dailyResults: { d: "x" } } });
    await expect(off.load("acc_1")).rejects.toMatchObject({ code: "bad_state" });
    fs.docs.set("engineAccounts/acc_1/history/000000", { accountId: "other", index: 0, deals: [] });
    await expect(off.archivedDeals("acc_1", 0)).rejects.toMatchObject({ code: "bad_state" });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Deal, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { createEngineServer } from "@/engine/server";
import { dealPips, dealToTradeRecord, EngineLedger, firestoreTradeWriter, tradeRecordId, type TradeRecord, type TradeWriter } from "@/engine/ledger";
import { mapClosedTrade, selectTradingData } from "@/lib/tradingData";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const settings = { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 };
const pipSize = (s: string) => FOREX_PAIRS.find(p => p.symbol === s)?.pipSize;
const noSleep = async () => {};

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "d1", positionId: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.0825,
  openedAt: T0, closedAt: T0 + 95 * 60_000, grossProfit: 250, commission: 7, swap: -1.2, netProfit: 241.8, reason: "take_profit", ...over,
});

/** In-memory `trades` collection with Admin SDK create() semantics. */
function fakeTrades() {
  const docs = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => ({
        async create(data: Record<string, unknown>) {
          const path = `${c}/${id}`;
          if (docs.has(path)) throw Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 });
          if (Object.values(data).some(v => v === undefined)) throw new Error("Firestore refuses undefined");
          docs.set(path, structuredClone(data));
        },
      }),
    }),
  };
  return { db, docs, writer: firestoreTradeWriter(db) };
}

describe("dealToTradeRecord (engine deal → FYNX Funded trade record)", () => {
  it("is read by the dashboard exactly as the engine closed it", () => {
    const record = dealToTradeRecord("acc_1", deal(), { userId: "u1", challengeId: "ch_1", accountId: "100234" }, 0.0001, T0 + 100 * 60_000);
    expect(record).toMatchObject({ userId: "u1", accountId: "100234", challengeId: "ch_1", engineAccountId: "acc_1", side: "buy", type: "Buy", pips: 25, netProfit: 241.8, pnlBasis: "net", status: "closed", closeReason: "take_profit", source: "fynx-trade-engine" });
    expect(Object.values(record).every(v => v !== undefined)).toBe(true);
    const trade = mapClosedTrade(tradeRecordId("acc_1", "d1"), record);
    expect(trade).toMatchObject({ accountId: "100234", challengeId: "ch_1", symbol: "EURUSD", type: "Buy", lots: 1, pnl: 241.8, pips: 25, duration: "1h 35m", result: "Win", session: "London", openTime: "2026-11-04T10:00:00.000Z", closeTime: "2026-11-04T11:35:00.000Z" });
    // …and it is listed under the trader's challenge on /dashboard/trades.
    const data = selectTradingData([{ id: "100234", challengeId: "ch_1", status: "active" }], [{ id: "ch_1", status: "active", brokerAccountId: "100234", accountSize: 10000 }], [trade!]);
    expect(data.trades.map(t => t.id)).toEqual(["fynxtrade_acc_1_d1"]);
  });

  it("counts pips both ways and for JPY pairs, and uses the engine account when no dashboard account is given", () => {
    expect(dealPips({ side: "sell", entryPrice: 1.08, exitPrice: 1.0825 }, 0.0001)).toBe(-25);
    expect(dealPips({ side: "sell", entryPrice: 150.25, exitPrice: 150.1 }, 0.01)).toBe(15);
    const loss = dealToTradeRecord("acc_1", deal({ side: "sell", grossProfit: -250, netProfit: -257, swap: undefined, reason: "stop_loss" }), { userId: "u1" }, 0.0001, T0);
    expect(loss).toMatchObject({ accountId: "acc_1", challengeId: "", swap: 0, pips: -25, type: "Sell" });
    expect(mapClosedTrade("x", loss)).toMatchObject({ pnl: -257, result: "Loss", type: "Sell" });
  });

  it("refuses records it cannot stand behind", () => {
    expect(() => dealToTradeRecord("acc_1", deal(), { userId: "" }, 0.0001, T0)).toThrow(/userId/);
    expect(() => dealToTradeRecord("acc_1", deal({ closedAt: T0 - 1 }), { userId: "u1" }, 0.0001, T0)).toThrow(/times/);
    expect(() => dealToTradeRecord("acc_1", deal({ netProfit: NaN }), { userId: "u1" }, 0.0001, T0)).toThrow(/number/);
    expect(() => dealPips(deal(), 0)).toThrow(/pipSize/);
    expect(() => tradeRecordId("acc/1", "d1")).toThrow(/Invalid/);
    expect(tradeRecordId("acc_1", "d1")).toBe("fynxtrade_acc_1_d1");
    expect(tradeRecordId("acc_1", "pos_ab12cd:1")).toBe("fynxtrade_acc_1_pos_ab12cd:1"); // the engine's own deal ids
  });
});

describe("firestoreTradeWriter", () => {
  it("creates once and reports an existing record instead of overwriting it", async () => {
    const { docs, writer } = fakeTrades();
    const record = dealToTradeRecord("acc_1", deal(), { userId: "u1" }, 0.0001, T0);
    expect(await writer.create("t1", record)).toBe("created");
    expect(await writer.create("t1", { ...record, netProfit: 999 })).toBe("exists");
    expect(docs.get("trades/t1")?.netProfit).toBe(241.8);
  });

  it("passes other errors on", async () => {
    const writer = firestoreTradeWriter({ collection: () => ({ doc: () => ({ create: async () => { throw Object.assign(new Error("unavailable"), { code: 14 }); } }) }) });
    await expect(writer.create("t1", {} as TradeRecord)).rejects.toThrow("unavailable");
  });
});

describe("EngineLedger", () => {
  async function venueWithLedger(writer: TradeWriter, extra: Partial<ConstructorParameters<typeof EngineLedger>[0]> = {}) {
    let now = T0;
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, settings), new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => now);
    const feed = new StaticQuoteFeed();
    venue.connect(feed);
    const ledger = new EngineLedger({ writer, owner: async id => (id === "acc_1" ? { userId: "u1", challengeId: "ch_1" } : null), pipSize, sleep: noSleep, clock: () => now, ...extra });
    venue.onEvents(ledger.listener);
    await venue.open("acc_1");
    const price = (bid: number, ask: number) => feed.push({ symbol: "EURUSD", bid, ask, time: now });
    const step = (ms: number) => { now += ms; };
    return { venue, ledger, price, step };
  }

  it("writes each closed trade once, also after a restart and a full sync", async () => {
    const { docs, writer } = fakeTrades();
    const { venue, ledger, price, step } = await venueWithLedger(writer);
    price(1.08, 1.0801);
    const opened = await venue.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c1" });
    step(30 * 60_000);
    price(1.0831, 1.0832);
    const closed = await venue.close("acc_1", opened.state.positions[0].id);
    await ledger.flush();
    expect(docs.size).toBe(1);
    const [record] = [...docs.values()];
    expect(record).toMatchObject({ userId: "u1", challengeId: "ch_1", symbol: "EURUSD", type: "Buy", pips: 30, netProfit: closed.state.history[0].netProfit, closeReason: "manual" });
    expect(ledger.health()).toMatchObject({ pending: 0, written: 1, alreadyRecorded: 0, failed: [], lastError: null });
    // The same ledger skips a repeat without writing; a fresh one (after a restart) finds the record and leaves it.
    expect(ledger.sync("acc_1", closed.state.history)).toBe(0);
    const restarted = new EngineLedger({ writer, owner: async () => ({ userId: "u1" }), pipSize, sleep: noSleep });
    expect(restarted.sync("acc_1", closed.state.history)).toBe(1);
    await restarted.flush();
    expect(restarted.health()).toMatchObject({ written: 0, alreadyRecorded: 1 });
    expect(docs.size).toBe(1);
    expect([...docs.values()][0].challengeId).toBe("ch_1");
  });

  it("retries a failed write with back-off and never throws into the engine", async () => {
    const { docs, writer } = fakeTrades();
    let failures = 2;
    const flaky: TradeWriter = { create: async (id, r) => { if (failures-- > 0) throw new Error("deadline exceeded"); return writer.create(id, r); } };
    const waits: number[] = [];
    const onError = vi.fn();
    const ledger = new EngineLedger({ writer: flaky, owner: async () => ({ userId: "u1" }), pipSize, sleep: async ms => { waits.push(ms); }, onError });
    ledger.listener("acc_1", [{ type: "position_closed", deal: deal() }, { type: "target_reached" }]);
    await ledger.flush();
    expect(waits).toEqual([1000, 5000]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][1]).toEqual({ engineAccountId: "acc_1", dealId: "d1", attempt: 1 });
    expect(docs.size).toBe(1);
    expect(ledger.health()).toMatchObject({ written: 1, failed: [], lastError: "deadline exceeded" });
  });

  it("keeps deals it could not write and writes them on retryFailed", async () => {
    const { docs, writer } = fakeTrades();
    const down = { on: true };
    const ledger = new EngineLedger({ writer: { create: (id, r) => (down.on ? Promise.reject(new Error("unavailable")) : writer.create(id, r)) }, owner: async () => ({ userId: "u1" }), pipSize, sleep: noSleep, retryDelaysMs: [10] });
    ledger.record("acc_1", deal());
    ledger.record("acc_1", deal({ id: "d2" }));
    expect(ledger.record("acc_1", deal())).toBe(false); // already queued
    await ledger.flush();
    expect(ledger.health().failed.map(f => [f.dealId, f.reason])).toEqual([["d1", "write_failed"], ["d2", "write_failed"]]);
    expect(ledger.record("acc_1", deal())).toBe(false); // waiting in failed, not doubled
    down.on = false;
    expect(ledger.retryFailed()).toBe(2);
    await ledger.flush();
    expect(docs.size).toBe(2);
    expect(ledger.health()).toMatchObject({ written: 2, failed: [] });
  });

  it("holds deals with no known owner or instrument instead of writing a wrong record", async () => {
    const { docs, writer } = fakeTrades();
    const owners = new Map<string, { userId: string }>();
    const ledger = new EngineLedger({ writer, owner: async id => owners.get(id) ?? null, pipSize, sleep: noSleep });
    ledger.record("acc_9", deal());
    ledger.record("acc_1", deal({ id: "d2", symbol: "XXXYYY" }));
    ledger.record("acc/bad", deal());
    await ledger.flush();
    expect(docs.size).toBe(0);
    expect(ledger.health().failed.map(f => f.reason)).toEqual(["no_owner", "unknown_symbol"]);
    owners.set("acc_9", { userId: "u9" });
    ledger.retryFailed();
    await ledger.flush();
    expect([...docs.keys()]).toEqual(["trades/fynxtrade_acc_9_d1"]);
    expect(ledger.health().failed.map(f => f.reason)).toEqual(["unknown_symbol"]);
  });

  it("keeps only the newest failures", async () => {
    const ledger = new EngineLedger({ writer: { create: () => Promise.reject(new Error("x")) }, owner: async () => ({ userId: "u1" }), pipSize, sleep: noSleep, retryDelaysMs: [], maxFailures: 2 });
    ["a", "b", "c"].forEach(id => ledger.record("acc_1", deal({ id })));
    await ledger.flush();
    expect(ledger.health().failed.map(f => f.dealId)).toEqual(["b", "c"]);
  });
});

describe("createEngineServer with a ledger", () => {
  it("a stop-out on the server lands in the trader's trades and shows in status", async () => {
    const { docs, writer } = fakeTrades();
    let now = T0;
    const feed = new StaticQuoteFeed();
    const ledger = new EngineLedger({ writer, owner: async () => ({ userId: "u1", challengeId: "ch_1" }), pipSize, sleep: noSleep, clock: () => now });
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings, store: new MemoryStore(), rulesFor: async () => rules, feed,
      accounts: () => ["acc_1"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      ledger, clock: () => now, runner: { schedule: () => 0, cancel: () => {} },
    });
    await engine.venue.open("acc_1");
    engine.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now });
    const placed = await engine.handle({ method: "POST", path: "/v1/accounts/acc_1/orders", headers: { authorization: "Bearer t", "idempotency-key": "c1" }, body: { symbol: "EURUSD", side: "sell", type: "market", lots: 1, stopLoss: 1.0811 } });
    expect(placed.status).toBe(200);
    now += 60_000;
    feed.push({ symbol: "EURUSD", bid: 1.0811, ask: 1.0812, time: now });
    await engine.runner.runOnce();
    await engine.stop(); // waits for the ledger
    expect([...docs.values()]).toEqual([expect.objectContaining({ userId: "u1", challengeId: "ch_1", type: "Sell", closeReason: "stop_loss", pips: -12, netProfit: -127 })]);
    expect(engine.status().ledger).toMatchObject({ written: 1, pending: 0, failed: [] });
  });

  it("has no ledger health when none is connected", () => {
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings, store: new MemoryStore(), rulesFor: async () => rules, feed: new StaticQuoteFeed(),
      accounts: () => [], verifyToken: async () => null, canAccess: async () => false, tradingEnabled: async () => false,
    });
    expect(engine.status().ledger).toBeUndefined();
  });
});



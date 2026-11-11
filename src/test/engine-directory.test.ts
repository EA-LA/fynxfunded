import { describe, expect, it } from "vitest";
import { FirestoreAccountDirectory, directoryEntry, type DirectoryFirestore, type DirectoryQuery } from "@/engine/firestore-directory";
import { EngineError } from "@/engine/types";
import { MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { EngineRunner } from "@/engine/runner";
import { createEngineServer } from "@/engine/server";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const settings = { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 };

/** The purchased rule snapshot exactly as checkout stores it (fundedPolicy ruleSnapshot, 2-phase phase 1, $10k). */
const snapshot = {
  name: "fynx-funded-v1:2-phase:1", starting_balance: "10000", daily_loss_percent: "5", max_loss_percent: "10",
  profit_target_percent: "8", max_loss_type: "static", consistency_percent: "40", min_trading_days: 5,
  reset_hour_utc: 22, breach_on_touch: false, version: 1, daily_basis: "boundary_balance", account_currency: "USD",
};

const ID = "ft_0123456789abcdef0123456789abcdef_p1";

/** The documents provisionTradeAccess writes for a paid FYNX Trade purchase. */
function purchase(over: { account?: Record<string, unknown>; challenge?: Record<string, unknown>; order?: Record<string, unknown> } = {}) {
  return {
    [`accounts/${ID}`]: { userId: "u1", challengeId: "ch1", orderId: "or1", platform: "FYNX Trade", accessVersion: 1, status: "active", activationStatus: "active", tradingEnabled: false, currentPhase: 1, startingBalance: 10000, rules: snapshot, ...over.account },
    "challenges/ch1": { userId: "u1", orderId: "or1", status: "active", brokerAccountId: ID, currentPhase: 1, ...over.challenge },
    "orders/or1": { userId: "u1", challengeId: "ch1", status: "paid", ...over.order },
  } as Record<string, Record<string, unknown>>;
}

/** Firestore stand-in with doc reads and equality queries; counts reads so caching can be checked. */
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const stats = { reads: 0, queries: 0 };
  const query = (col: string, filters: [string, unknown][], max: number): DirectoryQuery => ({
    where: (f, _op, v) => query(col, [...filters, [f, v]], max),
    limit: n => query(col, filters, n),
    async get() {
      stats.queries++;
      const rows = Object.entries(docs)
        .filter(([p, d]) => p.startsWith(`${col}/`) && filters.every(([f, v]) => d[f] === v))
        .slice(0, max)
        .map(([p, d]) => ({ id: p.slice(col.length + 1), data: () => structuredClone(d) }));
      return { docs: rows };
    },
  });
  const db: DirectoryFirestore = {
    collection: col => Object.assign(query(col, [], Infinity), {
      doc: (id: string) => ({
        get: async () => { stats.reads++; const d = docs[`${col}/${id}`]; return { exists: !!d, data: () => (d ? structuredClone(d) : undefined) }; },
      }),
    }),
  };
  return { db, docs, stats };
}

describe("directoryEntry (pure)", () => {
  it("turns a paid FYNX Trade purchase into the engine's rules from the purchased snapshot", () => {
    const d = purchase();
    const e = directoryEntry(ID, d[`accounts/${ID}`], d["challenges/ch1"], d["orders/or1"]);
    expect(e).toMatchObject({ userId: "u1", challengeId: "ch1", orderId: "or1", stage: "evaluation", phase: 1, runnable: true, holdReason: "", accountSwitch: false });
    expect(e.rules).toEqual({ startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22, consistencyPercent: 40 });
  });

  it("funded challenges have no profit target", () => {
    const d = purchase({ challenge: { status: "funded" } });
    const e = directoryEntry(ID, d[`accounts/${ID}`], d["challenges/ch1"], d["orders/or1"]);
    expect(e.stage).toBe("funded");
    expect((e.rules as { profitTargetPercent: number | null }).profitTargetPercent).toBeNull();
    expect(e.runnable).toBe(true);
  });

  it("only FYNX Trade accounts with access version 1 exist for the engine", () => {
    for (const account of [undefined, { ...purchase()[`accounts/${ID}`], platform: "MT5" }, { ...purchase()[`accounts/${ID}`], accessVersion: 2 }, { ...purchase()[`accounts/${ID}`], userId: "" }]) {
      expect(() => directoryEntry(ID, account, {}, {})).toThrow(expect.objectContaining({ code: "no_account" }));
    }
  });

  it("keeps accounts view-only with a plain reason when the purchase does not bind or the stage is not running", () => {
    const cases: [Parameters<typeof purchase>[0], RegExp][] = [
      [{ order: { status: "refunded" } }, /not paid/],
      [{ order: { userId: "someone" } }, /review by support/],
      [{ challenge: { orderId: "other" } }, /review by support/],
      [{ challenge: { status: "passed" } }, /waiting for review/],
      [{ challenge: { status: "failed" } }, /ended/],
      [{ account: { status: "closed" } }, /no longer active/],
      [{ challenge: { brokerAccountId: "ft_next_p2" } }, /newer account/],
    ];
    for (const [over, reason] of cases) {
      const d = purchase(over);
      const e = directoryEntry(ID, d[`accounts/${ID}`], d["challenges/ch1"], d["orders/or1"]);
      expect(e.runnable).toBe(false);
      expect(e.holdReason).toMatch(reason);
    }
    const d = purchase();
    expect(directoryEntry(ID, d[`accounts/${ID}`], undefined, d["orders/or1"]).holdReason).toMatch(/review by support/);
  });

  it("refuses rules that are missing, trailing, or for another balance (they go to review, never trade)", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ rules: undefined }, /no purchased rules/],
      [{ rules: { ...snapshot, max_loss_type: "trailing" } }, /not a static limit/],
      [{ startingBalance: 25000 }, /starting balance/],
      [{ rules: { ...snapshot, daily_loss_percent: "abc" } }, /Daily loss/],
    ];
    for (const [account, message] of cases) {
      const d = purchase({ account });
      const e = directoryEntry(ID, d[`accounts/${ID}`], d["challenges/ch1"], d["orders/or1"]);
      expect(e.rules).toBeInstanceOf(EngineError);
      expect((e.rules as EngineError).code).toBe("bad_rules");
      expect((e.rules as EngineError).message).toMatch(message);
    }
  });
});

describe("FirestoreAccountDirectory", () => {
  it("answers rulesFor / canAccess / owner from the stored purchase", async () => {
    const { db } = fakeDb(purchase());
    const dir = new FirestoreAccountDirectory(db);
    expect((await dir.rulesFor(ID)).profitTargetPercent).toBe(8);
    expect(await dir.canAccess("u1", ID)).toBe(true);
    expect(await dir.canAccess("u2", ID)).toBe(false);
    expect(await dir.canAccess("", ID)).toBe(false);
    expect(await dir.canAccess("u1", "unknown")).toBe(false);
    expect(await dir.canAccess("u1", "../accounts/x")).toBe(false);
    expect(await dir.owner(ID)).toEqual({ userId: "u1", challengeId: "ch1", accountId: ID });
    expect(await dir.owner("unknown")).toBeNull();
    await expect(dir.rulesFor("unknown")).rejects.toMatchObject({ code: "no_account" });
  });

  it("trading stays off unless the host's master switch AND the account switch are on, and the purchase is running", async () => {
    const on = purchase({ account: { tradingEnabled: true } });
    expect(await new FirestoreAccountDirectory(fakeDb(purchase()).db, { allowTrading: true }).tradingEnabled(ID)).toBe(false); // account switch off
    expect(await new FirestoreAccountDirectory(fakeDb(on).db).tradingEnabled(ID)).toBe(false); // master switch off (default)
    expect(await new FirestoreAccountDirectory(fakeDb(on).db, { allowTrading: true }).tradingEnabled(ID)).toBe(true);
    const passed = purchase({ account: { tradingEnabled: true }, challenge: { status: "passed" } });
    expect(await new FirestoreAccountDirectory(fakeDb(passed).db, { allowTrading: true }).tradingEnabled(ID)).toBe(false);
    const badRules = purchase({ account: { tradingEnabled: true, rules: { ...snapshot, max_loss_type: "trailing" } } });
    expect(await new FirestoreAccountDirectory(fakeDb(badRules).db, { allowTrading: true }).tradingEnabled(ID)).toBe(false);
    expect(await new FirestoreAccountDirectory(fakeDb(on).db, { allowTrading: true }).tradingEnabled("unknown")).toBe(false);
  });

  it("caches lookups for cacheMs; invalidate() makes a switch-off count at once", async () => {
    let now = T0;
    const { db, docs, stats } = fakeDb(purchase({ account: { tradingEnabled: true } }));
    const dir = new FirestoreAccountDirectory(db, { allowTrading: true, clock: () => now });
    expect(await dir.tradingEnabled(ID)).toBe(true);
    await dir.rulesFor(ID); await dir.canAccess("u1", ID);
    expect(stats.reads).toBe(3); // account + challenge + order, once
    docs[`accounts/${ID}`].tradingEnabled = false;
    expect(await dir.tradingEnabled(ID)).toBe(true); // still cached
    now += 15_000;
    expect(await dir.tradingEnabled(ID)).toBe(false); // re-read after 15 s
    docs[`accounts/${ID}`].tradingEnabled = true;
    dir.invalidate(ID);
    expect(await dir.tradingEnabled(ID)).toBe(true);
  });

  it("does not keep a failed read", async () => {
    const { db, docs } = fakeDb({});
    const dir = new FirestoreAccountDirectory(db);
    await expect(dir.rulesFor(ID)).rejects.toMatchObject({ code: "no_account" });
    Object.assign(docs, purchase());
    expect((await dir.rulesFor(ID)).startingBalance).toBe(10000);
  });

  it("lists only activated, running FYNX Trade accounts for the timer step and re-reads the list every listEveryMs", async () => {
    let now = T0;
    const docs = purchase();
    docs["accounts/ft_waiting_p1"] = { ...docs[`accounts/${ID}`], activationStatus: "pending" };
    docs["accounts/ft_old_p1"] = { ...docs[`accounts/${ID}`], challengeId: "ch2", orderId: "or2" };
    docs["challenges/ch2"] = { userId: "u1", orderId: "or2", status: "active", brokerAccountId: "ft_old_p2" }; // replaced by phase 2
    docs["orders/or2"] = { userId: "u1", challengeId: "ch2", status: "paid" };
    docs["accounts/mt5_1"] = { ...docs[`accounts/${ID}`], platform: "MT5" };
    const fake = fakeDb(docs);
    const dir = new FirestoreAccountDirectory(fake.db, { clock: () => now });
    expect(await dir.accounts()).toEqual([ID]);
    await dir.accounts();
    expect(fake.stats.queries).toBe(1);
    now += 30_000;
    await dir.accounts();
    expect(fake.stats.queries).toBe(2);
  });

  it("reports more accounts than maxAccounts as an error instead of silently watching some", async () => {
    const docs = purchase();
    docs["accounts/ft_b_p1"] = { ...docs[`accounts/${ID}`] };
    const dir = new FirestoreAccountDirectory(fakeDb(docs).db, { maxAccounts: 1 });
    await expect(dir.accounts()).rejects.toThrow(/More than 1/);
  });

  it("recipient gives only a verified, enabled email (never without lookupUser)", async () => {
    const { db } = fakeDb(purchase());
    expect(await new FirestoreAccountDirectory(db).recipient(ID)).toBeNull();
    const users: Record<string, unknown> = { u1: { email: "trader@example.com", emailVerified: true, displayName: "Sam" } };
    const dir = new FirestoreAccountDirectory(db, { lookupUser: async uid => (users[uid] as never) ?? null });
    expect(await dir.recipient(ID)).toEqual({ email: "trader@example.com", name: "Sam" });
    users.u1 = { email: "trader@example.com", emailVerified: false };
    dir.invalidate();
    expect(await dir.recipient(ID)).toBeNull();
    users.u1 = { email: "trader@example.com", emailVerified: true, disabled: true };
    expect(await dir.recipient(ID)).toBeNull();
    users.u1 = { email: "not-an-email", emailVerified: true };
    expect(await dir.recipient(ID)).toBeNull();
    const failing = new FirestoreAccountDirectory(db, { lookupUser: async () => { throw new Error("auth down"); } });
    expect(await failing.recipient(ID)).toBeNull();
  });
});

describe("directory wired into the engine server", () => {
  it("opens the purchased account on first visit with its purchased rules; orders refused until both switches are on", async () => {
    const docs = purchase();
    const fake = fakeDb(docs);
    let now = T0;
    const dir = new FirestoreAccountDirectory(fake.db, { allowTrading: true, cacheMs: 0, clock: () => now });
    const feed = new StaticQuoteFeed();
    const store = new MemoryStore();
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings, store, feed, ...dir.engineOptions(),
      verifyToken: async t => (t === "tok_u1" ? "u1" : t === "tok_u2" ? "u2" : null),
      runner: { schedule: () => 0, cancel: () => undefined },
      clock: () => now,
    });
    engine.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now });
    const call = (token: string, method: string, path: string, body?: unknown) => engine.handle({ method, path, headers: { Authorization: `Bearer ${token}` }, body });

    expect((await call("tok_u2", "GET", `/v1/accounts/${ID}`)).status).toBe(403);
    const first = await call("tok_u1", "GET", `/v1/accounts/${ID}`);
    expect(first.status).toBe(200);
    expect((await store.load(ID))?.balance).toBe(10000);

    const order = { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, clientId: "c1" };
    expect((await call("tok_u1", "POST", `/v1/accounts/${ID}/orders`, order)).status).toBe(403); // account switch off
    docs[`accounts/${ID}`].tradingEnabled = true;
    now += 1000;
    expect((await call("tok_u1", "POST", `/v1/accounts/${ID}/orders`, order)).status).toBe(200);
    docs["challenges/ch1"].status = "passed"; // phase passed → waits for review
    expect((await call("tok_u1", "POST", `/v1/accounts/${ID}/orders`, { ...order, clientId: "c2" })).status).toBe(403);
    await engine.stop();
  });

  it("the timer step skips listed accounts the trader has not opened yet without counting failures", async () => {
    const dir = new FirestoreAccountDirectory(fakeDb(purchase()).db);
    const store = new MemoryStore();
    const feed = new StaticQuoteFeed();
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings, store, feed, ...dir.engineOptions(),
      verifyToken: async () => null, runner: { schedule: () => 0, cancel: () => undefined }, clock: () => T0,
    });
    engine.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    // A separate runner on the same venue, so the round is the first one it sees.
    let now = T0;
    const runner = new EngineRunner({ venue: engine.venue, accounts: dir.accounts, clock: () => now, schedule: () => 0, cancel: () => undefined });
    expect(await runner.runOnce()).toMatchObject({ notOpened: 1, failed: 0, checked: 0 });
    expect(runner.health().failing).toEqual([]);
    now += 1000;
    expect(await runner.runOnce()).toMatchObject({ notOpened: 0, idleSkipped: 1, failed: 0 }); // rechecked at the idle cadence
    await engine.venue.open(ID); // the trader loads it in the terminal
    now += 60_000;
    expect(await runner.runOnce()).toMatchObject({ checked: 1, notOpened: 0, failed: 0 });
    await engine.stop();
  });
});

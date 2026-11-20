import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, EngineError, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { newAccount } from "@/engine/core";
import { fromFirestoreData } from "@/engine/firestore-store";
import { appendJournal, JOURNAL_KEPT, journalFor, refusalEntry, validJournalEntry, type JournalEntry } from "@/engine/journal";
import { filterJournal, journalCounts, journalCsv, journalFileName, journalSymbols, readJournal } from "@/trade-access/journal";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

// Test values only: these prices exercise the plumbing; they are not market data.
const WED = Date.parse("2026-11-11T10:00:00Z");
const rules: RuleSet = { startingBalance: 100000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });

function setup(r: RuleSet = rules) {
  const clock = { now: WED };
  let n = 0;
  const store = new MemoryStore();
  const venue = new LocalVenue(specs, store, async () => r, { maxQuoteAgeMs: 60_000 }, () => clock.now, p => `${p}_${++n}`);
  const feed = new StaticQuoteFeed(); venue.connect(feed);
  const price = (bid: number, ask = +(bid + 0.0001).toFixed(5)) => feed.push(q("EURUSD", bid, ask, clock.now));
  price(1.08);
  return { clock, store, venue, feed, price };
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", e => (e as EngineError).code);

describe("journal sentences", () => {
  it("describes a market fill with its levels and a pending fill as one line", async () => {
    const { venue, price, clock } = setup();
    await venue.open("a1");
    await venue.place("a1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.075, takeProfit: 1.09 });
    await venue.place("a1", { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.5, price: 1.078 });
    clock.now += 60_000; price(1.0779, 1.078);
    const s = await venue.snapshot("a1");
    const j = s.state.journal!;
    expect(j.map(e => e.kind)).toEqual(["trade", "order", "trade"]);
    expect(j[2].text).toBe("Opened buy 1.00 EURUSD at 1.08010 (SL 1.07500, TP 1.09000), position #pos_1.");
    expect(j[1].text).toBe("Placed buy limit 0.50 EURUSD at 1.07800, order #ord_2.");
    expect(j[0].text).toMatch(/^Buy limit #ord_2 filled: opened buy 0\.50 EURUSD at 1\.07800, position #pos_\d+\.$/);
    expect(j[0]).toMatchObject({ symbol: "EURUSD", at: WED + 60_000 });
  });

  it("partial close, stop loss hit with nobody online, and the loss-limit lock", async () => {
    const { venue, price, clock } = setup();
    await venue.open("a1");
    const opened = await venue.place("a1", { symbol: "EURUSD", side: "buy", type: "market", lots: 2, stopLoss: 1.07 });
    const id = opened.state.positions[0].id;
    clock.now += 1000; price(1.081);
    await venue.close("a1", id, 0.5);
    clock.now += 1000; price(1.0699);
    const s = await venue.snapshot("a1"); // the timer step, as the EngineRunner calls it
    const texts = s.state.journal!.map(e => e.text);
    expect(texts[1]).toMatch(/^Closed 0\.50 of 2\.00 lots of #pos_1 buy EURUSD at 1\.08100 \(opened at 1\.08010\): \+\$\d+\.\d{2} net, closed by you\.$/);
    expect(texts[0]).toMatch(/^Closed #pos_1 buy 1\.50 EURUSD at 1\.06990 \(opened at 1\.08010\): -\$[\d,]+\.\d{2} net, stop loss hit\.$/);

    const tight = setup({ ...rules, dailyLossPercent: 1 });
    await tight.venue.open("a2");
    await tight.venue.place("a2", { symbol: "EURUSD", side: "buy", type: "market", lots: 20 });
    tight.clock.now += 1000; tight.price(1.079);
    const locked = await tight.venue.snapshot("a2");
    expect(locked.state.status).toBe("breached");
    expect(locked.state.journal![0]).toMatchObject({ kind: "rule", text: "Account locked: daily loss limit reached. Open trades were closed and pending orders removed; no new trades on this account." });
    expect(locked.state.journal![1].text).toMatch(/daily loss limit reached\.$/);
  });

  it("cancel, change, OCO cancel and expiry name the order", () => {
    const before = newAccount("a", rules, WED);
    const order = { id: "ord_1", symbol: "USDJPY", side: "sell" as const, type: "stop" as const, lots: 1, price: 150.5, createdAt: WED };
    const state: AccountState = { ...before, orders: [order] };
    const e = journalFor([
      { type: "order_cancelled", orderId: "ord_1" },
      { type: "order_cancelled", orderId: "ord_9", reason: "oco", order: { ...order, id: "ord_9", ocoWith: "ord_8", cancelledAt: WED, positionId: "pos_3" } },
      { type: "order_expired", order: { ...order, expiresAt: WED, expiredAt: WED } },
      { type: "order_modified", order: { ...order, stopLoss: 151 } },
    ], state, before, WED, s => specs[s].digits);
    expect(e.map(x => x.text)).toEqual([
      "Cancelled sell stop 1.00 USDJPY at 150.500 (#ord_1).",
      "Sell stop 1.00 USDJPY at 150.500 (#ord_9) cancelled: its linked (OCO) order filled.",
      "Sell stop 1.00 USDJPY at 150.500 (#ord_1) expired at 2026-11-11 10:00 UTC without filling.",
      "Changed order #ord_1: sell stop 1.00 USDJPY at 150.500 (SL 151.000, no TP).",
    ]);
    expect(e.every(x => x.symbol === "USDJPY")).toBe(true);
  });
});

describe("refusals", () => {
  it("records a refused order with the reason and changes nothing else", async () => {
    const { venue, store } = setup();
    await venue.open("a1");
    const before = (await store.load("a1"))!;
    expect(await code(venue.place("a1", { symbol: "EURUSD", side: "buy", type: "market", lots: 5000 }))).not.toBe("ok");
    const after = (await store.load("a1"))!;
    const { journal, sequence, ...rest } = after;
    const { journal: _j, sequence: seq0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    expect(sequence).toBe(seq0 + 1);
    expect(journal).toHaveLength(1);
    expect(journal![0]).toMatchObject({ kind: "refused", symbol: "EURUSD", code: expect.any(String), text: expect.stringMatching(/^Refused buy market 5000\.00 EURUSD: /) });
  });

  it("records refused closes, changes and cancels of unknown tickets, not storage problems", async () => {
    const { venue, store } = setup();
    await venue.open("a1");
    await code(venue.close("a1", "pos_x"));
    await code(venue.modify("a1", "pos_x", { stopLoss: 1 }));
    await code(venue.cancel("a1", "ord_x"));
    const j = (await store.load("a1"))!.journal!;
    expect(j.map(e => e.text.split(":")[0])).toEqual(["Refused cancelling order #ord_x", "Refused changing position #pos_x", "Refused closing position #pos_x"]);
    expect(j.every(e => e.ref)).toBe(true);
    expect(refusalEntry({ type: "cancel", orderId: "o" }, { code: "conflict", message: "retry" }, newAccount("a", rules, WED), WED)).toBeNull();
    expect(await code(venue.place("missing", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }))).toBe("no_account");
    expect(await store.load("missing")).toBeNull();
  });

  it("HTTP contract: the refusal answer is unchanged and the journal comes with the snapshot", async () => {
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async () => rules, feed, accounts: async () => ["acc_1"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      clock: () => WED, rateLimits: false,
    });
    server.start();
    const headers = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, WED));
    await server.handle({ method: "GET", path: "/v1/accounts/acc_1", headers });
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_1/orders", headers, body: { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.09 } });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const message = (refused.body as { error: { message: string } }).error.message;
    const snap = await server.handle({ method: "GET", path: "/v1/accounts/acc_1", headers });
    const journal = (snap.body as { state: AccountState }).state.journal!;
    expect(journal[0]).toMatchObject({ kind: "refused", text: `Refused buy limit 1.00 EURUSD at 1.09000: ${message}` });
    await server.stop();
  });
});

describe("storage", () => {
  const entry = (i: number, extra: Partial<JournalEntry> = {}): JournalEntry => ({ at: WED + i, kind: "trade", text: `t${i}`, ...extra });

  it("keeps the newest entries, newest first, and folds repeated trailing-stop moves", () => {
    let s = newAccount("a", rules, WED);
    for (let i = 0; i < JOURNAL_KEPT + 20; i++) s = appendJournal(s, [entry(i)]);
    expect(s.journal).toHaveLength(JOURNAL_KEPT);
    expect(s.journal![0].text).toBe(`t${JOURNAL_KEPT + 19}`);
    const trail = (i: number, ref: string): JournalEntry => ({ at: WED + i, kind: "change", text: `Trailing stop moved the stop loss of #${ref} to ${i}.`, ref });
    let t = appendJournal(newAccount("a", rules, WED), [trail(1, "p1"), trail(2, "p1"), trail(3, "p2"), trail(4, "p2"), entry(5), trail(6, "p2")]);
    expect(t.journal!.map(e => e.text)).toEqual(["Trailing stop moved the stop loss of #p2 to 6.", "t5", "Trailing stop moved the stop loss of #p2 to 4.", "Trailing stop moved the stop loss of #p1 to 2."]);
    t = appendJournal(t, []);
    expect(appendJournal(t, [])).toBe(t);
  });

  it("the Firestore store refuses a malformed journal and loads a good one", () => {
    const good = { ...newAccount("a", rules, WED), journal: [entry(1)] } as unknown as Record<string, unknown>;
    expect(fromFirestoreData("a", good).journal).toHaveLength(1);
    for (const journal of [{}, [{ at: "x", kind: "trade", text: "t" }], [{ at: 1, kind: "other", text: "t" }], [{ at: 1, kind: "trade", text: "" }], Array.from({ length: JOURNAL_KEPT + 1 }, (_, i) => entry(i))])
      expect(() => fromFirestoreData("a", { ...good, journal })).toThrow(/malformed/);
    expect(validJournalEntry({ at: 1, kind: "refused", text: "x".repeat(301) })).toBe(false);
  });
});

describe("terminal helpers", () => {
  const entries: JournalEntry[] = [
    { at: 3, kind: "refused", text: "Refused buy market 1.00 EURUSD: Not enough free margin.", symbol: "EURUSD", code: "margin" },
    { at: 2, kind: "trade", text: "=HYPERLINK(\"x\")", symbol: "GBPUSD", ref: "pos_1" },
    { at: 1, kind: "account", text: "New trading day 2026-11-11: the daily loss limit restarts from a balance of $100,000.00." },
  ];
  it("reads, filters, counts and exports formula-safe CSV", () => {
    expect(readJournal([...entries].reverse().concat([{ at: 9, kind: "nope", text: "x" } as never]))).toEqual(entries);
    expect(readJournal(undefined)).toEqual([]);
    expect(filterJournal(entries, "refused", "")).toHaveLength(1);
    expect(filterJournal(entries, "all", "GBPUSD")).toEqual([entries[1]]);
    expect(journalCounts(entries, "")).toEqual({ all: 3, trading: 1, refused: 1, rules: 1, alerts: 0 });
    expect(journalSymbols(entries)).toEqual(["EURUSD", "GBPUSD"]);
    const csv = journalCsv("acc/1", entries);
    expect(csv.split("\r\n")[0]).toBe('"Time (UTC)","Type","Pair","Order/position","Code","What happened"');
    expect(csv.split("\r\n")[1]).toMatch(/^"1970-01-01T00:00:00\.001Z","Account","","","","New trading day/);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(journalFileName("acc/1", WED)).toBe("fynx-trade-journal-acc1-2026-11-11.csv");
  });
});

describe("terminal Journal tab", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(WED)); });
  afterEach(() => { vi.useRealTimers(); });

  it("lists what the server did, refusals included, with filters", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 100000, balance: 100000, equity: 100000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now())); feed.push(q("GBPUSD", 1.25, 1.2501, Date.now()));
    await v.open(account.accountId);
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 });
    await v.place(account.accountId, { symbol: "GBPUSD", side: "sell", type: "limit", lots: 0.2, price: 1.26 });
    await code(v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.09 }));
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    await act(async () => { fireEvent.click(await screen.findByRole("tab", { name: "Journal" })); });
    const list = await screen.findByTestId("journal-list");
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(list).toHaveTextContent(/Refused buy limit 1\.00 EURUSD at 1\.09000: /);
    expect(list).toHaveTextContent("Placed sell limit 0.20 GBPUSD at 1.26000");
    expect(screen.getByTestId("journal-filter-refused")).toHaveTextContent("Refused 1");
    fireEvent.click(screen.getByTestId("journal-filter-refused"));
    expect(within(screen.getByTestId("journal-list")).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("journal-filter-all"));
    fireEvent.change(screen.getByTestId("journal-pair"), { target: { value: "GBPUSD" } });
    expect(within(screen.getByTestId("journal-list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("journal-download")).toBeInTheDocument();
  });
});

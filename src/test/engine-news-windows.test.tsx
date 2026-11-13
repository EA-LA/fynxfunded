import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter, parseNews } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { createEngineServer } from "@/engine/server";
import { closePosition, modifyOrder, modifyPosition, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import {
  activeNewsWindow, NEWS_DEFAULT_MINUTES, NEWS_MAX_EVENTS, NewsCalendar, newsStatus, newsWindowMessage, readNewsDocument, type NewsState, type NewsWindow,
} from "@/engine/news";
import { newsBlocks, newsNoteSentence, pairNews } from "@/trade-access/news-windows";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

// Test values only: these prices and release times exercise the plumbing; they are not market data or a real calendar.
const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const MIN = 60_000, HOUR = 3_600_000;
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const usdAt = (at: number, extra: Partial<NewsWindow> = {}): NewsWindow => ({ id: `w${at}`, title: "Test USD release", at, from: at - 2 * MIN, to: at + 2 * MIN, currencies: ["USD"], ...extra });

describe("news windows: reading the calendar document", () => {
  it("no document or no events → nothing, information only", () => {
    expect(readNewsDocument(undefined, T0)).toEqual({ state: { enforce: false, windows: [] }, problems: [] });
    expect(readNewsDocument({}, T0)).toEqual({ state: { enforce: false, windows: [] }, problems: [] });
  });

  it("reads events with the document's or the event's own minutes, sorted, with ids", () => {
    const r = readNewsDocument({
      enforce: true, beforeMinutes: 5, afterMinutes: 3,
      events: [
        { title: "Second", at: "2026-11-04T13:30:00Z", currencies: "usd, cad" },
        { id: "first-1", title: "  First\n release ", at: T0 + HOUR, currencies: ["EUR"], beforeMinutes: 0, afterMinutes: 10 },
      ],
    }, T0);
    expect(r.problems).toEqual([]);
    expect(r.state.enforce).toBe(true);
    expect(r.state.windows).toEqual([
      { id: "first-1", title: "First release", at: T0 + HOUR, from: T0 + HOUR, to: T0 + HOUR + 10 * MIN, currencies: ["EUR"] },
      { id: "2026-11-04T13:30-USDCAD", title: "Second", at: Date.parse("2026-11-04T13:30:00Z"), from: Date.parse("2026-11-04T13:25:00Z"), to: Date.parse("2026-11-04T13:33:00Z"), currencies: ["USD", "CAD"] },
    ]);
    const plain = readNewsDocument({ events: [{ title: "x", at: T0 + HOUR, currencies: ["JPY"] }] }, T0).state.windows[0];
    expect(plain.to - plain.at).toBe(NEWS_DEFAULT_MINUTES * MIN);
  });

  it("leaves out windows that are over, keeps one in force now", () => {
    const r = readNewsDocument({ events: [
      { title: "Over", at: T0 - 10 * MIN, currencies: ["USD"] },
      { title: "Now", at: T0 - MIN, currencies: ["USD"] },
    ] }, T0);
    expect(r.state.windows.map(w => w.title)).toEqual(["Now"]);
  });

  it("drops events it cannot read and names them; duplicate ids get a suffix", () => {
    const r = readNewsDocument({ events: [
      "text", { at: T0 + HOUR, currencies: ["USD"] }, { title: "No time", currencies: ["USD"] }, { title: "Bad time", at: "Friday", currencies: ["USD"] },
      { title: "Bad currency", at: T0 + HOUR, currencies: ["DOLLAR"] }, { title: "No currency", at: T0 + HOUR }, { title: "Too long", at: T0 + HOUR, currencies: ["USD"], afterMinutes: 500 },
      { id: "same", title: "A", at: T0 + HOUR, currencies: ["USD"] }, { id: "same", title: "B", at: T0 + 2 * HOUR, currencies: ["USD"] },
    ] }, T0);
    expect(r.state.windows.map(w => w.id)).toEqual(["same", "same-2"]);
    expect(r.problems).toEqual([
      "Event 1 is not an object; skipped.",
      "Event 2 has no title; skipped.",
      'Event 3 ("No time") has no readable "at" time (use an ISO time like 2026-12-04T13:30:00Z); skipped.',
      'Event 4 ("Bad time") has no readable "at" time (use an ISO time like 2026-12-04T13:30:00Z); skipped.',
      'Event 5 ("Bad currency") needs "currencies" as three-letter codes, e.g. ["USD"]; skipped.',
      'Event 6 ("No currency") needs "currencies" as three-letter codes, e.g. ["USD"]; skipped.',
      'Event 7 ("Too long") has minutes outside 0 to 120; skipped.',
    ]);
  });

  it("is fail-safe: an unclear enforce enforces; bad defaults fall back to 2 minutes", () => {
    const r = readNewsDocument({ enforce: "yes", beforeMinutes: -1, afterMinutes: 1.5, events: [{ title: "x", at: T0 + HOUR, currencies: ["USD"] }] }, T0);
    expect(r.state.enforce).toBe(true);
    expect(r.problems[0]).toMatch(/"enforce" should be true or false/);
    expect(r.problems.slice(1)).toEqual(['"beforeMinutes" should be a whole number from 0 to 120; 2 is used.', '"afterMinutes" should be a whole number from 0 to 120; 2 is used.']);
    expect(r.state.windows[0].from).toBe(T0 + HOUR - 2 * MIN);
    expect(readNewsDocument({ enforce: "false" }, T0).state.enforce).toBe(false);
    expect(readNewsDocument({ events: "x" }, T0).problems).toEqual(['"events" should be a list.']);
  });

  it("reads at most 1000 events", () => {
    const events = Array.from({ length: NEWS_MAX_EVENTS + 5 }, (_, i) => ({ title: `e${i}`, at: T0 + (i + 1) * HOUR, currencies: ["USD"] }));
    const r = readNewsDocument({ events }, T0);
    expect(r.state.windows).toHaveLength(NEWS_MAX_EVENTS);
    expect(r.problems).toEqual([`Only the first ${NEWS_MAX_EVENTS} of ${NEWS_MAX_EVENTS + 5} events are read.`]);
  });

  it("finds the window in force for a pair, and lists the coming week for /v1/status", () => {
    const eur = { base: "EUR", quote: "USD" }, gbpjpy = { base: "GBP", quote: "JPY" };
    const a = usdAt(T0), b = usdAt(T0 + MIN, { id: "b", to: T0 + 10 * MIN });
    expect(activeNewsWindow([a, b], eur, T0)?.id).toBe("b"); // the one ending last
    expect(activeNewsWindow([a], gbpjpy, T0)).toBeNull();
    expect(activeNewsWindow([a], eur, a.to)).toBeNull(); // the end is exclusive
    expect(activeNewsWindow([a], eur, a.from)).not.toBeNull();
    const far = usdAt(T0 + 8 * 24 * HOUR), old = usdAt(T0 - HOUR);
    expect(newsStatus({ enforce: true, windows: [old, a, far] }, T0).windows).toEqual([a]);
    expect(newsWindowMessage(a, "EURUSD")).toBe("New EURUSD orders are paused around a high-impact release: Test USD release (USD) at 10:00 UTC. Trading on this pair reopens at 10:02 UTC. Nothing was sent; closing trades, cancelling orders and changing stop loss or take profit still work.");
  });
});

describe("news windows: engine rule", () => {
  const ctx = (news?: NewsState, now = T0): EngineContext => ({
    specs, rules, now, maxQuoteAgeMs: 60_000, newId: (() => { let n = 0; return (p: string) => `${p}_${++n}`; })(),
    quotes: { EURUSD: { symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now }, EURGBP: { symbol: "EURGBP", bid: 0.87, ask: 0.8701, time: now }, GBPUSD: { symbol: "GBPUSD", bid: 1.25, ask: 1.2501, time: now } },
    ...(news ? { news } : {}),
  });
  const enforced: NewsState = { enforce: true, windows: [usdAt(T0)] };
  const fresh = (): AccountState => newAccount("a", rules, T0 - HOUR);

  it("refuses market and pending orders on affected pairs inside an enforced window", () => {
    expect(() => placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx(enforced))).toThrow(expect.objectContaining({ code: "news_window" }));
    expect(() => placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 }, ctx(enforced))).toThrow(/New EURUSD orders are paused around a high-impact release/);
    // Pairs without the currency, information-only calendars and times outside the window trade normally.
    expect(placeOrder(fresh(), { symbol: "EURGBP", side: "buy", type: "market", lots: 1 }, ctx(enforced)).state.positions).toHaveLength(1);
    expect(placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx({ ...enforced, enforce: false })).state.positions).toHaveLength(1);
    expect(placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx(enforced, T0 + 2 * MIN)).state.positions).toHaveLength(1);
    expect(placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx(enforced, T0 - 2 * MIN - 1)).state.positions).toHaveLength(1);
    expect(placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctx()).state.positions).toHaveLength(1);
  });

  it("never blocks reducing risk: close, stop loss / take profit changes, cancelling; a retried order is still answered", () => {
    const before = ctx(undefined, T0 - HOUR);
    before.quotes.EURUSD!.time = T0 - HOUR;
    let s = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c1" }, before).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 }, before).state;
    const c = ctx(enforced);
    const pos = s.positions[0], ord = s.orders[0];
    expect(modifyPosition(s, pos.id, { stopLoss: 1.075 }, c).state.positions[0].stopLoss).toBe(1.075);
    expect(modifyOrder(s, ord.id, { stopLoss: 1.06 }, c).state.orders[0].stopLoss).toBe(1.06);
    expect(() => modifyOrder(s, ord.id, { price: 1.069 }, c)).toThrow(expect.objectContaining({ code: "news_window" }));
    expect(modifyOrder(s, ord.id, { price: 1.07, takeProfit: 1.09 }, c).state.orders[0].takeProfit).toBe(1.09); // same price is not a move
    expect(closePosition(s, pos.id, undefined, c).state.positions).toEqual([]);
    // Idempotent replay of an order already recorded answers without refusing.
    expect(placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "c1" }, c).state).toBe(s);
  });

  it("the timer step keeps working inside a window: a pending order at its price still fills", () => {
    const before = ctx(undefined, T0 - HOUR);
    before.quotes.EURUSD!.time = T0 - HOUR;
    const s = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.0801 }, { ...before, quotes: { ...before.quotes, EURUSD: { symbol: "EURUSD", bid: 1.09, ask: 1.0901, time: T0 - HOUR } } }).state;
    const filled = tick(s, ctx(enforced));
    expect(filled.state.orders).toEqual([]);
    expect(filled.state.positions).toHaveLength(1);
  });
});

describe("news windows: NewsCalendar", () => {
  function doc(initial: Record<string, unknown> | null) {
    const box = { data: initial, fail: false, reads: 0 };
    return { box, reader: { get: async () => { box.reads += 1; if (box.fail) throw new Error("UNAVAILABLE"); return { exists: box.data !== null, data: () => box.data ?? undefined }; } } };
  }

  it("follows the document, reports a change once, keeps the last calendar while unreadable, drops windows that end", async () => {
    let now = T0;
    const { box, reader } = doc({ enforce: true, events: [{ title: "CPI", at: T0 + HOUR, currencies: ["USD"] }] });
    const changes: number[] = [], errors: number[] = [];
    const cal = new NewsCalendar({ control: reader, clock: () => now, onChange: s => changes.push(s.windows.length), onError: (_e, n) => errors.push(n) });
    expect(cal.current()).toEqual({ enforce: false, windows: [] });
    await cal.refresh(); await cal.refresh();
    expect(cal.current().enforce).toBe(true);
    expect(changes).toEqual([1]);
    box.fail = true;
    await cal.refresh();
    expect(cal.current().windows).toHaveLength(1);
    expect(cal.health()).toMatchObject({ enforce: true, windows: 1, activeNow: 0, readFailures: 1 });
    now = T0 + HOUR;
    expect(cal.health().activeNow).toBe(1);
    now = T0 + HOUR + 2 * MIN;
    expect(cal.current().windows).toEqual([]);
    box.fail = false; box.data = null;
    await cal.refresh();
    expect(cal.current()).toEqual({ enforce: false, windows: [] });
    expect(errors).toEqual([1]);
    expect(cal.health().readFailures).toBe(0);
  });

  it("reads every interval after start() until stop()", async () => {
    vi.useFakeTimers();
    try {
      const { box, reader } = doc(null);
      const cal = new NewsCalendar({ control: reader, everyMs: 60_000 });
      await cal.start();
      expect(box.reads).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(box.reads).toBe(2);
      cal.stop();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(box.reads).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});

describe("news windows: HTTP contract and gateways", () => {
  async function setup(state: NewsState) {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    await venue.open("acc_1");
    const cal = new NewsCalendar({ initial: state, clock: () => T0 });
    venue.useNews(() => cal.current());
    const opts: HostOptions = {
      venue, verifyToken: async t => (t === "good" ? "u1" : null), canAccess: async (u, a) => u === "u1" && a === "acc_1",
      tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }),
    };
    const fetcher = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: u.pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
    return { venue, cal, opts, gw: new HttpGateway("https://api.example.com", async () => "good", fetcher) };
  }

  it("GET /v1/status lists the windows; an order inside one is refused with 409 news_window and nothing is recorded", async () => {
    const w = usdAt(T0);
    const { venue, opts, gw } = await setup({ enforce: true, windows: [w] });
    const s = await gw.status();
    expect(s.news).toEqual({ enforce: true, windows: [w] });
    const raw = await handleEngineRequest({ method: "POST", path: "/v1/accounts/acc_1/orders", headers: { authorization: "Bearer good" }, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } }, opts);
    expect(raw.status).toBe(409);
    expect((raw.body as { error: { code: string } }).error.code).toBe("news_window");
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "sell", type: "market", lots: 1 })).rejects.toMatchObject({ code: "news_window" });
    expect((await venue.snapshot("acc_1")).state.positions).toEqual([]);
    // Alerts never trade, so they work inside a window.
    expect((await gw.addAlert("acc_1", { symbol: "EURUSD", price: 1.09, condition: "above" })).state.alerts).toHaveLength(1);
  });

  it("without a calendar the status has no news field", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    expect(venue.newsStatus()).toBeUndefined();
    const r = await handleEngineRequest({ method: "GET", path: "/v1/status", headers: { authorization: "Bearer good" } }, { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) });
    expect((r.body as { news?: unknown }).news).toBeUndefined();
  });

  it("parseNews keeps well-formed windows only and treats an unclear enforce as enforced", () => {
    const good = usdAt(T0);
    expect(parseNews(undefined)).toBeUndefined();
    expect(parseNews({ enforce: true })).toBeUndefined();
    expect(parseNews({ enforce: false, windows: [good] })).toEqual({ enforce: false, windows: [good] });
    expect(parseNews({ enforce: "maybe", windows: [] })).toEqual({ enforce: true, windows: [] });
    const bad = [
      { ...good, id: "" }, { ...good, title: " " }, { ...good, at: good.to + 1 }, { ...good, to: good.from }, { ...good, currencies: ["usd"] },
      { ...good, currencies: [] }, { ...good, to: good.from + 6 * HOUR }, null, "x",
    ];
    expect(parseNews({ enforce: true, windows: [...bad, { ...good, title: "ok\u0007" }] })?.windows).toEqual([{ ...good, title: "ok" }]);
  });

  it("createEngineServer reads the calendar, refuses inside a window and reports health; LocalGatewayAdapter too", async () => {
    const cal = new NewsCalendar({ initial: { enforce: true, windows: [usdAt(T0)] }, clock: () => T0 });
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async () => rules, feed, accounts: async () => [], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      news: cal, clock: () => T0, rateLimits: false,
    });
    server.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    expect(server.status().news).toMatchObject({ enforce: true, windows: 1, activeNow: 1 });
    const status = await server.handle({ method: "GET", path: "/v1/status", headers: { authorization: "Bearer t" } });
    expect((status.body as { news?: NewsState }).news?.windows).toHaveLength(1);
    await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: { authorization: "Bearer t" } });
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: { authorization: "Bearer t" }, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } });
    expect(refused.status).toBe(409);
    await server.stop();

    const local = new LocalGatewayAdapter(server.venue);
    expect((await local.status()).news?.enforce).toBe(true);
    await expect(local.placeOrder("acc_9", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).rejects.toMatchObject({ code: "news_window" });
    cal.set({ enforce: false, windows: [usdAt(T0)] });
    expect((await local.placeOrder("acc_9", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).state.positions).toHaveLength(1);
  });
});

describe("news windows: terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function terminal(state: NewsState) {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: Date.now() });
    await v.open(account.accountId);
    v.useNews(() => state);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    return { v, ticket };
  }

  it("inside an enforced window: note, badge in Market Watch, Confirm replaced by the reason; the calendar in the specification", async () => {
    const { ticket } = await terminal({ enforce: true, windows: [usdAt(T0, { title: "Test payrolls" })] });
    expect(await within(ticket).findByTestId("news-note")).toHaveTextContent(/^New EURUSD orders are paused around Test payrolls \(USD\) at .* your time\. They reopen at .* \(in 2m\)\. Closing trades, cancelling orders and changing stop loss or take profit still work\.$/);
    expect(screen.getByTestId("news-EURUSD")).toHaveTextContent("News now");
    expect(screen.queryByTestId("news-EURGBP")).toBeNull();
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(screen.queryByTestId("confirm-order")).toBeNull();
    expect(within(screen.getByTestId("order-review")).getByText(/New EURUSD orders are paused around Test payrolls .* This order was not sent\.$/)).toBeInTheDocument();
    fireEvent.click(within(ticket).getByTestId("spec-button"));
    const spec = await screen.findByTestId("contract-spec");
    expect(within(spec).getByTestId("spec-news-rule")).toHaveTextContent("New EURUSD orders are refused inside these windows.");
    expect(within(spec).getByTestId("spec-news")).toHaveTextContent(/Test payrolls USD.*in force now/);
  });

  it("information only: a release within the hour is announced and Confirm stays available", async () => {
    const { ticket } = await terminal({ enforce: false, windows: [usdAt(T0 + 30 * MIN)] });
    expect(await within(ticket).findByTestId("news-note")).toHaveTextContent(/^Test USD release \(USD\) at .* your time \(in 30m\)\. Prices can jump and spreads widen around it\.$/);
    expect(screen.queryByTestId("news-EURUSD")).toBeNull(); // badge only within 15 minutes
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(await screen.findByTestId("confirm-order")).toBeInTheDocument();
  });

  it("no calendar connected: no note, and the specification says so honestly", async () => {
    const venueState = { enforce: false, windows: [] };
    const { ticket } = await terminal(venueState);
    expect(within(ticket).queryByTestId("news-note")).toBeNull();
    fireEvent.click(within(ticket).getByTestId("spec-button"));
    expect(within(await screen.findByTestId("contract-spec")).getByTestId("spec-news-none")).toHaveTextContent("No releases listed for EUR or USD in the next 7 days.");
    // A status without `news` at all:
    expect(pairNews({}, { base: "EUR", quote: "USD" }, T0)).toEqual({ connected: false, enforce: false, active: null, upcoming: [] });
  });

  it("sentences for a coming enforced window and pairNews helpers", () => {
    const w = usdAt(T0 + 20 * MIN);
    const n = pairNews({ news: { enforce: true, windows: [w, usdAt(T0 + 3 * HOUR, { id: "later" })] } }, { base: "USD", quote: "JPY" }, T0);
    expect(newsBlocks(n)).toBe(false);
    expect(n.upcoming.map(x => x.id)).toEqual([w.id, "later"]);
    expect(newsNoteSentence(n, "USDJPY", T0)).toMatch(/^Test USD release \(USD\) at .* your time: new USDJPY orders are refused from .* to .* \(starts in 18m\)\.$/);
    expect(newsNoteSentence(pairNews({ news: { enforce: true, windows: [usdAt(T0 + 2 * HOUR)] } }, { base: "USD", quote: "JPY" }, T0), "USDJPY", T0)).toBeNull();
  });
});

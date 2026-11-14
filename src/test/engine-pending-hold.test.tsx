import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, Quote, QuoteBook, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter, parseNews, parsePaused } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { newAccount, pendingFillHold, placeOrder, tick, type EngineContext } from "@/engine/core";
import { NewsCalendar, newsStatus, readNewsDocument, type NewsState, type NewsWindow } from "@/engine/news";
import { readPauseDocument, TradingPause } from "@/engine/trading-pause";
import { describePauseSetting, engineChecklist } from "@/engine/preflight";
import { pendingHold, waitingOrdersSentence } from "@/trade-access/pending-hold";
import { newsNoteSentence, pairNews } from "@/trade-access/news-windows";
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
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eurusd: [number, number], eurgbp: [number, number] = [0.87, 0.8701]): QuoteBook => ({
  EURUSD: q("EURUSD", eurusd[0], eurusd[1], time), EURGBP: q("EURGBP", eurgbp[0], eurgbp[1], time), GBPUSD: q("GBPUSD", 1.25, 1.2501, time),
});
const ctxAt = (now: number, quotes: QuoteBook, extra: Partial<EngineContext> = {}): EngineContext => ({ specs, quotes, rules, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}`, ...extra });
const usdWindow = (at: number, extra: Partial<NewsWindow> = {}): NewsWindow => ({ id: `w${at}`, title: "Test USD release", at, from: at - 2 * MIN, to: at + 2 * MIN, currencies: ["USD"], ...extra });

/** An account with a EURUSD buy limit at 1.0790 and a buy stop at 1.0810 (market 1.0800/1.0801), and a EURGBP buy limit at 0.8690. */
function withOrders(): AccountState {
  let s = newAccount("acc", rules, T0);
  const c = ctxAt(T0, book(T0, [1.08, 1.0801]));
  s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 }, c).state;
  s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "stop", lots: 1, price: 1.081 }, c).state;
  s = placeOrder(s, { symbol: "EURGBP", side: "buy", type: "limit", lots: 1, price: 0.869 }, c).state;
  return s;
}

describe("holding waiting pending orders: engine core", () => {
  it("without a hold, a pending order fills as before", () => {
    const s = withOrders();
    const r = tick(s, ctxAt(T0 + MIN, book(T0 + MIN, [1.0785, 1.0786], [0.8685, 0.8686])));
    expect(r.state.orders.map(o => o.symbol)).toEqual(["EURUSD"]); // the stop at 1.0810 is not reached
    expect(r.state.positions.map(p => [p.symbol, p.entryPrice])).toEqual([["EURUSD", 1.0786], ["EURGBP", 0.8686]]);
  });

  it("the owner's pause with holdPending keeps every waiting order in the book; the first price after it decides the fill", () => {
    const s = withOrders();
    const during = tick(s, ctxAt(T0 + MIN, book(T0 + MIN, [1.0785, 1.0786], [0.8685, 0.8686]), { holdPendingFills: true }));
    expect(during.state.orders).toHaveLength(3);
    expect(during.state.positions).toEqual([]);
    expect(during.events.filter(e => e.type === "order_triggered")).toEqual([]);
    // The price jumps above the buy stop while held: after the pause the stop fills at the market (not at its level), the limit is no longer reached.
    const jumped = tick(during.state, ctxAt(T0 + 2 * MIN, book(T0 + 2 * MIN, [1.083, 1.0831]), { holdPendingFills: true }));
    expect(jumped.state.positions).toEqual([]);
    const after = tick(jumped.state, ctxAt(T0 + 3 * MIN, book(T0 + 3 * MIN, [1.083, 1.0831])));
    expect(after.state.positions.map(p => [p.symbol, p.side, p.entryPrice])).toEqual([["EURUSD", "buy", 1.0831]]);
    expect(after.state.orders.map(o => [o.symbol, o.type])).toEqual([["EURUSD", "limit"], ["EURGBP", "limit"]]);
  });

  it("a hold never stops risk from being reduced: stop losses close, expiry still removes orders", () => {
    let s = newAccount("acc", rules, T0);
    const c = ctxAt(T0, book(T0, [1.08, 1.0801]));
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.078 }, c).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.0775, expiresAt: T0 + 5 * MIN }, c).state;
    const stopped = tick(s, ctxAt(T0 + MIN, book(T0 + MIN, [1.0779, 1.078]), { holdPendingFills: true }));
    expect(stopped.state.positions).toEqual([]);
    expect(stopped.state.history.at(-1)?.reason).toBe("stop_loss");
    expect(stopped.state.orders).toHaveLength(1);
    const expired = tick(stopped.state, ctxAt(T0 + 6 * MIN, book(T0 + 6 * MIN, [1.077, 1.0771]), { holdPendingFills: true }));
    expect(expired.state.orders).toEqual([]);
    expect(expired.events.map(e => e.type)).toContain("order_expired");
    expect(expired.state.positions).toEqual([]); // expired before it could fill
  });

  it("an enforced news window with holdPending holds orders only on the affected pairs, only inside the window", () => {
    const s = withOrders();
    const news: NewsState = { enforce: true, holdPending: true, windows: [usdWindow(T0 + 2 * MIN)] }; // 10:00–10:04 UTC
    const prices = (t: number) => book(t, [1.0785, 1.0786], [0.8685, 0.8686]);
    const inside = tick(s, ctxAt(T0 + MIN, prices(T0 + MIN), { news }));
    expect(inside.state.orders.map(o => [o.symbol, o.type])).toEqual([["EURUSD", "limit"], ["EURUSD", "stop"]]); // EURGBP has no USD: it filled
    expect(inside.state.positions.map(p => p.symbol)).toEqual(["EURGBP"]);
    const after = tick(inside.state, ctxAt(T0 + 4 * MIN, prices(T0 + 4 * MIN), { news }));
    expect(after.state.positions.map(p => [p.symbol, p.entryPrice])).toEqual([["EURGBP", 0.8686], ["EURUSD", 1.0786]]);
  });

  it("without holdPending, or with an information-only calendar, orders fill inside windows as before", () => {
    const prices = book(T0 + MIN, [1.0785, 1.0786], [0.8685, 0.8686]);
    for (const news of [{ enforce: true, windows: [usdWindow(T0 + 2 * MIN)] }, { enforce: false, holdPending: true, windows: [usdWindow(T0 + 2 * MIN)] }] as NewsState[]) {
      expect(tick(withOrders(), ctxAt(T0 + MIN, prices, { news })).state.positions).toHaveLength(2);
    }
  });

  it("pendingFillHold names the reason", () => {
    const news: NewsState = { enforce: true, holdPending: true, windows: [usdWindow(T0)] };
    expect(pendingFillHold("EURUSD", { specs, now: T0, news })).toBe("news");
    expect(pendingFillHold("EURGBP", { specs, now: T0, news })).toBeNull();
    expect(pendingFillHold("EURGBP", { specs, now: T0, news, holdPendingFills: true })).toBe("paused");
    expect(pendingFillHold("EURUSD", { specs, now: T0 + HOUR, news })).toBeNull();
  });
});

describe("holding waiting pending orders: the owner's documents", () => {
  it("news document: holdPending true / \"true\" holds; false or missing does not; anything else holds and is reported", () => {
    const events = [{ title: "Test release", at: T0 + HOUR, currencies: ["USD"] }];
    expect(readNewsDocument({ enforce: true, holdPending: true, events }, T0).state.holdPending).toBe(true);
    expect(readNewsDocument({ enforce: true, holdPending: "true", events }, T0).state.holdPending).toBe(true);
    expect(readNewsDocument({ enforce: true, holdPending: false, events }, T0).state).not.toHaveProperty("holdPending");
    expect(readNewsDocument({ enforce: true, events }, T0)).toMatchObject({ problems: [] });
    const odd = readNewsDocument({ enforce: true, holdPending: "maybe", events }, T0);
    expect(odd.state.holdPending).toBe(true);
    expect(odd.problems.join(" ")).toMatch(/"holdPending" should be true or false .*held/);
    expect(newsStatus({ enforce: true, holdPending: true, windows: [] }, T0)).toEqual({ enforce: true, holdPending: true, windows: [] });
  });

  it("news calendar keeps holdPending through reads, set() and health, and reports a change of it", async () => {
    let data: Record<string, unknown> = { enforce: true, events: [] };
    const onChange = vi.fn();
    const cal = new NewsCalendar({ control: { get: async () => ({ exists: true, data: () => data }) }, clock: () => T0, onChange });
    await cal.refresh();
    expect(cal.health().holdPending).toBe(false);
    data = { enforce: true, holdPending: true, events: [] };
    await cal.refresh();
    expect(cal.current().holdPending).toBe(true);
    expect(cal.health()).toMatchObject({ enforce: true, holdPending: true });
    expect(onChange).toHaveBeenCalledTimes(2);
    cal.set({ enforce: false, windows: [] });
    expect(cal.current()).toEqual({ enforce: false, windows: [] });
  });

  it("pause document: holdPending true holds; anything unclear holds and is reported; pause() from code can hold", () => {
    expect(readPauseDocument({ paused: true, holdPending: true }, T0).state?.holdPending).toBe(true);
    expect(readPauseDocument({ paused: true }, T0).state).not.toHaveProperty("holdPending");
    expect(readPauseDocument({ paused: false, holdPending: true }, T0).state).toBeNull(); // only with a pause
    const odd = readPauseDocument({ paused: true, holdPending: 1 }, T0);
    expect(odd.state?.holdPending).toBe(true);
    expect(odd.problems.join(" ")).toMatch(/"holdPending" should be true or false/);
    const pause = new TradingPause({ clock: () => T0 });
    pause.pause("Checks.", null, true);
    expect(pause.health()).toMatchObject({ paused: true, holdPending: true });
    pause.resume();
    expect(pause.health()).toMatchObject({ paused: false, holdPending: false });
  });

  it("a switch from holding to not holding counts as a change", async () => {
    let data: Record<string, unknown> = { paused: true, reason: "Checks." };
    const onChange = vi.fn();
    const pause = new TradingPause({ control: { get: async () => ({ exists: true, data: () => data }) }, clock: () => T0, onChange });
    await pause.refresh();
    data = { paused: true, reason: "Checks.", holdPending: true };
    await pause.refresh();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toMatchObject({ holdPending: true });
  });

  it("the readiness check explains both switches", () => {
    expect(describePauseSetting({})).toContain("holdPending: true");
    const detail = engineChecklist({ FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50", FYNX_ENGINE_ALLOWED_ORIGINS: "https://www.fynxfunded.com" }, FOREX_PAIRS).find(i => i.name === "Trading settings")?.detail.join(" ") ?? "";
    expect(detail).toMatch(/with holdPending: true waiting pending orders on the affected pairs also wait/);
  });
});

describe("holding waiting pending orders: server, gateways", () => {
  it("createEngineServer: a pause with holdPending keeps orders from filling in the timer step; /v1/status says so", async () => {
    const pause = new TradingPause({ clock: () => T0 });
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async () => rules, feed, accounts: async () => [], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      pause, clock: () => T0, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, T0));
    await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    const placed = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 } });
    expect(placed.status).toBe(200);
    pause.pause("Liquidity provider check.", null, true);
    const status = await server.handle({ method: "GET", path: "/v1/status", headers: auth });
    expect((status.body as { paused?: unknown }).paused).toEqual({ reason: "Liquidity provider check.", since: T0, until: null, holdPending: true });
    expect(server.status().pause).toMatchObject({ paused: true, holdPending: true });
    feed.push(q("EURUSD", 1.0785, 1.0786, T0));
    const held = await server.venue.snapshot("acc_9");
    expect(held.state.orders).toHaveLength(1);
    expect(held.state.positions).toEqual([]);
    // A pause without holdPending lets it fill, as before.
    pause.pause("Liquidity provider check.");
    expect(((await server.handle({ method: "GET", path: "/v1/status", headers: auth })).body as { paused?: unknown }).paused).toEqual({ reason: "Liquidity provider check.", since: T0, until: null });
    const filled = await server.venue.snapshot("acc_9");
    expect(filled.state.orders).toEqual([]);
    expect(filled.state.positions[0].entryPrice).toBe(1.0786);
    await server.stop();
  });

  it("parsePaused and parseNews keep holdPending only when it is plainly true", () => {
    expect(parsePaused({ reason: "x", holdPending: true })).toEqual({ reason: "x", since: null, until: null, holdPending: true });
    expect(parsePaused({ reason: "x", holdPending: "yes" })).toEqual({ reason: "x", since: null, until: null });
    expect(parseNews({ enforce: true, holdPending: true, windows: [] })).toEqual({ enforce: true, holdPending: true, windows: [] });
    expect(parseNews({ enforce: true, windows: [] })).toEqual({ enforce: true, windows: [] });
  });

  it("LocalGatewayAdapter passes holdPending in its status", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const pause = new TradingPause({ clock: () => T0 });
    pause.pause("Checks.", null, true);
    venue.useNews(() => ({ enforce: true, holdPending: true, windows: [] }));
    const local = new LocalGatewayAdapter(venue, { pause: () => pause.current() });
    const s = await local.status();
    expect(s.paused).toMatchObject({ holdPending: true });
    expect(s.news).toMatchObject({ enforce: true, holdPending: true });
  });
});

describe("holding waiting pending orders: terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function venueWithOrder() {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    const placed = await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 });
    return { v, orderId: placed.state.orders[0].id };
  }

  it("pause with holdPending: banner says waiting orders are held; the Pending orders row is tagged Held", async () => {
    const { v, orderId } = await venueWithOrder();
    const pause = new TradingPause();
    pause.pause("Broker maintenance.", T0 + 2 * HOUR, true);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v, { pause: () => pause.current() })} />} /></Routes></MemoryRouter>);
    expect(await screen.findByTestId("trading-paused")).toHaveTextContent("Pending orders already waiting are held too and fill only after trading resumes.");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /Pending orders/ })); });
    const tag = await screen.findByTestId(`held-${orderId}`);
    expect(tag).toHaveTextContent("Held");
    expect(tag.getAttribute("title")).toMatch(/^Held: FYNX has paused new trading \(expected back by .* your time\)\. This order stays in place but does not fill until trading resumes/);
  });

  it("pause without holdPending: the banner says waiting orders can still fill; no Held tag", async () => {
    const { v, orderId } = await venueWithOrder();
    const pause = new TradingPause();
    pause.pause("Broker maintenance.");
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v, { pause: () => pause.current() })} />} /></Routes></MemoryRouter>);
    expect(await screen.findByTestId("trading-paused")).toHaveTextContent("Pending orders already waiting can still fill at their price; cancel any you no longer want.");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /Pending orders/ })); });
    await waitFor(() => expect(screen.getByText(orderId)).toBeInTheDocument());
    expect(screen.queryByTestId(`held-${orderId}`)).toBeNull();
  });

  it("enforced news window with holdPending: ticket note and specification say so; the row is tagged Held · news", async () => {
    const { v, orderId } = await venueWithOrder();
    v.useNews(() => ({ enforce: true, holdPending: true, windows: [usdWindow(T0, { title: "Test payrolls" })] }));
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const ticket = screen.getByTestId("order-ticket");
    expect(await within(ticket).findByTestId("news-note")).toHaveTextContent("Pending orders already waiting on this pair are held until the window ends.");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /Pending orders/ })); });
    const tag = await screen.findByTestId(`held-${orderId}`);
    expect(tag).toHaveTextContent("Held · news");
    expect(tag.getAttribute("title")).toMatch(/^Held around Test payrolls \(USD\): this order does not fill until .* your time/);
    fireEvent.click(within(ticket).getByTestId("spec-button"));
    expect(within(await screen.findByTestId("contract-spec")).getByTestId("spec-news-rule")).toHaveTextContent("Pending orders already waiting on this pair are held until a window ends.");
  });

  it("helpers: pendingHold mirrors the engine; sentences for coming windows", () => {
    const news: NewsState = { enforce: true, holdPending: true, windows: [usdWindow(T0 + 30 * MIN)] };
    expect(pendingHold({ news }, "EURUSD", T0)).toBeNull(); // not yet in force
    expect(pendingHold({ news }, "EURUSD", T0 + 30 * MIN)).toMatchObject({ kind: "news", until: T0 + 32 * MIN });
    expect(pendingHold({ news }, "EURGBP", T0 + 30 * MIN)).toBeNull();
    expect(pendingHold({ news: { ...news, enforce: false } }, "EURUSD", T0 + 30 * MIN)).toBeNull();
    expect(pendingHold({ news: { ...news, holdPending: false } }, "EURUSD", T0 + 30 * MIN)).toBeNull();
    expect(pendingHold({ paused: { reason: "x", since: T0, until: null, holdPending: true } }, "USDJPY", T0)).toMatchObject({ kind: "paused", until: null });
    expect(pendingHold({ paused: { reason: "x", since: T0, until: null } }, "USDJPY", T0)).toBeNull();
    expect(pendingHold(null, "EURUSD", T0)).toBeNull();
    expect(newsNoteSentence(pairNews({ news }, { base: "EUR", quote: "USD" }, T0), "EURUSD", T0)).toMatch(/; waiting pending orders on this pair are held then too\.$/);
    expect(waitingOrdersSentence(false, "news")).toBe("Pending orders already waiting can still fill at their price; cancel any you no longer want.");
  });
});

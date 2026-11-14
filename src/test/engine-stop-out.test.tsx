import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, EngineEvent, Quote, QuoteBook, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { metrics, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import { stopOutFirst, stopOutNote, stopOutRuleText, stoppedOut, validStopOut } from "@/engine/stop-out";
import { noticesFor } from "@/engine/notifier";
import { stopOutRule } from "@/trade-access/stop-out";
import { reasonLabel } from "@/trade-access/statement";
import { CLOSE_REASON_LABELS } from "@/lib/tradingData";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

// Test values only: these prices exercise the plumbing; they are not market data.
const WED = Date.parse("2026-11-11T10:00:00Z");
const SAT = Date.parse("2026-11-14T12:00:00Z");
// Loss limits at 100 % (floor 0) so the stop out can be seen on its own.
const base: RuleSet = { startingBalance: 10000, dailyLossPercent: 100, maxLossPercent: 100, profitTargetPercent: null, minTradingDays: 0, resetHourUtc: 22 };
const rules: RuleSet = { ...base, stopOutPercent: 50 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eur: [number, number] = [1.08, 1.0801], gbp: [number, number] = [1.25, 1.2501]): QuoteBook => ({ EURUSD: q("EURUSD", eur[0], eur[1], time), GBPUSD: q("GBPUSD", gbp[0], gbp[1], time) });
const ctxAt = (now: number, quotes: QuoteBook = book(now), r: RuleSet = rules): EngineContext => ({ specs, quotes, rules: r, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}` });

/** Buy 2 lots EURUSD, then sell 0.5 lots GBPUSD (margin level about 107 % at the start). */
function twoTrades(r: RuleSet = rules): AccountState {
  let s = newAccount("acc", r, WED);
  s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 2 }, ctxAt(WED, book(WED), r)).state;
  return placeOrder(s, { symbol: "GBPUSD", side: "sell", type: "market", lots: 0.5 }, ctxAt(WED + 1000, book(WED + 1000), r)).state;
}

describe("stop-out helpers", () => {
  it("accepts levels from 10 % to 100 % with at most one decimal", () => {
    for (const ok of [10, 50, 62.5, 100]) expect(validStopOut(ok)).toBe(true);
    for (const bad of [0, 9.9, 100.1, 50.25, NaN, "50", null, undefined]) expect(validStopOut(bad)).toBe(false);
  });
  it("is reached at or below the level, never without margin in use", () => {
    expect(stoppedOut(50, 50)).toBe(true);
    expect(stoppedOut(49.99, 50)).toBe(true);
    expect(stoppedOut(50.01, 50)).toBe(false);
    expect(stoppedOut(null, 50)).toBe(false);
    expect(stoppedOut(10, undefined)).toBe(false);
  });
  it("closes the largest loss first, then the oldest, then by id", () => {
    const p = (id: string, openedAt: number) => ({ id, openedAt });
    expect(stopOutFirst([])).toBeNull();
    expect(stopOutFirst([{ position: p("a", 1), result: -10 }, { position: p("b", 2), result: -500 }, { position: p("c", 0), result: 30 }])!.id).toBe("b");
    expect(stopOutFirst([{ position: p("b", 5), result: -10 }, { position: p("a", 9), result: -10 }, { position: p("c", 1), result: -10 }])!.id).toBe("c");
    expect(stopOutFirst([{ position: p("b", 1), result: -10 }, { position: p("a", 1), result: -10 }])!.id).toBe("a");
  });
  it("plain rule text and terminal notes", () => {
    expect(stopOutRuleText(50)).toBe("If the margin level falls to 50%, trades are closed at the market, largest loss first, until it is above 50% again");
    expect(stopOutNote(150, 50)).toBeNull(); // far away
    expect(stopOutNote(null, 50)).toBeNull(); // no margin in use
    expect(stopOutNote(80, null)).toBeNull(); // no rule
    expect(stopOutNote(100, 50)).toMatchObject({ reached: false, text: expect.stringMatching(/^Margin level 100%, close to the stop out at 50%\./) });
    expect(stopOutNote(42.5, 50)).toMatchObject({ reached: true, text: expect.stringMatching(/^Margin level 42\.5% has reached the stop out at 50%/) });
  });
});

describe("stop-out level from the purchased rules", () => {
  const ok = { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 };
  it("missing, null or empty = no stop out; numbers, number text and \"50%\" are read", () => {
    expect(rulesFromPurchase(10000, ok)).not.toHaveProperty("stopOutPercent");
    expect(rulesFromPurchase(10000, { ...ok, stop_out_level: null })).not.toHaveProperty("stopOutPercent");
    expect(rulesFromPurchase(10000, { ...ok, stop_out_level: "" })).not.toHaveProperty("stopOutPercent");
    expect(rulesFromPurchase(10000, { ...ok, stop_out_level: 50 })).toMatchObject({ stopOutPercent: 50 });
    expect(rulesFromPurchase(10000, { ...ok, stop_out_level: " 30 " })).toMatchObject({ stopOutPercent: 30 });
    expect(rulesFromPurchase(10000, { ...ok, stop_out_level: "62.5%" })).toMatchObject({ stopOutPercent: 62.5 });
  });
  it("unclear values are refused so the account goes to review", () => {
    for (const bad of [0, 5, 101, "abc", "%", 50.55, true]) expect(() => rulesFromPurchase(10000, { ...ok, stop_out_level: bad as number })).toThrow(/Stop-out level must be a percent from 10 to 100/);
  });
});

describe("engine: margin stop out", () => {
  it("closes the trade with the largest loss at the market until the margin level is above the level; the account stays open", () => {
    const s = twoTrades();
    const at = WED + 60_000, prices = book(at, [1.05, 1.0501]);
    expect(metrics(s, ctxAt(at, prices)).marginLevel!).toBeLessThanOrEqual(50);
    const r = tick(s, ctxAt(at, prices));
    expect(r.state.status).toBe("active");
    expect(r.state.positions.map(p => p.symbol)).toEqual(["GBPUSD"]);
    const deal = r.state.history.at(-1)!;
    expect(deal).toMatchObject({ symbol: "EURUSD", reason: "stop_out", exitPrice: 1.05, closedAt: at });
    expect(metrics(r.state, ctxAt(at, prices)).marginLevel!).toBeGreaterThan(50);
    expect(r.events.filter(e => e.type === "position_closed")).toHaveLength(1);
    expect(r.events.some(e => e.type === "account_breached")).toBe(false);
  });

  it("keeps closing, largest loss first (not the oldest), while the level is still reached", () => {
    const s = twoTrades();
    const at = WED + 60_000, prices = book(at, [1.07, 1.0701], [1.3999, 1.4]);
    const r = tick(s, ctxAt(at, prices));
    const closed = r.events.filter((e): e is Extract<EngineEvent, { type: "position_closed" }> => e.type === "position_closed").map(e => e.deal);
    expect(closed.map(d => [d.symbol, d.reason])).toEqual([["GBPUSD", "stop_out"], ["EURUSD", "stop_out"]]);
    expect(r.state.positions).toEqual([]);
    expect(r.state.status).toBe("active");
  });

  it("above the level nothing happens", () => {
    const s = twoTrades();
    const at = WED + 60_000, prices = book(at, [1.065, 1.0651]);
    expect(metrics(s, ctxAt(at, prices)).marginLevel!).toBeGreaterThan(50);
    const r = tick(s, ctxAt(at, prices));
    expect(r.state.positions).toHaveLength(2);
    expect(r.events).toEqual([]);
  });

  it("without the rule, trades stay open exactly as before", () => {
    const s = twoTrades(base);
    const at = WED + 60_000, prices = book(at, [1.05, 1.0501]);
    const r = tick(s, ctxAt(at, prices, base));
    expect(r.state.positions).toHaveLength(2);
  });

  it("waits on a stale or missing price and closes on the first fresh one", () => {
    const s = twoTrades();
    const at = WED + 10 * 60_000;
    // GBPUSD's price is old: nothing is decided on it.
    const stale: QuoteBook = { EURUSD: q("EURUSD", 1.05, 1.0501, at), GBPUSD: q("GBPUSD", 1.25, 1.2501, at - 120_000) };
    expect(tick(s, ctxAt(at, stale)).state.positions).toHaveLength(2);
    const missing: QuoteBook = { EURUSD: q("EURUSD", 1.05, 1.0501, at) };
    expect(tick(s, ctxAt(at, missing)).state.positions).toHaveLength(2);
    expect(tick(s, ctxAt(at, book(at, [1.05, 1.0501]))).state.positions).toHaveLength(1);
  });

  it("does not close while the market is closed", () => {
    const s = twoTrades();
    const r = tick(s, ctxAt(SAT, book(SAT, [1.05, 1.0501])));
    expect(r.state.positions).toHaveLength(2);
  });

  it("a loss limit reached at the same time wins: everything closes as the breach", () => {
    const strict: RuleSet = { ...rules, dailyLossPercent: 5, maxLossPercent: 10 };
    const s = twoTrades(strict);
    const at = WED + 60_000;
    const r = tick(s, ctxAt(at, book(at, [1.05, 1.0501]), strict));
    expect(r.state.status).toBe("breached");
    expect(r.state.history.every(d => d.reason === "maximum_loss_limit")).toBe(true);
  });

  it("an order the server accepts is never stopped out at once (new orders need free margin)", () => {
    let s = newAccount("acc", rules, WED);
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 2.7 }, ctxAt(WED)).state;
    expect(metrics(s, ctxAt(WED)).marginLevel!).toBeGreaterThan(100);
    expect(tick(s, ctxAt(WED)).state.positions).toHaveLength(1);
  });
});

describe("notices and labels", () => {
  it("one email lists every trade the stop out closed, under the loss-limit notice choice", () => {
    const at = WED + 60_000;
    const r = tick(twoTrades(), ctxAt(at, book(at, [1.07, 1.0701], [1.3999, 1.4])));
    const notices = noticesFor("acc", r.events as EngineEvent[], at);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("limit");
    expect(notices[0].subject).toMatch(/^Margin stop out: 2 trades closed, -\$/);
    expect(notices[0].text).toContain("the largest loss first");
    expect(notices[0].text).toContain("- sell 0.50 lots GBPUSD: opened at 1.25000, closed at 1.40000");
    expect(notices[0].text).toContain("The account stays open.");
  });

  it("history, CSV and dashboard say it in plain words", () => {
    expect(reasonLabel("stop_out")).toBe("Margin stop out");
    expect(CLOSE_REASON_LABELS.stop_out).toBe("Margin stop out");
  });

  it("the terminal reads the level only from a valid snapshot field", () => {
    expect(stopOutRule(null)).toBeNull();
    expect(stopOutRule({})).toBeNull();
    expect(stopOutRule({ stopOut: { level: "50" } })).toBeNull();
    expect(stopOutRule({ stopOut: { level: 5 } })).toBeNull();
    expect(stopOutRule({ stopOut: { level: 50 } })).toBe(50);
  });
});

describe("server and terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(WED)); });
  afterEach(() => { vi.useRealTimers(); });

  it("HTTP contract: snapshot carries stopOut and the timer step stops out with nobody online", async () => {
    let now = WED;
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async id => (id === "acc_9" ? rules : base), feed, accounts: async () => ["acc_9"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      clock: () => now, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    const first = await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    expect((first.body as { stopOut?: unknown }).stopOut).toEqual({ level: 50 });
    expect((await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 2.7 } })).status).toBe(200);
    now = WED + 30_000;
    feed.push(q("EURUSD", 1.05, 1.0501, now));
    const snap = await server.venue.snapshot("acc_9");
    expect(snap.state.positions).toEqual([]);
    expect(snap.state.history[0].reason).toBe("stop_out");
    expect(snap.state.status).toBe("active");
    const other = await server.handle({ method: "GET", path: "/v1/accounts/acc_free", headers: auth });
    expect(other.body).not.toHaveProperty("stopOut");
    await server.stop();
  });

  it("terminal: a note under the account bar close to the level, and the Account rules line", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 2.7 });
    // Margin level about 70 %: within twice the 50 % level, not reached.
    feed.push(q("EURUSD", 1.067, 1.0671, Date.now()));
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const note = await screen.findByTestId("stop-out-note");
    expect(note).toHaveTextContent(/^Margin level \d+(\.\d)?%, close to the stop out at 50%\. If it falls that far, the trading server closes trades at the market, largest loss first\./);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Account" })); });
    await waitFor(() => expect(screen.getByTestId("trade-rules")).toHaveTextContent("Margin stop out" + "If the margin level falls to 50%, trades are closed at the market, largest loss first, until it is above 50% again"));
  });
});

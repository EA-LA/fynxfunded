import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, EngineEvent, Quote, QuoteBook, RuleSet } from "@/engine/types";
import { EngineError } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { cancelOrder, closePosition, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import { FOREX_HOURS, scheduleBetween, type TradingHours } from "@/engine/hours";
import { DEFAULT_WEEKEND_CLOSE_MINUTES, inWeekendCutoff, weekendCutoff, weekendCutoffFromSchedule } from "@/engine/weekend";
import { noticesFor } from "@/engine/notifier";
import { pairWeekendCutoff, weekendNote, weekendRule } from "@/trade-access/weekend-close";
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
const MIN = 60_000, HOUR = 3_600_000;
// Friday 13 Nov 2026, US winter time: the forex week closes 17:00 New York = 22:00 UTC and reopens Sunday 22:00 UTC.
const FRI_CLOSE = Date.parse("2026-11-13T22:00:00Z");
const SUN_OPEN = Date.parse("2026-11-15T22:00:00Z");
const WED = Date.parse("2026-11-11T10:00:00Z");
const base: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const rules: RuleSet = { ...base, weekendCloseMinutes: 15 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eurusd: [number, number] = [1.08, 1.0801]): QuoteBook => ({ EURUSD: q("EURUSD", eurusd[0], eurusd[1], time), GBPUSD: q("GBPUSD", 1.25, 1.2501, time) });
const ctxAt = (now: number, quotes: QuoteBook = book(now), r: RuleSet = rules): EngineContext => ({ specs, quotes, rules: r, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}` });

describe("weekend cutoff times", () => {
  it("is 15 minutes before the Friday close, and the reopen is Sunday", () => {
    expect(weekendCutoff(FOREX_HOURS, WED, 15)).toEqual({ cutoffAt: FRI_CLOSE - 15 * MIN, closesAt: FRI_CLOSE, reopensAt: SUN_OPEN });
    expect(inWeekendCutoff(FOREX_HOURS, FRI_CLOSE - 16 * MIN, 15)).toBeNull();
    expect(inWeekendCutoff(FOREX_HOURS, FRI_CLOSE - 15 * MIN, 15)).toMatchObject({ closesAt: FRI_CLOSE });
    expect(inWeekendCutoff(FOREX_HOURS, FRI_CLOSE - MIN, 15)).not.toBeNull();
    expect(inWeekendCutoff(FOREX_HOURS, FRI_CLOSE + MIN, 15)).toBeNull(); // market closed: nothing to do
    expect(inWeekendCutoff(FOREX_HOURS, FRI_CLOSE - MIN, null)).toBeNull(); // no rule
    expect(inWeekendCutoff(undefined, FRI_CLOSE - MIN, 15)).toBeNull(); // trades at all times
  });

  it("follows US summer time (21:00 UTC close)", () => {
    const summerFri = Date.parse("2026-07-10T21:00:00Z");
    expect(weekendCutoff(FOREX_HOURS, Date.parse("2026-07-08T10:00:00Z"), 30)?.cutoffAt).toBe(summerFri - 30 * MIN);
  });

  it("a short break does not count; a holiday closure of a day or more does", () => {
    const daily: TradingHours = { timeZone: "UTC", weekly: [0, 1, 2, 3, 4, 5].map(d => ({ from: d * 1440, to: d * 1440 + 1435 })) }; // a 5-minute break each day, closed Saturday
    const mon = Date.parse("2026-11-09T10:00:00Z");
    // The Monday–Thursday breaks are skipped; the Friday 23:55 close is followed by the weekend.
    expect(weekendCutoff(daily, mon, 15)?.closesAt).toBe(Date.parse("2026-11-13T23:55:00Z"));
    const holiday: TradingHours = { ...FOREX_HOURS, closures: [{ from: Date.parse("2026-12-24T22:00:00Z"), to: Date.parse("2026-12-26T22:00:00Z"), reason: "Christmas" }] };
    expect(weekendCutoff(holiday, Date.parse("2026-12-24T10:00:00Z"), 15)).toEqual({ cutoffAt: Date.parse("2026-12-24T21:45:00Z"), closesAt: Date.parse("2026-12-24T22:00:00Z"), reopensAt: Date.parse("2026-12-27T22:00:00Z") }); // Christmas runs into the weekend: reopens Sunday
  });

  it("the terminal reaches the same time from the server's published schedule", () => {
    const schedule = scheduleBetween(FOREX_HOURS, WED, WED + 7 * 24 * HOUR);
    expect(weekendCutoffFromSchedule(schedule, WED, 15)).toEqual(weekendCutoff(FOREX_HOURS, WED, 15));
    // The last stretch is cut at the end of the period: its end is not a close.
    expect(weekendCutoffFromSchedule({ sessions: [{ from: WED - HOUR, to: WED + HOUR }], closures: [] }, WED, 15)).toBeNull();
    expect(weekendCutoffFromSchedule(schedule, FRI_CLOSE + HOUR, 15)).toBeNull();
  });
});

describe("weekend rule from the purchased rules", () => {
  const purchased = { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 };
  it("missing or true = holding allowed; false = default 15 minutes or the agreement's own", () => {
    expect(rulesFromPurchase(10000, purchased)).not.toHaveProperty("weekendCloseMinutes");
    expect(rulesFromPurchase(10000, { ...purchased, weekend_holding: true })).not.toHaveProperty("weekendCloseMinutes");
    expect(rulesFromPurchase(10000, { ...purchased, weekend_holding: false }).weekendCloseMinutes).toBe(DEFAULT_WEEKEND_CLOSE_MINUTES);
    expect(rulesFromPurchase(10000, { ...purchased, weekend_holding: "false", weekend_close_minutes: "30" }).weekendCloseMinutes).toBe(30);
  });
  it("unclear values are refused so the account goes to review", () => {
    expect(() => rulesFromPurchase(10000, { ...purchased, weekend_holding: "no" })).toThrow(/Weekend holding must be true or false/);
    expect(() => rulesFromPurchase(10000, { ...purchased, weekend_holding: false, weekend_close_minutes: 0 })).toThrow(EngineError);
    expect(() => rulesFromPurchase(10000, { ...purchased, weekend_holding: false, weekend_close_minutes: 7.5 })).toThrow(/whole number of minutes from 1 to 240/);
    expect(() => rulesFromPurchase(10000, { ...purchased, weekend_holding: false, weekend_close_minutes: 241 })).toThrow(EngineError);
  });
});

describe("weekend rule: engine core", () => {
  function withTrades(at: number): AccountState {
    let s = newAccount("acc", rules, at);
    const c = ctxAt(at);
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.07 }, c).state;
    s = placeOrder(s, { symbol: "GBPUSD", side: "sell", type: "market", lots: 0.5 }, c).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 }, c).state;
    return s;
  }

  it("before the cutoff nothing happens; from the cutoff every open trade closes at the market as weekend_close", () => {
    const s = withTrades(FRI_CLOSE - 2 * HOUR);
    const before = tick(s, ctxAt(FRI_CLOSE - 16 * MIN));
    expect(before.state.positions).toHaveLength(2);
    const at = FRI_CLOSE - 15 * MIN;
    const r = tick(before.state, ctxAt(at, book(at, [1.0805, 1.0806])));
    expect(r.state.positions).toEqual([]);
    expect(r.state.history.map(d => [d.symbol, d.reason, d.exitPrice])).toEqual([["EURUSD", "weekend_close", 1.0805], ["GBPUSD", "weekend_close", 1.2501]]);
    expect(r.state.status).toBe("active"); // not a breach: the account stays open
    // The waiting limit order stays in the book.
    expect(r.state.orders).toHaveLength(1);
  });

  it("without the rule, trades are held over the weekend exactly as before", () => {
    let s = newAccount("acc", base, FRI_CLOSE - HOUR);
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(FRI_CLOSE - HOUR, book(FRI_CLOSE - HOUR), base)).state;
    expect(tick(s, ctxAt(FRI_CLOSE - 5 * MIN, book(FRI_CLOSE - 5 * MIN), base)).state.positions).toHaveLength(1);
  });

  it("without a fresh price it waits and closes on the first fresh one before the close", () => {
    const s = withTrades(FRI_CLOSE - HOUR);
    const stale = tick(s, ctxAt(FRI_CLOSE - 10 * MIN, book(FRI_CLOSE - HOUR - 5 * MIN)));
    expect(stale.state.positions).toHaveLength(2);
    const fresh = tick(stale.state, ctxAt(FRI_CLOSE - 9 * MIN));
    expect(fresh.state.positions).toEqual([]);
  });

  it("a stop loss hit at the same moment closes as stop_loss, not weekend_close", () => {
    const s = withTrades(FRI_CLOSE - HOUR);
    const at = FRI_CLOSE - 10 * MIN;
    const r = tick(s, ctxAt(at, book(at, [1.0699, 1.07])));
    expect(r.state.history.find(d => d.symbol === "EURUSD")?.reason).toBe("stop_loss");
  });

  it("in the cutoff new market orders are refused with a plain message; pending orders can be placed but do not fill", () => {
    const s = newAccount("acc", rules, FRI_CLOSE - HOUR);
    const at = FRI_CLOSE - 10 * MIN;
    expect(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(at))).toThrow(expect.objectContaining({ code: "weekend_close", message: expect.stringMatching(/^This account may not hold trades over the weekend: open EURUSD trades are closed from Fri 21:45 UTC, before the market closes at Fri 22:00 UTC, and new trades open again after Sun 22:00 UTC\. Nothing was sent/) }));
    const placed = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 }, ctxAt(at));
    expect(placed.state.orders).toHaveLength(1);
    // The price reaches the limit inside the cutoff: it waits for the reopen.
    const held = tick(placed.state, ctxAt(at + MIN, book(at + MIN, [1.0785, 1.0786])));
    expect(held.state.positions).toEqual([]);
    expect(held.state.orders).toHaveLength(1);
    // After the reopen it fills, and the new week's position is not closed.
    const monday = SUN_OPEN + 5 * MIN;
    const filled = tick(held.state, ctxAt(monday, book(monday, [1.0785, 1.0786])));
    expect(filled.state.positions).toHaveLength(1);
    expect(tick(filled.state, ctxAt(monday + HOUR, book(monday + HOUR, [1.0785, 1.0786]))).state.positions).toHaveLength(1);
  });

  it("closing and cancelling are never refused in the cutoff", () => {
    const s = withTrades(FRI_CLOSE - HOUR);
    const at = FRI_CLOSE - 15 * MIN;
    const closed = closePosition(s, s.positions[0].id, undefined, ctxAt(at));
    expect(closed.state.history.at(-1)?.reason).toBe("manual");
    expect(cancelOrder(closed.state, s.orders[0].id).state.orders).toEqual([]);
  });
});

describe("weekend rule: notices and labels", () => {
  it("one email lists every trade the rule closed, under the loss-limit notice choice", () => {
    const s = (() => {
      let a = newAccount("acc", rules, FRI_CLOSE - HOUR);
      a = placeOrder(a, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(FRI_CLOSE - HOUR)).state;
      return placeOrder(a, { symbol: "GBPUSD", side: "sell", type: "market", lots: 0.5 }, ctxAt(FRI_CLOSE - HOUR)).state;
    })();
    const at = FRI_CLOSE - 15 * MIN;
    const r = tick(s, ctxAt(at, book(at, [1.081, 1.0811])));
    const notices = noticesFor("acc", r.events as EngineEvent[], at);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("limit");
    expect(notices[0].subject).toMatch(/^2 trades closed before the weekend: /);
    expect(notices[0].text).toContain("Your account may not hold trades over the weekend, so the trading server closed these trades at 2026-11-13 21:45 UTC");
    expect(notices[0].text).toContain("- buy 1.00 lots EURUSD: opened at 1.08010, closed at 1.08100");
    expect(notices[0].text).toContain("The account stays open.");
  });

  it("history, CSV and dashboard say it in plain words", () => {
    expect(reasonLabel("weekend_close")).toBe("Closed before the weekend");
    expect(CLOSE_REASON_LABELS.weekend_close).toBe("Closed before the weekend");
  });
});

describe("weekend rule: terminal helpers", () => {
  const utc = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  it("reads the rule only from a valid snapshot field", () => {
    expect(weekendRule({ weekendClose: { minutesBefore: 15 } })).toBe(15);
    expect(weekendRule({ weekendClose: { minutesBefore: "15" } })).toBeNull();
    expect(weekendRule({})).toBeNull();
    expect(weekendRule(null)).toBeNull();
  });
  it("says nothing more than a day ahead, reminds within the day, warns in the last hour and in the cutoff", () => {
    const c = pairWeekendCutoff(null, "EURUSD", WED, 15);
    expect(weekendNote(c, 15, "EURUSD", WED, utc)).toBeNull();
    const day = FRI_CLOSE - 15 * MIN - 5 * HOUR;
    expect(weekendNote(pairWeekendCutoff(null, "EURUSD", day, 15), 15, "EURUSD", day, utc)).toEqual({ inCutoff: false, warn: false, text: "No weekend holding on this account: open EURUSD trades close automatically at 21:45 your time (in 5h 00m), 15 minutes before the market closes for the weekend. Close or keep them until then as you like." });
    const soon = FRI_CLOSE - 45 * MIN;
    expect(weekendNote(pairWeekendCutoff(null, "EURUSD", soon, 15), 15, "EURUSD", soon, utc)).toMatchObject({ inCutoff: false, warn: true });
    const inside = FRI_CLOSE - 5 * MIN;
    expect(weekendNote(pairWeekendCutoff(null, "EURUSD", inside, 15), 15, "EURUSD", inside, utc)?.text).toBe("This account may not hold trades over the weekend. Open EURUSD trades are closed now, before the market closes at 22:00 your time, and new market orders are refused until it opens again 22:00. Pending orders can still be placed; they fill after the reopen.");
  });
});

describe("weekend rule: server and terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("HTTP contract: snapshot carries weekendClose, a market order in the cutoff is 409 weekend_close, the timer step closes trades", async () => {
    let now = FRI_CLOSE - HOUR;
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async () => rules, feed, accounts: async () => ["acc_9"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      clock: () => now, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    const first = await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    expect((first.body as { weekendClose?: unknown }).weekendClose).toEqual({ minutesBefore: 15 });
    expect((await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } })).status).toBe(200);
    now = FRI_CLOSE - 10 * MIN;
    feed.push(q("EURUSD", 1.0802, 1.0803, now));
    const snap = await server.venue.snapshot("acc_9");
    expect(snap.state.positions).toEqual([]);
    expect(snap.state.history[0].reason).toBe("weekend_close");
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe("weekend_close");
    await server.stop();
  });

  it("terminal: order panel note, Confirm locked for market orders in the cutoff, Positions banner and the Account rules line", async () => {
    vi.setSystemTime(new Date(FRI_CLOSE - 40 * MIN));
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
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const note = await screen.findByTestId("weekend-note");
    expect(note).toHaveTextContent(/No weekend holding on this account: open EURUSD trades close automatically at .* your time \(in 25m\), 15 minutes before the market closes for the weekend/);
    expect(await screen.findByTestId("weekend-banner")).toHaveTextContent(/open EURUSD trades close automatically/);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Account" })); });
    await waitFor(() => expect(screen.getByTestId("trade-rules")).toHaveTextContent("Weekend holding" + "Not allowed · open trades close 15 minutes before the weekend close"));
    cleanup();

    // Inside the cutoff: the market order cannot be confirmed; the reason is the weekend sentence.
    vi.setSystemTime(new Date(FRI_CLOSE - 5 * MIN));
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByTestId("weekend-note")).toHaveTextContent(/Open EURUSD trades are closed now/);
    await waitFor(() => expect(screen.getByTestId("buy-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("buy-button"));
    const review = await screen.findByTestId("order-review");
    await waitFor(() => expect(review).toHaveTextContent(/This account may not hold trades over the weekend\..*This order was not sent\./));
  });
});

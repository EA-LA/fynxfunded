import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modifyPosition, newAccount, placeOrder, tick, trailedStop, type EngineContext } from "@/engine/core";
import type { Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { FOREX_HOURS } from "@/engine/hours";
import { FOREX_PAIRS, findPair } from "@/trade-access/instruments";
import { parseTrailing, trailingPreview } from "@/trade-access/protection";
import { liveAccountSummary } from "@/trade-access/live-account";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const settings = { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 };
const specs = buildSpecs(FOREX_PAIRS, settings);
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });

/** A 1-lot EURUSD buy filled at 1.0801 with a 20-pip trailing stop and an initial stop at 1.0780. */
function trailingBuy() {
  const c = ctx([q("EURUSD", 1.08, 1.0801)]);
  const placed = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.078 }, c).state;
  return modifyPosition(placed, placed.positions[0].id, { trailingPips: 20 }, c);
}

describe("engine: trailing stop", () => {
  it("is set, changed and switched off through modifyPosition, with the same checks every time", () => {
    const step = trailingBuy();
    const p = step.state.positions[0];
    expect(p).toMatchObject({ stopLoss: 1.078, trailingStop: { pips: 20 } });
    expect(step.events).toEqual([{ type: "position_modified", positionId: p.id }]);
    const c = ctx([q("EURUSD", 1.08, 1.0801)]);
    expect(modifyPosition(step.state, p.id, { trailingPips: 20 }, c).state).toBe(step.state); // nothing changed
    expect(modifyPosition(step.state, p.id, { trailingPips: 12.5 }, c).state.positions[0].trailingStop).toEqual({ pips: 12.5 });
    const off = modifyPosition(step.state, p.id, { trailingPips: null }, c).state.positions[0];
    expect(off.trailingStop).toBeUndefined();
    expect("trailingStop" in off).toBe(false);
    expect(off.stopLoss).toBe(1.078);
    // Moving the stop keeps the trailing stop
    expect(modifyPosition(step.state, p.id, { stopLoss: 1.079 }, c).state.positions[0]).toMatchObject({ stopLoss: 1.079, trailingStop: { pips: 20 } });
    expect(() => modifyPosition(step.state, p.id, { trailingPips: 4.9 }, c)).toThrow(/between 5 and 5000 pips/);
    expect(() => modifyPosition(step.state, p.id, { trailingPips: 5001 }, c)).toThrow(/between 5 and 5000 pips/);
    expect(() => modifyPosition(step.state, p.id, { trailingPips: 10.25 }, c)).toThrow(/0.1 pips/);
    expect(() => modifyPosition(step.state, p.id, { trailingPips: Number.NaN }, c)).toThrow(/between/);
  });

  it("waits until the price is the distance in profit, then follows it and never moves back", () => {
    let state = trailingBuy().state;
    const id = state.positions[0].id;
    const at = (bid: number, t: number) => { const s = tick(state, ctx([q("EURUSD", bid, bid + 0.0001, T0 + t)], T0 + t)); state = s.state; return s.events; };
    // 15 pips in profit: not started (needs 20), stop untouched
    expect(at(1.0816, 1000)).toEqual([]);
    expect(state.positions[0].stopLoss).toBe(1.078);
    // 20 pips in profit on the bid: stop goes to break-even
    expect(at(1.0821, 2000)).toEqual([{ type: "stop_trailed", positionId: id, stopLoss: 1.0801, previousStopLoss: 1.078 }]);
    // Less than one more pip: no move (keeps writes down)
    expect(at(1.08218, 3000)).toEqual([]);
    expect(state.positions[0].stopLoss).toBe(1.0801);
    // Further up: follows 20 pips behind
    at(1.0855, 4000);
    expect(state.positions[0].stopLoss).toBe(1.0835);
    // The price falls back: the stop stays where it is
    expect(at(1.0845, 5000)).toEqual([]);
    expect(state.positions[0].stopLoss).toBe(1.0835);
    // and closes the trade in profit when hit, as a stop loss
    const events = at(1.0834, 6000);
    expect(state.positions).toEqual([]);
    expect(events[0]).toMatchObject({ type: "position_closed", deal: { reason: "stop_loss", exitPrice: 1.0834 } });
    expect(state.history[0].netProfit).toBeGreaterThan(0);
    // The risk recorded at entry is the original stop, not the trailed one
    expect(state.history[0].entryRisk).toMatchObject({ stopLoss: 1.078 });
  });

  it("trails sells on the ask, rounds away from the price and starts without any stop loss", () => {
    const c = ctx([q("USDJPY", 150, 150.02)]);
    const placed = placeOrder(newAccount("a", rules, T0), { symbol: "USDJPY", side: "sell", type: "market", lots: 0.5 }, c).state;
    const id = placed.positions[0].id;
    let state = modifyPosition(placed, id, { trailingPips: 25 }, c).state;
    expect(state.positions[0].stopLoss).toBeUndefined();
    state = tick(state, ctx([q("USDJPY", 149.73, 149.755, T0 + 1000)], T0 + 1000)).state; // ask 149.755: 24.5 pips, not yet
    expect(state.positions[0].stopLoss).toBeUndefined();
    const step = tick(state, ctx([q("USDJPY", 149.6, 149.6005, T0 + 2000)], T0 + 2000)); // ask 149.6005 + 0.25 → 149.8505 ceil to 0.001 → 149.851
    expect(step.state.positions[0].stopLoss).toBe(149.851);
    expect(step.events).toEqual([{ type: "stop_trailed", positionId: id, stopLoss: 149.851 }]);
    expect(trailedStop(specs.USDJPY, step.state.positions[0], 149.6005)).toBeNull(); // already there
  });

  it("does not move on stale prices, while the market is closed or on a breached account", () => {
    const state = trailingBuy().state;
    expect(tick(state, ctx([q("EURUSD", 1.09, 1.0901, T0 - 60_000)])).state.positions[0].stopLoss).toBe(1.078);
    const hoursSpecs = buildSpecs(FOREX_PAIRS, { ...settings, hours: FOREX_HOURS });
    const saturday = Date.parse("2026-11-07T12:00:00Z");
    const closed = tick(state, { ...ctx([q("EURUSD", 1.09, 1.0901, saturday)], saturday), specs: hoursSpecs });
    expect(closed.events.some(e => e.type === "stop_trailed")).toBe(false);
    expect(() => modifyPosition({ ...state, status: "breached" }, state.positions[0].id, { trailingPips: 30 }, ctx([q("EURUSD", 1.08, 1.0801)]))).toThrow(/loss limit/);
  });

  it("works through the venue, the HTTP contract and HttpGateway, and keeps moving with no request", async () => {
    let now = T0;
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => now);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801));
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async (t: string) => (t === "good" ? "u1" : null), canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "good", fetcher);
    const pos = (await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).state.positions[0];
    expect((await gw.modifyPosition("acc_1", pos.id, { trailingPips: 15 })).state.positions[0].trailingStop).toEqual({ pips: 15 });
    await expect(gw.modifyPosition("acc_1", pos.id, { trailingPips: 2 })).rejects.toMatchObject({ code: "bad_trailing" });
    const bad = await handleEngineRequest({ method: "PATCH", path: `/v1/accounts/acc_1/positions/${pos.id}`, headers: { authorization: "Bearer good" }, body: { trailingPips: "15" } }, opts);
    expect(bad.status).toBe(400);
    // Timer step (snapshot) with a new price: stop moves to 1.0801 + 1 pip (bid 1.0817 − 15 pips = 1.0802)
    now += 1000; feed.push(q("EURUSD", 1.0817, 1.0818, now));
    expect((await venue.snapshot("acc_1")).state.positions[0].stopLoss).toBe(1.0802);
    // Switching it off over HTTP keeps the stop where the trail left it
    const off = (await gw.modifyPosition("acc_1", pos.id, { trailingPips: null })).state.positions[0];
    expect(off.trailingStop).toBeUndefined();
    expect(off.stopLoss).toBe(1.0802);
    // Through the local adapter too, and the dashboard's live card reads it
    const snap = await new LocalGatewayAdapter(venue).modifyPosition("acc_1", pos.id, { trailingPips: 30 });
    expect(snap.state.positions[0].trailingStop).toEqual({ pips: 30 });
    expect(liveAccountSummary(snap, 10000).positions[0]).toMatchObject({ stopLoss: 1.0802, trailingPips: 30 });
  });
});

describe("terminal helpers for the trailing stop", () => {
  it("reads the distance in pips", () => {
    expect(parseTrailing("")).toEqual({ ok: true, value: null });
    expect(parseTrailing(" 12,5 ")).toEqual({ ok: true, value: 12.5 });
    expect(parseTrailing("4")).toMatchObject({ ok: false, error: expect.stringMatching(/between 5 and 5000/) });
    expect(parseTrailing("10.25")).toMatchObject({ ok: false });
    expect(parseTrailing("abc")).toMatchObject({ ok: false });
  });
  it("previews where it starts and where the stop moves, with the engine's rule", () => {
    const eur = findPair("EURUSD")!;
    expect(trailingPreview(eur, "buy", 1.0801, 1.081, 20, 1.078)).toEqual({ startsAt: 1.0821, started: false, movesTo: null });
    expect(trailingPreview(eur, "buy", 1.0801, 1.0855, 20, 1.078)).toEqual({ startsAt: 1.0821, started: true, movesTo: 1.0835 });
    expect(trailingPreview(eur, "buy", 1.0801, 1.0855, 20, 1.0835)).toMatchObject({ started: true, movesTo: null });
    expect(trailingPreview(findPair("USDJPY")!, "sell", 150, 149.6005, 25, null)).toEqual({ startsAt: 149.75, started: true, movesTo: 149.851 });
    expect(trailingPreview(eur, "buy", 1.0801, undefined, 20, null)).toEqual({ startsAt: 1.0821, started: false, movesTo: null });
  });
});

describe("terminal: trailing stop on the Positions tab", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });

  it("switches a trailing stop on, shows it in the table and the server moves the stop", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5, consistencyPercent: 40 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    await venue.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.078 });
    feed.push(q("EURUSD", 1.0811, 1.0812, Date.now()));
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    const positions = await screen.findByTestId("engine-positions");
    fireEvent.click(await within(positions).findByRole("button", { name: /Edit stop loss, take profit or volume of EURUSD/ }));
    const editor = screen.getByTestId("position-editor");
    expect(within(editor).getByTestId("trailing-outcome")).toHaveTextContent("Off. With a distance, the trading server moves your stop loss");
    fireEvent.change(within(editor).getByLabelText("Trailing stop (pips)"), { target: { value: "3" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("Trailing stop must be between 5 and 5000 pips.");
    expect(within(editor).getByRole("button", { name: "Save levels" })).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: "20 pips" }));
    expect(within(editor).getByTestId("trailing-outcome")).toHaveTextContent("Starts when the bid reaches 1.08210 (20 pips in profit), with the stop at break-even");
    await act(async () => { fireEvent.click(within(editor).getByRole("button", { name: "Save levels" })); });
    expect(await screen.findByTestId("position-notice")).toHaveTextContent("stop loss 1.07800, take profit removed, trailing stop 20 pips");
    expect((await venue.snapshot(account.accountId)).state.positions[0].trailingStop).toEqual({ pips: 20 });
    expect(within(screen.getByTestId("engine-positions")).getByText("trail 20p")).toBeInTheDocument();
    // The price runs 30 pips: the server trails the stop to 1.0811 on its own
    feed.push(q("EURUSD", 1.0831, 1.0832, Date.now()));
    expect((await venue.snapshot(account.accountId)).state.positions[0].stopLoss).toBe(1.0811);
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import { EngineError, type Quote, type RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed, type Snapshot } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter, type TradingGateway } from "@/engine/gateway";
import { handleEngineRequest, parseOrderRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { closeEach, closeSummary, planClose, positionProfit } from "@/trade-access/bulk-close";

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
const money = (v: number) => `$${v.toFixed(2)}`;

describe("engine: trailing stop set in the order", () => {
  it("gives a market order's position the trailing stop at once, with the same limits as editing it", () => {
    const c = ctx([q("EURUSD", 1.08, 1.0801)]);
    const s = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.078, trailingPips: 20 }, c);
    expect(s.state.positions[0]).toMatchObject({ entryPrice: 1.0801, stopLoss: 1.078, trailingStop: { pips: 20 } });
    // Without trailingPips the position has no trailing stop field at all
    const plain = placeOrder(newAccount("b", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, c).state.positions[0];
    expect("trailingStop" in plain).toBe(false);
    for (const bad of [4.9, 5001, 10.25, Number.NaN]) {
      expect(() => placeOrder(newAccount("c", rules, T0), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, trailingPips: bad }, c)).toThrow(EngineError);
    }
    // The engine trails it on the next price: 20 pips in profit → stop to break-even
    const moved = tick(s.state, ctx([q("EURUSD", 1.0821, 1.0822, T0 + 1000)], T0 + 1000));
    expect(moved.state.positions[0].stopLoss).toBe(1.0801);
  });

  it("keeps it on a pending order and applies it when the order fills", () => {
    const c = ctx([q("GBPUSD", 1.25, 1.2501)]);
    const placed = placeOrder(newAccount("a", rules, T0), { symbol: "GBPUSD", side: "sell", type: "limit", lots: 0.5, price: 1.2550, trailingPips: 15 }, c);
    expect(placed.state.orders[0]).toMatchObject({ price: 1.255, trailingPips: 15 });
    expect(placed.state.positions).toEqual([]);
    const filled = tick(placed.state, ctx([q("GBPUSD", 1.2552, 1.2553, T0 + 1000)], T0 + 1000));
    expect(filled.state.orders).toEqual([]);
    expect(filled.state.positions[0]).toMatchObject({ side: "sell", trailingStop: { pips: 15 } });
    expect(filled.events.some(e => e.type === "order_triggered")).toBe(true);
  });

  it("goes through the HTTP contract and HttpGateway; wrong types are refused", async () => {
    expect(parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "market", lots: 1, trailingPips: 25 })).toMatchObject({ trailingPips: 25 });
    expect(() => parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "market", lots: 1, trailingPips: "25" })).toThrow(/trailingPips must be a number/);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801));
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async (t: string) => (t === "good" ? "u1" : null), canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "good", fetcher);
    const snap = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "stop", lots: 1, price: 1.0850, trailingPips: 12.5, clientId: "k1" });
    expect(snap.state.orders[0].trailingPips).toBe(12.5);
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, trailingPips: 3 })).rejects.toMatchObject({ code: "bad_trailing" });
  });
});

/** Account with a winning EURUSD buy, a losing GBPUSD buy and a USDJPY sell, at T0 prices. */
function threePositions(): Snapshot {
  const c = ctx([q("EURUSD", 1.08, 1.0801), q("GBPUSD", 1.25, 1.2501), q("USDJPY", 150, 150.01)]);
  let s = newAccount("acc", rules, T0);
  s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 }, c).state;
  s = placeOrder(s, { symbol: "GBPUSD", side: "buy", type: "market", lots: 0.5 }, c).state;
  s = placeOrder(s, { symbol: "USDJPY", side: "sell", type: "market", lots: 0.5 }, c).state;
  const quotes = { EURUSD: q("EURUSD", 1.0821, 1.0822), GBPUSD: q("GBPUSD", 1.2490, 1.2491), USDJPY: q("USDJPY", 150, 150.01) };
  return { state: s, quotes } as unknown as Snapshot;
}

describe("terminal helpers: close all / winning / losing", () => {
  it("picks positions by their result now, keeps closed markets and unpriced ones apart", () => {
    const snap = threePositions();
    const [eur, gbp, jpy] = snap.state.positions;
    expect(positionProfit(eur, snap.quotes)).toBe(100); // 20 pips × $5
    expect(positionProfit(gbp, snap.quotes)).toBe(-55);
    expect(positionProfit(jpy, snap.quotes)).toBeCloseTo(-3.33, 2); // sold at the bid, closes at the ask: the spread
    const open = () => true;
    expect(planClose(snap, "all", open)).toEqual({ ids: [eur.id, gbp.id, jpy.id], profit: 41.67, marketClosed: [], unpriced: 0 });
    expect(planClose(snap, "winning", open)).toMatchObject({ ids: [eur.id], profit: 100 });
    expect(planClose(snap, "losing", open)).toMatchObject({ ids: [gbp.id, jpy.id], profit: -58.33 });
    // GBPUSD market closed (e.g. a holiday): listed, not sent
    expect(planClose(snap, "losing", s => s !== "GBPUSD")).toMatchObject({ ids: [jpy.id], marketClosed: [{ id: gbp.id, symbol: "GBPUSD" }] });
    // No price for USDJPY: not winning, not losing, still in "all"
    const noJpy = { ...snap, quotes: { EURUSD: snap.quotes.EURUSD, GBPUSD: snap.quotes.GBPUSD } } as Snapshot;
    expect(planClose(noJpy, "losing", open)).toMatchObject({ ids: [gbp.id], unpriced: 1 });
    expect(planClose(noJpy, "all", open)).toMatchObject({ ids: [eur.id, gbp.id, jpy.id], profit: 45 });
  });

  it("closes one by one, carries on after a refusal and skips positions that are already gone", async () => {
    const snap = threePositions();
    const deal = (positionId: string, netProfit: number, id = `${positionId}:1`) => ({ id, positionId, netProfit });
    const closePosition = vi.fn(async (_a: string, id: string) => {
      if (id === snap.state.positions[1].id) throw new EngineError("market_closed", "The GBPUSD market is closed.");
      if (id === snap.state.positions[2].id) throw new EngineError("no_position", "That position is not open.");
      return { ...snap, state: { ...snap.state, history: [deal("old", 50, "old:1"), deal(id, 193)] } } as unknown as Snapshot;
    });
    const gw = { closePosition } as unknown as TradingGateway;
    const o = await closeEach(gw, "acc", snap.state.positions.map(p => p.id), ["old:1"]);
    expect(closePosition).toHaveBeenCalledTimes(3);
    expect(o.closed).toEqual([snap.state.positions[0].id]);
    expect(o.failed).toEqual([{ id: snap.state.positions[1].id, message: "The GBPUSD market is closed." }]);
    expect(o.booked).toBe(193); // the older deal is not counted
    expect(closeSummary(o, money)).toBe(`Closed 1 position, net $193.00. 1 could not be closed: #${snap.state.positions[1].id} — The GBPUSD market is closed.`);
    expect(closeSummary({ closed: [], failed: [], booked: 0 }, money)).toBe("No position was closed.");
  });
});

describe("terminal: Positions tab bulk close and ticket trailing stop", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup(before?: (venue: LocalVenue, feed: StaticQuoteFeed) => Promise<void>) {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    feed.push(q("GBPUSD", 1.25, 1.2501, Date.now()));
    await venue.open(account.accountId);
    await before?.(venue, feed);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    return { venue, feed };
  }

  it("sends a trailing stop with the order and shows where it starts", async () => {
    const { venue } = await setup();
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    expect(within(ticket).getByTestId("ticket-trailing-help")).toHaveTextContent("Off. With a distance");
    fireEvent.change(within(ticket).getByLabelText("Trailing stop (pips)"), { target: { value: "2" } });
    expect(within(ticket).getByTestId("ticket-trailing-help")).toHaveTextContent("Trailing stop must be between 5 and 5000 pips.");
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(within(ticket).getByRole("alert")).toHaveTextContent("Fix it or clear the field to send.");
    expect(screen.getByTestId("confirm-order")).toBeDisabled();
    fireEvent.click(within(ticket).getByRole("button", { name: "Trailing stop 30 pips" }));
    expect(within(ticket).getByTestId("ticket-trailing-help")).toHaveTextContent("Starts 30 pips in profit with the stop at break-even");
    expect(within(ticket).getByTestId("ticket-trailing-help")).toHaveTextContent("it starts at 1.08310 on a buy, 1.07700 on a sell");
    expect(screen.getByTestId("order-review")).toHaveTextContent("trailing stop 30 pips");
    await act(async () => { fireEvent.click(screen.getByTestId("confirm-order")); });
    expect(await screen.findByTestId("order-sent")).toHaveTextContent("Bought 0.10 EURUSD");
    expect((await venue.snapshot(account.accountId)).state.positions[0].trailingStop).toEqual({ pips: 30 });
    expect(within(screen.getByTestId("engine-positions")).getByText("trail 30p")).toBeInTheDocument();
  });

  it("closes only the losing positions after one confirmation", async () => {
    const { venue } = await setup(async (venue, feed) => {
      await venue.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 });
      await venue.place(account.accountId, { symbol: "GBPUSD", side: "buy", type: "market", lots: 0.5 });
      feed.push(q("EURUSD", 1.0821, 1.0822, Date.now()));
      feed.push(q("GBPUSD", 1.249, 1.2491, Date.now()));
    });
    const bar = await screen.findByTestId("bulk-close");
    await waitFor(() => expect(within(bar).getByRole("button", { name: "Close losing (1)" })).toBeEnabled());
    expect(within(bar).getByRole("button", { name: "Close all (2)" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Close winning (1)" })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Close losing (1)" }));
    const review = screen.getByTestId("bulk-close-review");
    expect(review).toHaveTextContent("Close losing: 1 position (GBPUSD)");
    expect(review).toHaveTextContent("-$55.00");
    await act(async () => { fireEvent.click(within(review).getByTestId("bulk-close-confirm")); });
    expect(await screen.findByTestId("bulk-close-result")).toHaveTextContent("Closed 1 position, net -$58.50."); // −$55 and $1.75 commission each side
    const left = (await venue.snapshot(account.accountId)).state.positions;
    expect(left.map(p => p.symbol)).toEqual(["EURUSD"]);
  });
});

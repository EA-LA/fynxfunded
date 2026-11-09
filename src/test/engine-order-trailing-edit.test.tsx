import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modifyOrder, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import type { Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { orderChange } from "@/trade-access/protection";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });
const market = ctx([q("EURUSD", 1.08, 1.0801)]);
const limitWith = (trailingPips?: number) => placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, stopLoss: 1.077, ...(trailingPips !== undefined ? { trailingPips } : {}) }, market).state;

describe("engine: change the trailing stop of a pending order", () => {
  it("adds, changes and removes it, keeping everything else", () => {
    const start = limitWith(), id = start.orders[0].id;
    const added = modifyOrder(start, id, { trailingPips: 20 }, market);
    expect(added.state.orders[0]).toMatchObject({ id, price: 1.079, stopLoss: 1.077, trailingPips: 20 });
    expect(added.events).toEqual([{ type: "order_modified", order: added.state.orders[0] }]);
    expect(added.state.sequence).toBe(start.sequence + 1);
    const changed = modifyOrder(added.state, id, { trailingPips: 12.5 }, market).state;
    expect(changed.orders[0].trailingPips).toBe(12.5);
    const kept = modifyOrder(changed, id, { price: 1.0785 }, market).state; // leaving it out keeps it
    expect(kept.orders[0]).toMatchObject({ price: 1.0785, trailingPips: 12.5 });
    const removed = modifyOrder(kept, id, { trailingPips: null }, market).state;
    expect("trailingPips" in removed.orders[0]).toBe(false);
    expect(added.state.orders[0].trailingPips).toBe(20); // input untouched
  });

  it("changes nothing when the distance is the same, and refuses the same values as a new order", () => {
    const state = limitWith(20), id = state.orders[0].id;
    const same = modifyOrder(state, id, { trailingPips: 20 }, market);
    expect(same.state).toBe(state);
    expect(same.events).toEqual([]);
    const plain = limitWith();
    expect(modifyOrder(plain, plain.orders[0].id, { trailingPips: null }, market).events).toEqual([]);
    expect(() => modifyOrder(state, id, { trailingPips: 4.9 }, market)).toThrow(/between 5 and 5000 pips/);
    expect(() => modifyOrder(state, id, { trailingPips: 5001 }, market)).toThrow(/between 5 and 5000 pips/);
    expect(() => modifyOrder(state, id, { trailingPips: 10.25 }, market)).toThrow(/steps of 0.1 pips/);
    expect(() => modifyOrder(state, id, { trailingPips: Number.NaN }, market)).toThrow(/between 5 and 5000 pips/);
  });

  it("gives the filled position the new distance, or none after removal", () => {
    const state = limitWith(30), id = state.orders[0].id;
    const fillAt = (s: typeof state) => tick(s, ctx([q("EURUSD", 1.0789, 1.079, T0 + 1000)], T0 + 1000)).state.positions[0];
    expect(fillAt(modifyOrder(state, id, { trailingPips: 15 }, market).state).trailingStop).toEqual({ pips: 15 });
    expect(fillAt(modifyOrder(state, id, { trailingPips: null }, market).state).trailingStop).toBeUndefined();
  });

  it("goes through the HTTP contract (PATCH orders) and HttpGateway", async () => {
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
    const placed = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, trailingPips: 20, clientId: "k1" });
    const id = placed.state.orders[0].id;
    expect((await gw.modifyOrder("acc_1", id, { trailingPips: 35 })).state.orders[0].trailingPips).toBe(35);
    expect((await gw.modifyOrder("acc_1", id, { trailingPips: null })).state.orders[0].trailingPips).toBeUndefined();
    await expect(gw.modifyOrder("acc_1", id, { trailingPips: 2 })).rejects.toMatchObject({ code: "bad_trailing" });
    const wrongType = await handleEngineRequest({ method: "PATCH", path: `/v1/accounts/acc_1/orders/${id}`, headers: { authorization: "Bearer good" }, body: { trailingPips: "20" } }, opts);
    expect(wrongType.status).toBe(400);
    // Trading switched off: the change is refused like any other order change
    const off = await handleEngineRequest({ method: "PATCH", path: `/v1/accounts/acc_1/orders/${id}`, headers: { authorization: "Bearer good" }, body: { trailingPips: 20 } }, { ...opts, tradingEnabled: async () => false });
    expect(off.status).toBeGreaterThanOrEqual(400);
    expect((await venue.snapshot("acc_1")).state.orders[0].trailingPips).toBeUndefined();
  });

  it("terminal helper sends trailingPips only when it changes", () => {
    const o = { price: 1.079, stopLoss: 1.077, trailingPips: 20 };
    expect(orderChange(o, { price: 1.079, stopLoss: 1.077, takeProfit: null, trailingPips: 20 })).toEqual({});
    expect(orderChange(o, { price: 1.079, stopLoss: 1.077, takeProfit: null, trailingPips: 25 })).toEqual({ trailingPips: 25 });
    expect(orderChange(o, { price: 1.079, stopLoss: 1.077, takeProfit: null, trailingPips: null })).toEqual({ trailingPips: null });
    expect(orderChange(o, { price: 1.079, stopLoss: 1.077, takeProfit: null })).toEqual({}); // not given: left alone
    expect(orderChange({ price: 1.079 }, { price: 1.079, stopLoss: null, takeProfit: null, trailingPips: null })).toEqual({});
  });
});

describe("terminal: Pending orders editor trailing stop", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup(trailingPips?: number) {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    await venue.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.5, price: 1.079, stopLoss: 1.077, ...(trailingPips !== undefined ? { trailingPips } : {}) });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Pending orders" }));
    const orders = await screen.findByTestId("engine-orders");
    fireEvent.click(await within(orders).findByRole("button", { name: /Edit price, stop loss, take profit, trailing stop or expiry of EURUSD order/ }));
    return { venue, editor: screen.getByTestId("order-editor") };
  }

  it("adds a trailing stop with a preview of where it starts, then saves it", async () => {
    const { venue, editor } = await setup();
    const note = within(editor).getByTestId("order-trailing-outcome");
    expect(note).toHaveTextContent("Off. With a distance");
    const save = within(editor).getByRole("button", { name: "Save order" });
    expect(save).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("Trailing stop after the fill (pips)"), { target: { value: "3" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("Trailing stop must be between 5 and 5000 pips.");
    expect(save).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: "30 pips" }));
    expect(note).toHaveTextContent("the position gets a 30-pip trailing stop");
    expect(note).toHaveTextContent("reaches about 1.08200 (30 pips in profit from 1.07900)");
    expect(note).toHaveTextContent("Until then the stop loss above applies.");
    await waitFor(() => expect(save).toBeEnabled());
    await act(async () => { fireEvent.click(save); });
    expect(await screen.findByText(/trailing stop 30 pips\./)).toBeInTheDocument();
    expect((await venue.snapshot(account.accountId)).state.orders[0].trailingPips).toBe(30);
    expect(within(screen.getByTestId("engine-orders")).getByText("trail 30p")).toBeInTheDocument();
  });

  it("switches off a trailing stop set at placement", async () => {
    const { venue, editor } = await setup(25);
    const input = within(editor).getByLabelText("Trailing stop after the fill (pips)");
    expect(input).toHaveValue("25");
    fireEvent.click(within(editor).getByRole("button", { name: "Trailing off" }));
    expect(within(editor).getByTestId("order-trailing-outcome")).toHaveTextContent("Saving switches off the 25-pip trailing stop set when you placed this order.");
    await act(async () => { fireEvent.click(within(editor).getByRole("button", { name: "Save order" })); });
    expect(await screen.findByText(/trailing stop off\./)).toBeInTheDocument();
    expect((await venue.snapshot(account.accountId)).state.orders[0].trailingPips).toBeUndefined();
    expect(within(screen.getByTestId("engine-orders")).queryByText(/trail \d+p/)).toBeNull();
  });
});

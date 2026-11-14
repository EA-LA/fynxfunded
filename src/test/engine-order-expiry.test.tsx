import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPIRED_ORDERS_KEPT, modifyOrder, newAccount, placeOrder, tick, tradingDayEnd, type EngineContext } from "@/engine/core";
import type { AccountState, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, parseOrderRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { orderChange } from "@/trade-access/protection";
import { choiceFor, expiryLabel, expiryValue, fromLocalInput, toLocalInput } from "@/trade-access/expiry";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const END_OF_DAY = Date.parse("2026-11-04T22:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });
const market = ctx([q("EURUSD", 1.08, 1.0801)]);
const limit = (expiresAt?: number, state: AccountState = newAccount("a", rules, T0)) =>
  placeOrder(state, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, ...(expiresAt !== undefined ? { expiresAt } : {}) }, market).state;

describe("engine: pending order expiry", () => {
  it("keeps the expiry on the order and refuses bad values", () => {
    const state = limit(T0 + HOUR);
    expect(state.orders[0].expiresAt).toBe(T0 + HOUR);
    expect("expiresAt" in limit().orders[0]).toBe(false); // good till cancelled
    const base = newAccount("a", rules, T0);
    const order = { symbol: "EURUSD", side: "buy" as const, type: "limit" as const, lots: 1, price: 1.079 };
    expect(() => placeOrder(base, { ...order, type: "market", price: undefined, expiresAt: T0 + HOUR }, market)).toThrow(/Only pending orders/);
    expect(() => placeOrder(base, { ...order, expiresAt: T0 + 59_000 }, market)).toThrow(/at least one minute/);
    expect(() => placeOrder(base, { ...order, expiresAt: T0 - HOUR }, market)).toThrow(/at least one minute/);
    expect(() => placeOrder(base, { ...order, expiresAt: T0 + 367 * DAY }, market)).toThrow(/366 days/);
    expect(() => placeOrder(base, { ...order, expiresAt: T0 + HOUR + 0.5 }, market)).toThrow(/whole milliseconds/);
    expect(() => placeOrder(base, { ...order, expiresAt: Number.NaN }, market)).toThrow(/whole milliseconds/);
    try { placeOrder(base, { ...order, expiresAt: T0 }, market); } catch (e) { expect((e as { code: string }).code).toBe("bad_expiry"); }
  });

  it("removes the order at its expiry time, before it could fill, and remembers it", () => {
    const state = limit(T0 + HOUR);
    const id = state.orders[0].id;
    // One minute before: the price reaches the limit, so it fills normally.
    expect(tick(state, ctx([q("EURUSD", 1.0789, 1.079, T0 + HOUR - MIN)], T0 + HOUR - MIN)).state.positions).toHaveLength(1);
    // At the expiry time the same price no longer fills it.
    const at = tick(state, ctx([q("EURUSD", 1.0789, 1.079, T0 + HOUR)], T0 + HOUR));
    expect(at.state.orders).toEqual([]);
    expect(at.state.positions).toEqual([]);
    expect(at.state.expiredOrders).toEqual([{ ...state.orders[0], expiresAt: T0 + HOUR, expiredAt: T0 + HOUR }]);
    expect(at.events).toEqual([{ type: "order_expired", order: at.state.expiredOrders![0] }]);
    expect(at.state.sequence).toBeGreaterThan(state.sequence);
    expect(at.state.balance).toBe(state.balance);
    expect(state.orders[0].id).toBe(id); // input untouched
  });

  it("expires by time alone: market closed, no price, stale price", () => {
    const state = limit(T0 + HOUR);
    const saturday = Date.parse("2026-11-07T12:00:00Z");
    expect(tick(state, ctx([], saturday)).state.orders).toEqual([]);
    expect(tick(state, ctx([q("EURUSD", 1.08, 1.0801, T0)], T0 + 2 * HOUR)).state.expiredOrders).toHaveLength(1);
    // Good-till-cancelled orders stay.
    expect(tick(limit(), ctx([], saturday)).state.orders).toHaveLength(1);
  });

  it("keeps only the newest expired orders, newest first", () => {
    let state = newAccount("a", rules, T0);
    for (let i = 0; i < EXPIRED_ORDERS_KEPT + 3; i++) state = limit(T0 + HOUR + i * MIN, state);
    const ids = state.orders.map(o => o.id);
    state = tick(state, ctx([], T0 + HOUR + 1 * MIN)).state; // first two expire
    expect(state.expiredOrders!.map(o => o.id)).toEqual([ids[1], ids[0]]);
    state = tick(state, ctx([], T0 + 2 * HOUR)).state;
    expect(state.orders).toEqual([]);
    expect(state.expiredOrders).toHaveLength(EXPIRED_ORDERS_KEPT);
    expect(state.expiredOrders![0].id).toBe(ids[ids.length - 1]);
  });

  it("modifyOrder sets, changes and removes the expiry", () => {
    const state = limit();
    const id = state.orders[0].id;
    const set = modifyOrder(state, id, { expiresAt: T0 + 2 * HOUR }, market);
    expect(set.state.orders[0].expiresAt).toBe(T0 + 2 * HOUR);
    expect(set.events).toEqual([{ type: "order_modified", order: set.state.orders[0] }]);
    const kept = modifyOrder(set.state, id, { price: 1.0785 }, market).state;
    expect(kept.orders[0]).toMatchObject({ price: 1.0785, expiresAt: T0 + 2 * HOUR });
    const same = modifyOrder(kept, id, { expiresAt: T0 + 2 * HOUR }, market);
    expect(same.state).toBe(kept);
    const removed = modifyOrder(kept, id, { expiresAt: null }, market).state;
    expect("expiresAt" in removed.orders[0]).toBe(false);
    expect(() => modifyOrder(state, id, { expiresAt: T0 + 30_000 }, market)).toThrow(/at least one minute/);
    expect(() => modifyOrder(state, id, { expiresAt: T0 + 400 * DAY }, market)).toThrow(/366 days/);
  });

  it("tradingDayEnd is the next daily reset", () => {
    expect(tradingDayEnd(T0, 22)).toBe(END_OF_DAY);
    expect(tradingDayEnd(Date.parse("2026-11-04T21:59:59Z"), 22)).toBe(END_OF_DAY);
    expect(tradingDayEnd(END_OF_DAY, 22)).toBe(END_OF_DAY + DAY);
    expect(tradingDayEnd(Date.parse("2026-11-04T23:30:00Z"), 22)).toBe(END_OF_DAY + DAY);
    expect(tradingDayEnd(T0, 0)).toBe(Date.parse("2026-11-05T00:00:00Z"));
  });

  it("goes through the HTTP contract and HttpGateway, and the venue expires it", async () => {
    let clock = T0;
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801));
    await venue.open("acc_1");
    const events: string[] = [];
    venue.onEvents((_id, evs) => events.push(...evs.map(e => e.type)));
    const opts: HostOptions = { venue, verifyToken: async (t: string) => (t === "good" ? "u1" : null), canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "good", fetcher);
    const placed = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, expiresAt: T0 + HOUR, clientId: "k1" });
    const id = placed.state.orders[0].id;
    expect(placed.state.orders[0].expiresAt).toBe(T0 + HOUR);
    expect((await gw.modifyOrder("acc_1", id, { expiresAt: null })).state.orders[0].expiresAt).toBeUndefined();
    expect((await gw.modifyOrder("acc_1", id, { expiresAt: T0 + 2 * HOUR })).state.orders[0].expiresAt).toBe(T0 + 2 * HOUR);
    await expect(gw.modifyOrder("acc_1", id, { expiresAt: T0 })).rejects.toMatchObject({ code: "bad_expiry" });
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, expiresAt: T0 + HOUR })).rejects.toMatchObject({ code: "bad_expiry" });
    const wrongType = await handleEngineRequest({ method: "PATCH", path: `/v1/accounts/acc_1/orders/${id}`, headers: { authorization: "Bearer good" }, body: { expiresAt: "tomorrow" } }, opts);
    expect(wrongType.status).toBe(400);
    expect(() => parseOrderRequest({ symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, expiresAt: "1" })).toThrow(/expiresAt must be a number/);
    // Position PATCH does not take an expiry.
    const posPatch = await handleEngineRequest({ method: "PATCH", path: "/v1/accounts/acc_1/positions/pos1", headers: { authorization: "Bearer good" }, body: { expiresAt: T0 + HOUR } }, opts);
    expect(posPatch.status).toBe(400);
    clock = T0 + 2 * HOUR;
    const after = await gw.snapshot("acc_1");
    expect(after.state.orders).toEqual([]);
    expect(after.state.expiredOrders?.[0]).toMatchObject({ id, expiresAt: T0 + 2 * HOUR, expiredAt: T0 + 2 * HOUR });
    expect(events).toContain("order_expired");
  });
});

describe("terminal expiry helpers", () => {
  it("works out the value for each choice with the engine's limits", () => {
    expect(expiryValue("gtc", "", T0)).toEqual({ ok: true, value: null });
    expect(expiryValue("today", "", T0)).toEqual({ ok: true, value: END_OF_DAY });
    expect(expiryValue("today", "", END_OF_DAY - 30_000)).toMatchObject({ ok: false, error: expect.stringMatching(/less than a minute/) });
    const local = toLocalInput(T0 + DAY);
    expect(fromLocalInput(local)).toBe(T0 + DAY);
    expect(expiryValue("date", local, T0)).toEqual({ ok: true, value: T0 + DAY });
    expect(expiryValue("date", "", T0)).toMatchObject({ ok: false, error: "Expiry: pick a date and a time." });
    expect(fromLocalInput("2026-02-31T10:00")).toBeNull();
    expect(fromLocalInput("tomorrow")).toBeNull();
    expect(expiryValue("date", toLocalInput(T0), T0)).toMatchObject({ ok: false, error: expect.stringMatching(/one minute/) });
    expect(expiryValue("date", toLocalInput(T0 + 400 * DAY), T0)).toMatchObject({ ok: false, error: expect.stringMatching(/366 days/) });
    expect(choiceFor(undefined, T0)).toBe("gtc");
    expect(choiceFor(END_OF_DAY, T0)).toBe("today");
    expect(choiceFor(T0 + DAY, T0)).toBe("date");
    expect(expiryLabel(undefined, T0)).toBe("Good till cancelled");
    expect(expiryLabel(T0 + 90 * MIN, T0)).toMatch(/\(in 1h 30m\)$/);
  });

  it("orderChange sends expiresAt only when it changes", () => {
    const o = { price: 1.079, expiresAt: T0 + HOUR };
    expect(orderChange(o, { price: 1.079, stopLoss: null, takeProfit: null, expiresAt: T0 + HOUR })).toEqual({});
    expect(orderChange(o, { price: 1.079, stopLoss: null, takeProfit: null, expiresAt: null })).toEqual({ expiresAt: null });
    expect(orderChange({ price: 1.079 }, { price: 1.079, stopLoss: null, takeProfit: null, expiresAt: T0 + HOUR })).toEqual({ expiresAt: T0 + HOUR });
    expect(orderChange({ price: 1.079 }, { price: 1.079, stopLoss: null, takeProfit: null, expiresAt: null })).toEqual({});
  });
});

describe("terminal: pending order expiry", () => {
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
    await venue.open(account.accountId);
    await before?.(venue, feed);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    return { venue, feed };
  }

  it("places a limit order that expires at the end of today's trading day", async () => {
    const { venue } = await setup();
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    expect(within(ticket).queryByLabelText("Expiry")).toBeNull(); // market orders have no expiry
    fireEvent.change(within(ticket).getByLabelText("Order type"), { target: { value: "limit" } });
    fireEvent.change(within(ticket).getByLabelText("Limit price"), { target: { value: "1.07900" } });
    expect(within(ticket).getByTestId("ticket-expiry-help")).toHaveTextContent("Stays until it fills or you cancel it.");
    fireEvent.change(within(ticket).getByLabelText("Expiry"), { target: { value: "date" } });
    fireEvent.change(within(ticket).getByLabelText("Expiry date and time (your time)"), { target: { value: toLocalInput(T0) } });
    expect(within(ticket).getByTestId("ticket-expiry-help")).toHaveTextContent("Expiry: pick a time at least one minute from now.");
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(screen.getByTestId("confirm-order")).toBeDisabled();
    fireEvent.change(within(ticket).getByLabelText("Expiry"), { target: { value: "today" } });
    expect(within(ticket).getByTestId("ticket-expiry-help")).toHaveTextContent("(in 12h 00m), the trading server cancels it, even with this page closed.");
    expect(screen.getByTestId("order-review")).toHaveTextContent("expires");
    await waitFor(() => expect(screen.getByTestId("confirm-order")).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByTestId("confirm-order")); });
    expect(await screen.findByTestId("order-sent")).toHaveTextContent("limit order placed, expires");
    const order = (await venue.snapshot(account.accountId)).state.orders[0];
    expect(order.expiresAt).toBe(END_OF_DAY);
    fireEvent.click(screen.getByRole("tab", { name: "Pending orders" }));
    expect(await screen.findByTestId(`expires-${order.id}`)).toHaveTextContent("in 12h 00m");
  });

  it("makes an expiring order good till cancelled from the editor", async () => {
    const { venue } = await setup(async v => { await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.5, price: 1.079, expiresAt: T0 + 3 * HOUR }); });
    fireEvent.click(await screen.findByRole("tab", { name: "Pending orders" }));
    const orders = await screen.findByTestId("engine-orders");
    fireEvent.click(await within(orders).findByRole("button", { name: /Edit price, stop loss, take profit, trailing stop or expiry of EURUSD order/ }));
    const editor = screen.getByTestId("order-editor");
    expect(within(editor).getByLabelText("Expiry")).toHaveValue("date");
    expect(within(editor).getByLabelText("Expiry date and time (your time)")).toHaveValue(toLocalInput(T0 + 3 * HOUR));
    const save = within(editor).getByRole("button", { name: "Save order" });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(within(editor).getByLabelText("Expiry"), { target: { value: "gtc" } });
    await waitFor(() => expect(save).toBeEnabled());
    await act(async () => { fireEvent.click(save); });
    expect(await screen.findByText(/good till cancelled, trailing stop off\./)).toBeInTheDocument();
    const order = (await venue.snapshot(account.accountId)).state.orders[0];
    expect(order.expiresAt).toBeUndefined();
    expect(screen.getByTestId(`expires-${order.id}`)).toHaveTextContent("GTC");
  });

  it("lists orders the server cancelled at their expiry", async () => {
    await setup(async (v, feed) => {
      await v.place(account.accountId, { symbol: "EURUSD", side: "sell", type: "limit", lots: 0.2, price: 1.081, expiresAt: T0 + 2 * MIN });
      vi.setSystemTime(new Date(T0 + 5 * MIN));
      feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    });
    fireEvent.click(await screen.findByRole("tab", { name: "Pending orders" }));
    const expired = await screen.findByTestId("expired-orders");
    expect(expired).toHaveTextContent("Expired orders");
    expect(expired).toHaveTextContent("EURUSD sell limit 0.20 at 1.08100");
    expect(expired).toHaveTextContent("Nothing was bought or sold");
    expect(within(screen.getByTestId("engine-orders")).getByText(/No pending orders/)).toBeInTheDocument();
  });
});

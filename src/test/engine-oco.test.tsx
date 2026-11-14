import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelOrder, modifyOrder, newAccount, OCO_CANCELLED_KEPT, placeOrder, tick, type EngineContext } from "@/engine/core";
import type { AccountState, OrderRequest, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, parseOrderRequest, type HostOptions } from "@/engine/host";
import { noticesFor } from "@/engine/notifier";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { bracketHint, chosenLink, linkCandidates, linkChange, orderLabel } from "@/trade-access/oco";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const MIN = 60_000, HOUR = 3_600_000;
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });
const market = ctx([q("EURUSD", 1.08, 1.0801), q("GBPUSD", 1.27, 1.2701)]);
const buyStop: OrderRequest = { symbol: "EURUSD", side: "buy", type: "stop", lots: 1, price: 1.082 };
const sellStop: OrderRequest = { symbol: "EURUSD", side: "sell", type: "stop", lots: 1, price: 1.078 };

/** A breakout bracket: buy stop above, sell stop below, linked. */
function bracket(state: AccountState = newAccount("a", rules, T0)) {
  const first = placeOrder(state, buyStop, market).state;
  const a = first.orders[first.orders.length - 1].id;
  const second = placeOrder(first, { ...sellStop, ocoWith: a }, market);
  const b = second.state.orders[second.state.orders.length - 1].id;
  return { state: second.state, events: second.events, a, b };
}

describe("engine: one cancels the other (OCO)", () => {
  it("links both orders to each other when the second is placed", () => {
    const { state, events, a, b } = bracket();
    expect(state.orders.map(o => [o.id, o.ocoWith])).toEqual([[a, b], [b, a]]);
    expect(events.map(e => e.type)).toEqual(["order_placed", "order_modified"]);
    expect(events[1]).toEqual({ type: "order_modified", order: state.orders[0] });
  });

  it("refuses links that cannot work", () => {
    const base = placeOrder(newAccount("a", rules, T0), buyStop, market).state;
    const a = base.orders[0].id;
    const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as { code: string }).code; } return "none"; };
    expect(() => placeOrder(base, { symbol: "EURUSD", side: "sell", type: "market", lots: 1, ocoWith: a }, market)).toThrow(/Only pending orders can be linked/);
    expect(() => placeOrder(base, { ...sellStop, ocoWith: "ord_missing" }, market)).toThrow(/no longer pending/);
    expect(code(() => placeOrder(base, { ...sellStop, ocoWith: "" }, market))).toBe("bad_oco");
    const { state, a: x } = bracket();
    expect(() => placeOrder(state, { ...sellStop, price: 1.077, ocoWith: x }, market)).toThrow(/already linked with order/);
    expect(() => modifyOrder(state, x, { ocoWith: x }, market)).toThrow(/cannot be linked with itself/);
    // A refused link changes nothing.
    expect(code(() => placeOrder(base, { ...sellStop, ocoWith: "nope" }, market))).toBe("bad_oco");
    expect(base.orders).toHaveLength(1);
  });

  it("cancels the other order in the same step when one fills", () => {
    const { state, a, b } = bracket();
    const at = T0 + MIN;
    const step = tick(state, ctx([q("EURUSD", 1.0821, 1.0822, at)], at));
    expect(step.state.positions).toHaveLength(1);
    expect(step.state.positions[0]).toMatchObject({ side: "buy", entryPrice: 1.0822 });
    expect(step.state.orders).toEqual([]);
    const cancelled = step.state.ocoCancelled![0];
    expect(cancelled).toMatchObject({ id: b, ocoWith: a, side: "sell", price: 1.078, cancelledAt: at, positionId: step.state.positions[0].id });
    expect(step.events.map(e => e.type)).toEqual(["position_opened", "order_triggered", "order_cancelled"]);
    expect(step.events[2]).toEqual({ type: "order_cancelled", orderId: b, reason: "oco", order: cancelled });
    expect(state.orders).toHaveLength(2); // input untouched
  });

  it("fills only one of two linked orders even when both are hit by the same price", () => {
    // Two buy limits on the same pair, both below the market; a drop reaches both.
    const first = placeOrder(newAccount("a", rules, T0), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079 }, market).state;
    const two = placeOrder(first, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.0785, ocoWith: first.orders[0].id }, market).state;
    const step = tick(two, ctx([q("EURUSD", 1.0779, 1.078, T0 + MIN)], T0 + MIN));
    expect(step.state.positions).toHaveLength(1);
    expect(step.state.orders).toEqual([]);
    expect(step.state.ocoCancelled).toHaveLength(1);
  });

  it("links across pairs too", () => {
    const first = placeOrder(newAccount("a", rules, T0), buyStop, market).state;
    const two = placeOrder(first, { symbol: "GBPUSD", side: "buy", type: "stop", lots: 1, price: 1.272, ocoWith: first.orders[0].id }, market).state;
    const step = tick(two, ctx([q("EURUSD", 1.08, 1.0801, T0 + MIN), q("GBPUSD", 1.2721, 1.2722, T0 + MIN)], T0 + MIN));
    expect(step.state.positions.map(p => p.symbol)).toEqual(["GBPUSD"]);
    expect(step.state.ocoCancelled![0].symbol).toBe("EURUSD");
  });

  it("keeps the other order pending (unlinked) when one is cancelled or expires", () => {
    const { state, a, b } = bracket();
    const c = cancelOrder(state, a);
    expect(c.state.orders.map(o => o.id)).toEqual([b]);
    expect("ocoWith" in c.state.orders[0]).toBe(false);
    expect(c.events).toEqual([{ type: "order_cancelled", orderId: a }, { type: "order_modified", order: c.state.orders[0] }]);

    const withExpiry = modifyOrder(state, a, { expiresAt: T0 + HOUR }, market).state;
    const expired = tick(withExpiry, ctx([q("EURUSD", 1.08, 1.0801, T0 + HOUR)], T0 + HOUR));
    expect(expired.state.orders.map(o => [o.id, o.ocoWith])).toEqual([[b, undefined]]);
    expect(expired.events.map(e => e.type)).toEqual(["order_expired", "order_modified"]);
    // The unlinked order now fills on its own without cancelling anything.
    const fill = tick(expired.state, ctx([q("EURUSD", 1.0779, 1.078, T0 + HOUR + MIN)], T0 + HOUR + MIN));
    expect(fill.state.positions).toHaveLength(1);
    expect(fill.state.ocoCancelled).toBeUndefined();
  });

  it("links, re-links and unlinks existing orders with modifyOrder", () => {
    let state = placeOrder(newAccount("a", rules, T0), buyStop, market).state;
    state = placeOrder(state, sellStop, market).state;
    state = placeOrder(state, { ...sellStop, price: 1.077 }, market).state;
    const [a, b, c] = state.orders.map(o => o.id);
    const linked = modifyOrder(state, a, { ocoWith: b }, market);
    expect(linked.state.orders.map(o => o.ocoWith)).toEqual([b, a, undefined]);
    expect(linked.events.map(e => e.type)).toEqual(["order_modified", "order_modified"]);
    expect(modifyOrder(linked.state, a, { ocoWith: b }, market).state).toBe(linked.state); // no change
    // Re-link a with c: b loses its link.
    const relinked = modifyOrder(linked.state, a, { ocoWith: c }, market).state;
    expect(relinked.orders.map(o => o.ocoWith)).toEqual([c, undefined, a]);
    // Linking from the other side of an existing pair is a no-op for the pair.
    expect(modifyOrder(relinked, c, { ocoWith: a }, market).state).toBe(relinked);
    // b cannot take a, which is linked with c.
    expect(() => modifyOrder(relinked, b, { ocoWith: a }, market)).toThrow(/already linked/);
    const unlinked = modifyOrder(relinked, c, { ocoWith: null }, market).state;
    expect(unlinked.orders.map(o => o.ocoWith)).toEqual([undefined, undefined, undefined]);
    // Other changes keep the link.
    const moved = modifyOrder(relinked, a, { price: 1.0825 }, market).state;
    expect(moved.orders[0]).toMatchObject({ price: 1.0825, ocoWith: c });
  });

  it("keeps only the newest OCO-cancelled orders, newest first", () => {
    let state = newAccount("a", rules, T0);
    const ids: string[] = [];
    for (let i = 0; i < OCO_CANCELLED_KEPT + 2; i++) {
      const b = bracket(state);
      ids.push(b.b);
      const at = T0 + (i + 1) * MIN;
      // Fill the buy stop, then close the position so margin stays free.
      state = tick(b.state, ctx([q("EURUSD", 1.0821, 1.0822, at)], at)).state;
      state = { ...state, positions: [] };
    }
    expect(state.ocoCancelled).toHaveLength(OCO_CANCELLED_KEPT);
    expect(state.ocoCancelled![0].id).toBe(ids[ids.length - 1]);
  });

  it("the fill email says which linked order was cancelled", () => {
    const { state } = bracket();
    const step = tick(state, ctx([q("EURUSD", 1.0821, 1.0822, T0 + MIN)], T0 + MIN));
    const fill = noticesFor("a", step.events, T0 + MIN).find(x => x.kind === "fill")!;
    expect(fill.text).toContain("Your linked order (sell stop 1.00 EURUSD at 1.07800) was cancelled, as you asked: one cancels the other.");
    // Without a link, no such line.
    const single = placeOrder(newAccount("a", rules, T0), buyStop, market).state;
    const plain = noticesFor("a", tick(single, ctx([q("EURUSD", 1.0821, 1.0822, T0 + MIN)], T0 + MIN)).events, T0 + MIN).find(x => x.kind === "fill")!;
    expect(plain.text).not.toContain("linked order");
  });

  it("goes through the HTTP contract and HttpGateway", async () => {
    let clock = T0;
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801));
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async (t: string) => (t === "good" ? "u1" : null), canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "good", fetcher);
    const a = (await gw.placeOrder("acc_1", { ...buyStop, clientId: "k1" })).state.orders[0].id;
    const two = await gw.placeOrder("acc_1", { ...sellStop, ocoWith: a, clientId: "k2" });
    const b = two.state.orders[1].id;
    expect(two.state.orders.map(o => o.ocoWith)).toEqual([b, a]);
    await expect(gw.placeOrder("acc_1", { ...sellStop, price: 1.077, ocoWith: a })).rejects.toMatchObject({ code: "bad_oco" });
    const refused = await handleEngineRequest({ method: "POST", path: "/v1/accounts/acc_1/orders", headers: { authorization: "Bearer good" }, body: { ...sellStop, ocoWith: a } }, opts);
    expect(refused.status).toBe(422);
    expect((await gw.modifyOrder("acc_1", a, { ocoWith: null })).state.orders.map(o => o.ocoWith)).toEqual([undefined, undefined]);
    expect((await gw.modifyOrder("acc_1", b, { ocoWith: a })).state.orders.map(o => o.ocoWith)).toEqual([b, a]);
    expect(() => parseOrderRequest({ ...sellStop, ocoWith: 12 })).toThrow(/ocoWith must be the id of a pending order/);
    expect(() => parseOrderRequest({ ...sellStop, ocoWith: "has space" })).toThrow(/ocoWith/);
    const bad = await handleEngineRequest({ method: "PATCH", path: `/v1/accounts/acc_1/orders/${a}`, headers: { authorization: "Bearer good" }, body: { ocoWith: ["x"] } }, opts);
    expect(bad.status).toBe(400);
    // Positions do not take a link.
    const pos = await handleEngineRequest({ method: "PATCH", path: "/v1/accounts/acc_1/positions/pos1", headers: { authorization: "Bearer good" }, body: { ocoWith: a } }, opts);
    expect(pos.status).toBe(400);
    clock = T0 + MIN;
    feed.push(q("EURUSD", 1.0779, 1.078, clock));
    const after = await gw.snapshot("acc_1");
    expect(after.state.positions.map(p => p.side)).toEqual(["sell"]);
    expect(after.state.orders).toEqual([]);
    expect(after.state.ocoCancelled?.[0]).toMatchObject({ id: a, ocoWith: b });
  });
});

describe("terminal OCO helpers", () => {
  const o = (id: string, ocoWith?: string) => ({ id, symbol: "EURUSD", side: "buy" as const, type: "stop" as const, lots: 0.5, price: 1.082, createdAt: T0, ...(ocoWith ? { ocoWith } : {}) });
  it("lists the orders that can be linked and keeps a choice only while it is allowed", () => {
    const orders = [o("x"), o("y", "z"), o("z", "y"), o("w")];
    expect(linkCandidates(orders).map(x => x.id)).toEqual(["x", "w"]);
    expect(linkCandidates(orders, "x").map(x => x.id)).toEqual(["w"]);
    expect(linkCandidates(orders, "y").map(x => x.id)).toEqual(["x", "z", "w"]);
    expect(chosenLink("w", orders)).toBe("w");
    expect(chosenLink("y", orders)).toBe("");
    expect(chosenLink("gone", orders)).toBe("");
    expect(orderLabel(o("x"))).toBe("Buy stop 0.50 EURUSD at 1.08200 · x");
    expect(linkChange(undefined, "")).toEqual({});
    expect(linkChange("x", "x")).toEqual({});
    expect(linkChange(undefined, "x")).toEqual({ ocoWith: "x" });
    expect(linkChange("x", "")).toEqual({ ocoWith: null });
  });
  it("names breakout and range set-ups", () => {
    expect(bracketHint({ symbol: "EURUSD", side: "sell", type: "stop", price: 1.078 }, { symbol: "EURUSD", side: "buy", type: "stop", price: 1.082 })).toMatch(/^Breakout set-up/);
    expect(bracketHint({ symbol: "EURUSD", side: "sell", type: "limit", price: 1.082 }, { symbol: "EURUSD", side: "buy", type: "limit", price: 1.078 })).toMatch(/^Range set-up/);
    expect(bracketHint({ symbol: "EURUSD", side: "buy", type: "stop", price: 1.078 }, { symbol: "EURUSD", side: "buy", type: "stop", price: 1.082 })).toBeNull();
    expect(bracketHint({ symbol: "GBPUSD", side: "sell", type: "stop", price: 1.26 }, { symbol: "EURUSD", side: "buy", type: "stop", price: 1.082 })).toBeNull();
  });
});

describe("terminal: one cancels the other", () => {
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

  it("places a sell stop linked with an existing buy stop from the order ticket", async () => {
    let first = "";
    const { venue } = await setup(async v => { first = (await v.place(account.accountId, { ...buyStop, lots: 0.5 })).state.orders[0].id; });
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    expect(within(ticket).queryByLabelText("One cancels the other")).toBeNull(); // market orders cannot be linked
    fireEvent.change(within(ticket).getByLabelText("Order type"), { target: { value: "stop" } });
    fireEvent.change(within(ticket).getByLabelText("Stop price"), { target: { value: "1.07800" } });
    const select = await within(ticket).findByLabelText("One cancels the other");
    await waitFor(() => expect(within(select).getByRole("option", { name: `Link with Buy stop 0.50 EURUSD at 1.08200 · ${first}` })).toBeInTheDocument());
    expect(within(ticket).getByTestId("ticket-oco-help")).toHaveTextContent("Optional.");
    fireEvent.change(select, { target: { value: first } });
    fireEvent.click(within(ticket).getByTestId("sell-button"));
    expect(within(ticket).getByTestId("ticket-oco-help")).toHaveTextContent("Breakout set-up");
    expect(screen.getByTestId("review-oco")).toHaveTextContent(`Linked with Buy stop 0.50 EURUSD at 1.08200 · ${first}: if either fills, the other is cancelled.`);
    await waitFor(() => expect(screen.getByTestId("confirm-order")).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByTestId("confirm-order")); });
    expect(await screen.findByTestId("order-sent")).toHaveTextContent(`linked with order ${first}: one cancels the other`);
    const orders = (await venue.snapshot(account.accountId)).state.orders;
    expect(orders.map(o => o.ocoWith)).toEqual([orders[1].id, first]);
    fireEvent.click(screen.getByRole("tab", { name: "Pending orders" }));
    expect(await screen.findByTestId(`oco-${first}`)).toHaveTextContent(`OCO ${orders[1].id}`);
    expect(screen.getByTestId(`oco-${orders[1].id}`)).toHaveTextContent(`OCO ${first}`);
  });

  it("unlinks from the order editor and lists orders cancelled by a linked fill", async () => {
    const { venue, feed } = await setup(async v => {
      const a = (await v.place(account.accountId, buyStop)).state.orders[0].id;
      await v.place(account.accountId, { ...sellStop, ocoWith: a });
      await v.place(account.accountId, { ...buyStop, price: 1.083 });
      await v.place(account.accountId, { ...sellStop, price: 1.077 });
    });
    const [a, b, c, d] = (await venue.snapshot(account.accountId)).state.orders.map(o => o.id);
    fireEvent.click(await screen.findByRole("tab", { name: "Pending orders" }));
    const table = await screen.findByTestId("engine-orders");
    fireEvent.click(within(table).getByRole("button", { name: `Edit price, stop loss, take profit, trailing stop or expiry of EURUSD order ${c}` }));
    let editor = screen.getByTestId("order-editor");
    // a and b are linked with each other, so only d is offered for c.
    const opts = within(within(editor).getByLabelText("One cancels the other")).getAllByRole("option").map(x => x.textContent);
    expect(opts).toEqual(["Not linked", `Link with Sell stop 1.00 EURUSD at 1.07700 · ${d}`]);
    fireEvent.change(within(editor).getByLabelText("One cancels the other"), { target: { value: d } });
    await act(async () => { fireEvent.click(within(editor).getByRole("button", { name: "Save order" })); });
    expect(await screen.findByTestId("order-notice")).toHaveTextContent(`linked with order ${d} (one cancels the other).`);
    expect((await venue.snapshot(account.accountId)).state.orders.map(o => o.ocoWith)).toEqual([b, a, d, c]);
    // Unlink c and d again.
    fireEvent.click(within(table).getByRole("button", { name: `Edit price, stop loss, take profit, trailing stop or expiry of EURUSD order ${c}` }));
    editor = screen.getByTestId("order-editor");
    expect(within(editor).getByLabelText("One cancels the other")).toHaveValue(d);
    fireEvent.change(within(editor).getByLabelText("One cancels the other"), { target: { value: "" } });
    await act(async () => { fireEvent.click(within(editor).getByRole("button", { name: "Save order" })); });
    expect(await screen.findByTestId("order-notice")).toHaveTextContent(`no longer linked with order ${d}.`);
    // The price breaks up through 1.0820: a fills, b is cancelled; c and d stay.
    await act(async () => { vi.setSystemTime(new Date(T0 + MIN)); feed.push(q("EURUSD", 1.0821, 1.0822, Date.now())); await venue.snapshot(account.accountId); });
    const cancelled = await screen.findByTestId("oco-cancelled", {}, { timeout: 4000 });
    expect(cancelled).toHaveTextContent("Cancelled by a linked order");
    expect(cancelled).toHaveTextContent(`EURUSD sell stop 1.00 at 1.07800`);
    expect(cancelled).toHaveTextContent(`when order ${a} filled`);
    expect((await venue.snapshot(account.accountId)).state.orders.map(o => o.id)).toEqual([c, d]);
  });
});

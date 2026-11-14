import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adverseMovePips, DEVIATION_MAX_PIPS, newAccount, placeOrder, type EngineContext } from "@/engine/core";
import type { Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, parseOrderRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { parseDeviation } from "@/trade-access/protection";

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
const base = () => newAccount("a", rules, T0);
const buy = { symbol: "EURUSD", side: "buy" as const, type: "market" as const, lots: 1 };
const sell = { ...buy, side: "sell" as const };

describe("engine: price protection on market orders", () => {
  it("fills when the price moved less than allowed, the same, or in the trader's favour", () => {
    const now = ctx([q("EURUSD", 1.08, 1.08012)]); // ask 1.2 pips above what the trader saw
    expect(placeOrder(base(), { ...buy, expectedPrice: 1.08, maxDeviationPips: 1.2 }, now).state.positions[0].entryPrice).toBe(1.08012);
    expect(placeOrder(base(), { ...buy, expectedPrice: 1.0802, maxDeviationPips: 0 }, now).state.positions[0].entryPrice).toBe(1.08012); // better
    expect(placeOrder(base(), { ...sell, expectedPrice: 1.07995, maxDeviationPips: 0 }, now).state.positions[0].entryPrice).toBe(1.08); // better for a sell
    expect(placeOrder(base(), { ...sell, expectedPrice: 1.08, maxDeviationPips: 0 }, now).state.positions[0].entryPrice).toBe(1.08); // same
  });

  it("refuses a worse fill with price_moved and opens nothing", () => {
    const now = ctx([q("EURUSD", 1.08, 1.08013)]);
    const state = base();
    let err: unknown;
    try { placeOrder(state, { ...buy, expectedPrice: 1.08, maxDeviationPips: 1.2, clientId: "c1" }, now); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: "price_moved", message: "The EURUSD price moved 1.3 pips against you (from 1.08000 to 1.08013), more than the 1.2 pips you allowed. Nothing was opened." });
    expect(state.positions).toEqual([]);
    // Sell: the bid fell below what the trader saw.
    expect(() => placeOrder(state, { ...sell, expectedPrice: 1.0801, maxDeviationPips: 0.5 }, now)).toThrow(/moved 1.0 pips against you/);
    // The same clientId can be sent again (nothing was recorded) and fills within the limit.
    expect(placeOrder(state, { ...buy, expectedPrice: 1.08, maxDeviationPips: 2, clientId: "c1" }, now).state.positions).toHaveLength(1);
  });

  it("works out the move in pips for JPY pairs", () => {
    const jpy = specs.USDJPY;
    expect(adverseMovePips(jpy, "buy", 150.25, 150.284)).toBe(3.4);
    expect(adverseMovePips(jpy, "sell", 150.25, 150.284)).toBe(0);
    expect(adverseMovePips(jpy, "sell", 150.25, 150.2)).toBe(5);
    expect(adverseMovePips(specs.EURUSD, "buy", 1.08, 1.080001)).toBe(0.1); // a fraction of a tenth still counts against
  });

  it("refuses bad price protection values", () => {
    const now = ctx([q("EURUSD", 1.08, 1.0801)]);
    expect(() => placeOrder(base(), { ...buy, maxDeviationPips: 2 }, now)).toThrow(/needs both/);
    expect(() => placeOrder(base(), { ...buy, expectedPrice: 1.0801 }, now)).toThrow(/needs both/);
    expect(() => placeOrder(base(), { ...buy, expectedPrice: 1.0801, maxDeviationPips: -1 }, now)).toThrow(/between 0 and 500/);
    expect(() => placeOrder(base(), { ...buy, expectedPrice: 1.0801, maxDeviationPips: DEVIATION_MAX_PIPS + 1 }, now)).toThrow(/between 0 and 500/);
    expect(() => placeOrder(base(), { ...buy, expectedPrice: 1.0801, maxDeviationPips: 1.25 }, now)).toThrow(/steps of 0.1/);
    expect(() => placeOrder(base(), { ...buy, expectedPrice: 1.0801055, maxDeviationPips: 1 }, now)).toThrow(/Expected price must be in steps/);
    expect(() => placeOrder(base(), { ...buy, type: "limit", price: 1.079, expectedPrice: 1.079, maxDeviationPips: 1 }, now)).toThrow(/market orders only/);
    expect(() => placeOrder(base(), { ...buy, expectedPrice: 1.0801, maxDeviationPips: Number.NaN }, now)).toThrow(expect.objectContaining({ code: "bad_deviation" }));
  });

  it("goes through the HTTP contract and HttpGateway (409 price_moved)", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0803));
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async (t: string) => (t === "good" ? "u1" : null), canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const statuses: number[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      statuses.push(r.status);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "good", fetcher);
    await expect(gw.placeOrder("acc_1", { ...buy, expectedPrice: 1.0801, maxDeviationPips: 1, clientId: "k1" })).rejects.toMatchObject({ code: "price_moved", message: expect.stringMatching(/moved 2.0 pips against you/) });
    expect(statuses.at(-1)).toBe(409);
    expect((await gw.snapshot("acc_1")).state.positions).toEqual([]);
    const filled = await gw.placeOrder("acc_1", { ...buy, expectedPrice: 1.0801, maxDeviationPips: 2, clientId: "k1" });
    expect(filled.state.positions[0]).toMatchObject({ entryPrice: 1.0803, clientId: "k1" });
    expect(parseOrderRequest({ ...buy, expectedPrice: 1.08, maxDeviationPips: 0 })).toMatchObject({ expectedPrice: 1.08, maxDeviationPips: 0 });
    expect(() => parseOrderRequest({ ...buy, expectedPrice: "1.08", maxDeviationPips: 1 })).toThrow(/expectedPrice must be a number/);
    expect(() => parseOrderRequest({ ...buy, maxDeviation: 1 })).toThrow(/Unknown field: maxDeviation/);
  });
});

describe("terminal: price protection field", () => {
  it("reads the field", () => {
    expect(parseDeviation("")).toEqual({ ok: true, value: null });
    expect(parseDeviation("0")).toEqual({ ok: true, value: 0 });
    expect(parseDeviation("2,5")).toEqual({ ok: true, value: 2.5 });
    expect(parseDeviation("1.25")).toMatchObject({ ok: false });
    expect(parseDeviation("-1")).toMatchObject({ ok: false });
    expect(parseDeviation("501")).toMatchObject({ ok: false, error: "Price protection can be at most 500 pips." });
  });
});

describe("terminal: price protection in the order ticket", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup() {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    return { venue, feed };
  }

  it("sends the price shown and the allowed move, and shows the refusal when the price moved", async () => {
    const { venue } = await setup();
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    expect(within(ticket).getByTestId("ticket-deviation-help")).toHaveTextContent(/^Off: the order fills/);
    fireEvent.change(within(ticket).getByLabelText("Price protection (pips)"), { target: { value: "1.25" } });
    expect(within(ticket).getByTestId("ticket-deviation-help")).toHaveTextContent("type a number of pips");
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(screen.getByTestId("confirm-order")).toBeDisabled();
    fireEvent.click(within(ticket).getByRole("button", { name: "Price protection 3 pips" }));
    expect(within(ticket).getByTestId("ticket-deviation-help")).toHaveTextContent("no more than 3 pips (0.00030) against you");
    expect(screen.getByTestId("order-review")).toHaveTextContent("fills only within 3 pips of the price shown");
    expect(screen.getByTestId("review-protection")).toHaveTextContent("Price now 1.08010 (ask). Highest fill accepted: 1.08040");
    const spy = vi.spyOn(venue, "place");
    await act(async () => { fireEvent.click(screen.getByTestId("confirm-order")); });
    expect(await screen.findByTestId("order-sent")).toHaveTextContent("Bought 0.10 EURUSD.");
    expect(spy.mock.calls[0][1]).toMatchObject({ type: "market", expectedPrice: 1.0801, maxDeviationPips: 3 });
    // Pending orders do not carry it.
    fireEvent.change(within(ticket).getByLabelText("Order type"), { target: { value: "limit" } });
    expect(within(ticket).queryByLabelText("Price protection (pips)")).toBeNull();
  });

  it("shows the server's refusal when the price moved more than allowed", async () => {
    const { venue, feed } = await setup();
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    fireEvent.click(within(ticket).getByRole("button", { name: "Price protection 0 pips" }));
    fireEvent.click(within(ticket).getByTestId("sell-button"));
    expect(screen.getByTestId("order-review")).toHaveTextContent("fills only at the price shown or better");
    // The bid drops 2 pips while the order is on its way to the server.
    const place = venue.place.bind(venue);
    const spy = vi.spyOn(venue, "place").mockImplementation((id, req) => { feed.push(q("EURUSD", 1.0798, 1.0799, Date.now())); return place(id, req); });
    await act(async () => { fireEvent.click(screen.getByTestId("confirm-order")); });
    expect((await screen.findAllByText("The EURUSD price moved 2.0 pips against you (from 1.08000 to 1.07980), and you allowed no move against you. Nothing was opened."))[0]).toBeInTheDocument();
    expect(spy.mock.calls[0][1]).toMatchObject({ side: "sell", expectedPrice: 1.08, maxDeviationPips: 0 });
    expect((await venue.snapshot(account.accountId)).state.positions).toEqual([]);
  });
});

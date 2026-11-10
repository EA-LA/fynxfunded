import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marginUsd } from "@/engine/core";
import type { Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed, tradingConditions } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter, parseInstruments } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS, findPair } from "@/trade-access/instruments";
import { orderCosts, volumeProblem } from "@/trade-access/costs";
import { reasonLabel } from "@/trade-access/statement";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 20, swap: { EURUSD: { longPerLot: -6.2, shortPerLot: 1.1 } } });
const valid = { contractSize: 100000, minLots: 0.01, lotStep: 0.01, maxLots: 20, leverage: 30, commissionPerLotPerSide: 3.5, swap: null };

describe("trading conditions in /v1/status", () => {
  it("publishes leverage, lot limits, commission and swap per symbol from the venue settings", () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const all = venue.conditions();
    expect(Object.keys(all)).toHaveLength(FOREX_PAIRS.length);
    expect(all.EURUSD).toEqual({ ...valid, swap: { longPerLot: -6.2, shortPerLot: 1.1, tripleWeekday: 3 } });
    expect(all.USDJPY.swap).toBeNull();
    expect(venue.conditions(["EURUSD", "NOPE"])).toEqual({ EURUSD: all.EURUSD });
    expect(tradingConditions(specs.GBPUSD)).toEqual(valid);
  });

  it("is served by the host and read by HttpGateway; the local adapter has it too", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const opts: HostOptions = { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => false, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string> }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const status = await new HttpGateway("https://api.example.com", async () => "t", fetcher).status();
    expect(status.instruments?.EURUSD).toEqual(venue.conditions().EURUSD);
    expect(Object.keys(status.instruments ?? {})).toHaveLength(FOREX_PAIRS.length);
    expect((await new LocalGatewayAdapter(venue).status()).instruments?.USDJPY).toEqual(valid);
  });

  it("works with older servers that do not send it", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ priceFeed: true, execution: true, message: "ok" }), { status: 200 }));
    const status = await new HttpGateway("https://api.example.com", async () => "t", fetcher).status();
    expect(status.connected).toBe(true);
    expect(status.instruments).toBeUndefined();
  });

  it("drops malformed entries instead of trusting them", () => {
    expect(parseInstruments(null)).toBeUndefined();
    expect(parseInstruments([valid])).toBeUndefined();
    const parsed = parseInstruments({
      EURUSD: valid,
      eurusd: valid,
      GBPUSD: { ...valid, leverage: 0 },
      USDJPY: { ...valid, leverage: 30.5 },
      AUDUSD: { ...valid, commissionPerLotPerSide: -1 },
      NZDUSD: { ...valid, maxLots: 0.001, minLots: 0.01 },
      USDCAD: { ...valid, swap: { longPerLot: "x", shortPerLot: 1 } },
      USDCHF: { ...valid, swap: { longPerLot: -1, shortPerLot: 0.5, tripleWeekday: 9 } },
      EURGBP: { ...valid, swap: { longPerLot: -1, shortPerLot: 0.5 } },
      EURJPY: { ...valid, contractSize: "100000" },
    });
    expect(parsed).toEqual({ EURUSD: valid, EURGBP: { ...valid, swap: { longPerLot: -1, shortPerLot: 0.5, tripleWeekday: 3 } } });
    expect(parseInstruments({ GBPUSD: { ...valid, leverage: 0 } })).toBeUndefined();
  });
});

describe("order costs before sending", () => {
  const book = { EURUSD: q("EURUSD", 1.08, 1.0801), USDJPY: q("USDJPY", 149.99, 150.01) };
  it("gives nothing without the server's conditions (never guesses leverage or commission)", () => {
    const c = orderCosts({ pair: findPair("EURUSD")!, lots: 1, quotes: book, freeMargin: 10000 });
    expect(c).toMatchObject({ leverage: null, margin: null, commissionRoundTurn: null, swapBuy: null, notEnoughMargin: false, volumeProblem: null });
  });

  it("matches the engine's margin and charges commission on both sides", () => {
    const c = orderCosts({ pair: findPair("EURUSD")!, lots: 0.1, conditions: tradingConditions(specs.EURUSD), quotes: book, freeMargin: 10000 });
    expect(c.margin).toBe(marginUsd(specs.EURUSD, 0.1, book));
    expect(c).toMatchObject({ leverage: 30, margin: 360.02, marginSource: "server", freeMarginAfter: 9639.98, notEnoughMargin: false, commissionPerSide: 0.35, commissionRoundTurn: 0.7, swapBuy: -0.62, swapSell: 0.11, tripleWeekday: 3, swapNone: false });
  });

  it("needs no price when the base currency is the dollar, and a price otherwise", () => {
    const jpy = orderCosts({ pair: findPair("USDJPY")!, lots: 1, conditions: tradingConditions(specs.USDJPY) });
    expect(jpy).toMatchObject({ margin: 3333.33, marginSource: "contract", swapNone: true, swapBuy: null, freeMarginAfter: null });
    const gbp = orderCosts({ pair: findPair("GBPJPY")!, lots: 1, conditions: tradingConditions(specs.GBPJPY), quotes: book });
    expect(gbp.margin).toBeNull();
    expect(gbp.commissionRoundTurn).toBe(7);
  });

  it("flags orders the server would refuse for margin or volume", () => {
    const big = orderCosts({ pair: findPair("EURUSD")!, lots: 5, conditions: tradingConditions(specs.EURUSD), quotes: book, freeMargin: 10000 });
    expect(big).toMatchObject({ margin: 18000.83, notEnoughMargin: true, freeMarginAfter: -8000.83 });
    expect(orderCosts({ pair: findPair("EURUSD")!, lots: 25, conditions: tradingConditions(specs.EURUSD), quotes: book }).volumeProblem).toBe("The trading server accepts 0.01 to 20 lots for this pair.");
    expect(volumeProblem(0.15, { minLots: 0.1, maxLots: 10, lotStep: 0.1 })).toBe("The volume must be in steps of 0.1 lots.");
    expect(volumeProblem(0.3, { minLots: 0.1, maxLots: 10, lotStep: 0.1 })).toBeNull();
  });

  it("names close reasons in plain words", () => {
    expect(reasonLabel("manual")).toBe("Closed by you");
    expect(reasonLabel("stop_loss")).toBe("Stop loss");
    expect(reasonLabel("daily_loss_limit")).toBe("Daily loss limit");
    expect(reasonLabel("something_new")).toBe("something new");
  });
});

describe("order ticket shows margin, commission and swap", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup(withGateway = true) {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={withGateway ? <TradeAccess gateway={new LocalGatewayAdapter(venue)} /> : <TradeAccess />} /></Routes></MemoryRouter>);
    return venue;
  }

  it("says the figures come once trading is connected", async () => {
    await setup(false);
    const ticket = await screen.findByTestId("order-ticket");
    expect(within(ticket).getAllByText("Shown once trading is connected")).toHaveLength(4);
    expect(within(ticket).getByTestId("conditions-note")).toHaveTextContent("confirmed with the broker before launch");
  });

  it("uses the server's conditions and prices when connected", async () => {
    await setup();
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByText("$360.02 at the server’s price now")).toBeInTheDocument());
    expect(within(ticket).getByText("1:30")).toBeInTheDocument();
    expect(within(ticket).getByText("$9,639.98")).toBeInTheDocument();
    expect(within(ticket).getByText("$0.70 open + close ($3.50 per lot per side)")).toBeInTheDocument();
    expect(within(ticket).getByText("Buy -$0.62 · Sell $0.11 (×3 Wednesday)")).toBeInTheDocument();
    expect(within(ticket).getByTestId("conditions-note")).toHaveTextContent("the trading server’s own settings");
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(within(ticket).getByTestId("review-costs")).toHaveTextContent("Margin $360.02 · free margin after $9,639.98 · commission $0.70 round turn");
    expect(within(ticket).queryByTestId("margin-warning")).toBeNull();
  });

  it("warns before sending an order the server would refuse for margin, and the server does refuse it", async () => {
    const venue = await setup();
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByText("1:30")).toBeInTheDocument());
    fireEvent.change(within(ticket).getByLabelText("Volume (lots)"), { target: { value: "5" } });
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(within(ticket).getByTestId("margin-warning")).toHaveTextContent("this order needs $18,000.83 and the account has $10,000.00 free");
    await act(async () => { fireEvent.click(within(ticket).getByTestId("confirm-order")); });
    expect(await within(ticket).findByText(/Not enough free margin: this order needs 18000\.83 USD/)).toBeInTheDocument();
    expect((await venue.snapshot(account.accountId)).state.positions).toHaveLength(0);
  });

  it("flags a volume above the server's maximum", async () => {
    await setup();
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByText("1:30")).toBeInTheDocument());
    fireEvent.change(within(ticket).getByLabelText("Volume (lots)"), { target: { value: "30" } });
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(within(ticket).getByTestId("volume-warning")).toHaveTextContent("The trading server accepts 0.01 to 20 lots for this pair.");
  });
});

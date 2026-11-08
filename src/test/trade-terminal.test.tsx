import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOREX_PAIRS, calculatorKind, findPair, forexMarketOpen, normalizeLots, pipValueUsd, searchPairs } from "@/trade-access/instruments";
import { parsePips, rulesInDollars, ticketFigures } from "@/trade-access/ticket";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const account = {
  accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
  currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: false, tradingHoldReason: "Trading is not available yet.",
  rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
};

describe("forex catalogue", () => {
  it("lists majors, minors and exotics once each with the right pip size", () => {
    expect(FOREX_PAIRS.length).toBe(45);
    expect(new Set(FOREX_PAIRS.map(p => p.symbol)).size).toBe(45);
    expect(FOREX_PAIRS.filter(p => p.group === "Majors").map(p => p.symbol)).toEqual(["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"]);
    expect(findPair("usdjpy")).toMatchObject({ pipSize: 0.01, digits: 3, tvSymbol: "OANDA:USDJPY" });
    expect(findPair("EURHUF")?.pipSize).toBe(0.01);
    expect(findPair("GBPUSD")?.pipSize).toBe(0.0001);
    expect(findPair("XAUUSD")).toBeUndefined();
  });
  it("searches by symbol, slash form and currency name", () => {
    expect(searchPairs(FOREX_PAIRS, "gbp/jpy").map(p => p.symbol)).toEqual(["GBPJPY"]);
    expect(searchPairs(FOREX_PAIRS, "yen").every(p => p.symbol.includes("JPY"))).toBe(true);
    expect(searchPairs(FOREX_PAIRS, "rand").map(p => p.symbol)).toEqual(["USDZAR"]);
  });
  it("maps pairs to the lot size calculator", () => {
    expect(calculatorKind(findPair("EURUSD")!)).toEqual({ kind: "xxxusd" });
    expect(calculatorKind(findPair("USDJPY")!)).toEqual({ kind: "usdjpy" });
    expect(calculatorKind(findPair("USDCAD")!)).toEqual({ kind: "usdxxx" });
    expect(calculatorKind(findPair("GBPJPY")!)).toEqual({ kind: "cross", quote: "JPY" });
    expect(calculatorKind(findPair("EURTRY")!)).toEqual({ kind: "custom" });
  });
  it("gives a pip value only when the dollar is the second currency", () => {
    expect(pipValueUsd(findPair("EURUSD")!, 1)).toBe(10);
    expect(pipValueUsd(findPair("EURUSD")!, 0.1)).toBe(1);
    expect(pipValueUsd(findPair("USDJPY")!, 1)).toBeNull();
  });
  it("normalises volumes to 0.01 steps between 0.01 and 50", () => {
    expect(normalizeLots("0.155")).toBe(0.15);
    expect(normalizeLots("0,5")).toBe(0.5);
    expect(normalizeLots("500")).toBe(50);
    expect(normalizeLots("0.001")).toBe(0.01);
    expect(normalizeLots("abc")).toBeNull();
    expect(normalizeLots("-1")).toBeNull();
  });
  it("knows the usual forex week", () => {
    expect(forexMarketOpen(new Date("2026-11-07T12:00:00Z"))).toBe(false); // Saturday
    expect(forexMarketOpen(new Date("2026-11-08T21:30:00Z"))).toBe(false); // Sunday before 22:00 UTC (winter)
    expect(forexMarketOpen(new Date("2026-11-08T22:30:00Z"))).toBe(true);
    expect(forexMarketOpen(new Date("2026-11-06T21:30:00Z"))).toBe(true); // Friday before close (winter)
    expect(forexMarketOpen(new Date("2026-07-03T21:30:00Z"))).toBe(false); // Friday after 21:00 UTC in US summer
    expect(forexMarketOpen(new Date("2026-11-04T03:00:00Z"))).toBe(true);
  });
});

describe("order ticket figures", () => {
  it("prices risk and reward for dollar-quoted pairs", () => {
    const daily = rulesInDollars(10000, account.rules).dailyLossAmount;
    const f = ticketFigures({ pair: findPair("EURUSD")!, lots: 0.5, slPips: 20, tpPips: 40, balance: 10000, dailyLossAmount: daily });
    expect(f).toMatchObject({ units: 50000, pipValue: 5, risk: 100, reward: 200, riskPercent: 1, riskShareOfDaily: 20, rewardRatio: 2 });
  });
  it("leaves dollar figures out when they depend on a rate", () => {
    expect(ticketFigures({ pair: findPair("USDJPY")!, lots: 1, slPips: 20, tpPips: 30 })).toMatchObject({ pipValue: null, risk: null, reward: null, rewardRatio: 1.5 });
  });
  it("turns the purchased rules into dollars", () => {
    expect(rulesInDollars(10000, account.rules)).toEqual({ targetAmount: 800, targetBalance: 10800, dailyLossAmount: 500, maxLossAmount: 1000, maxLossFloor: 9000 });
    expect(rulesInDollars(0, account.rules).dailyLossAmount).toBeNull();
  });
  it("reads pip fields", () => {
    expect(parsePips("")).toBeNull();
    expect(parsePips("15.25")).toBe(15.3);
    expect(parsePips("0")).toBeNull();
  });
});

const renderTerminal = (path = "/trade") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/trade" element={<TradeAccess />} /></Routes></MemoryRouter>);

describe("FYNX Trade terminal", () => {
  beforeEach(() => {
    mocks.call.mockReset().mockImplementation(async (_name: string, data: { action: string }) => data.action === "list" ? { accounts: [account] } : account);
  });
  afterEach(cleanup);

  it("shows every pair, filters them and opens the pair from the address", async () => {
    renderTerminal("/trade?symbol=GBPJPY");
    expect(await screen.findByRole("heading", { level: 1, name: "GBP/JPY" })).toBeInTheDocument();
    const watch = screen.getByTestId("market-watch");
    expect(within(watch).getAllByRole("listitem")).toHaveLength(45);
    fireEvent.click(screen.getByRole("button", { name: "Exotics" }));
    expect(within(watch).getAllByRole("listitem")).toHaveLength(17);
    fireEvent.change(screen.getByLabelText("Search forex pairs"), { target: { value: "lira" } });
    expect(within(watch).getAllByRole("listitem").map(li => li.textContent)).toEqual([expect.stringContaining("USDTRY"), expect.stringContaining("EURTRY")]);
    fireEvent.click(within(watch).getByRole("button", { name: /^USDTRY/ }));
    expect(screen.getByRole("heading", { level: 1, name: "USD/TRY" })).toBeInTheDocument();
  });

  it("asks before loading live prices", async () => {
    renderTerminal();
    expect(await screen.findByRole("button", { name: "Show live prices" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show live prices" }));
    expect(screen.getAllByTestId("tv-widget").map(w => w.textContent)).toEqual(expect.arrayContaining(["EUR/USD chart", "EUR/USD live price", "Live forex ticker"]));
  });

  it("works out risk on the ticket and never sends an order while trading is off", async () => {
    renderTerminal();
    const ticket = await screen.findByTestId("order-ticket");
    await screen.findAllByText("$10,000.00");
    fireEvent.change(within(ticket).getByLabelText("Volume (lots)"), { target: { value: "1" } });
    fireEvent.change(within(ticket).getByLabelText("Stop loss (pips)"), { target: { value: "30" } });
    fireEvent.change(within(ticket).getByLabelText("Take profit (pips)"), { target: { value: "60" } });
    expect(within(ticket).getByText("$300.00 (3% of balance)")).toBeInTheDocument();
    expect(screen.getByTestId("daily-share")).toHaveTextContent("60% of your $500.00 daily loss allowance");
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(screen.getByTestId("order-review")).toHaveTextContent("Buy 1.00 EURUSD at market");
    expect(screen.getByTestId("order-review")).toHaveTextContent("This order was not sent.");
    expect(mocks.call.mock.calls.every(([, data]) => ["list", "open"].includes(data.action))).toBe(true);
  });

  it("shows the account and its rules in dollars", async () => {
    renderTerminal();
    fireEvent.click(await screen.findByRole("tab", { name: "Account" }));
    expect(await screen.findByTestId("trade-rules")).toHaveTextContent("+$800.00 (balance $10,800.00)");
    expect(screen.getByTestId("trade-rules")).toHaveTextContent("equity must not fall below $9,000.00");
  });
});

import { act, waitFor } from "@testing-library/react";
import { LocalVenue, MemoryStore, StaticQuoteFeed, buildSpecs } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { FOREX_HOURS } from "@/engine/hours";
import { archiveHistory } from "@/engine/core";

describe("terminal connected to the engine", () => {
  afterEach(cleanup);
  // A Wednesday: the forex market is open (the engine enforces Sunday 17:00 – Friday 17:00 New York).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("says the engine is not connected by default", async () => {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Engine not connected")).toBeInTheDocument();
  });

  it("places, shows and closes a trade through the gateway", async () => {
    const live = { ...account, tradingEnabled: true, tradingHoldReason: "" };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [live] } : live);
    const now = Date.now();
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), new MemoryStore(),
      async () => ({ startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now });
    await venue.open(live.accountId);
    const gateway = new LocalGatewayAdapter(venue);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={gateway} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    fireEvent.change(within(ticket).getByLabelText("Stop loss (pips)"), { target: { value: "20" } });
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    await act(async () => { fireEvent.click(screen.getByTestId("confirm-order")); });
    expect(await screen.findByTestId("order-sent")).toHaveTextContent("Bought 0.10 EURUSD");
    const positions = screen.getByTestId("engine-positions");
    expect(within(positions).getByText("1.07810")).toBeInTheDocument(); // stop 20 pips under the 1.08010 entry
    await act(async () => { fireEvent.click(within(positions).getByRole("button", { name: /Close EURUSD position/ })); });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(within(await screen.findByTestId("engine-history")).getByText("manual")).toBeInTheDocument();
  });

  it("edits stop loss and take profit, closes part of a position and shows target progress", async () => {
    const live = { ...account, tradingEnabled: true, tradingHoldReason: "" };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [live] } : live);
    const now = Date.now();
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), new MemoryStore(),
      async () => ({ startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22, consistencyPercent: 40 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now });
    await venue.open(live.accountId);
    await venue.place(live.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 });
    feed.push({ symbol: "EURUSD", bid: 1.0821, ask: 1.0822, time: now });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    const positions = await screen.findByTestId("engine-positions");
    fireEvent.click(await within(positions).findByRole("button", { name: /Edit stop loss, take profit or volume of EURUSD/ }));
    const editor = screen.getByTestId("position-editor");
    fireEvent.change(within(editor).getByLabelText("Stop loss (price)"), { target: { value: "1.0830" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("Stop loss must be below the current bid 1.08210");
    expect(within(editor).getByRole("button", { name: "Save levels" })).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: /Stop to break-even/ }));
    expect(within(editor).getByLabelText("Stop loss (price)")).toHaveValue("1.08010");
    fireEvent.change(within(editor).getByLabelText("Take profit (price)"), { target: { value: "1.0851" } });
    expect(within(editor).getByTestId("sl-outcome")).toHaveTextContent("If hit: $0.00 (0.0 pips)");
    expect(within(editor).getByTestId("tp-outcome")).toHaveTextContent("If hit: $500.00 (+50.0 pips)");
    await act(async () => { fireEvent.click(within(editor).getByRole("button", { name: "Save levels" })); });
    expect(await screen.findByTestId("position-notice")).toHaveTextContent("stop loss 1.08010, take profit 1.08510");
    const stored = (await venue.snapshot(live.accountId)).state.positions[0];
    expect(stored).toMatchObject({ stopLoss: 1.0801, takeProfit: 1.0851 });

    fireEvent.click(within(screen.getByTestId("engine-positions")).getByRole("button", { name: /Edit stop loss/ }));
    const again = screen.getByTestId("position-editor");
    fireEvent.change(within(again).getByLabelText("Lots to close"), { target: { value: "1" } });
    fireEvent.click(within(again).getByRole("button", { name: "Close part" }));
    expect(within(again).getByRole("alert")).toHaveTextContent("For the whole 1.00 lots use Close position.");
    fireEvent.change(within(again).getByLabelText("Lots to close"), { target: { value: "0.4" } });
    await act(async () => { fireEvent.click(within(again).getByRole("button", { name: "Close part" })); });
    expect(await screen.findByTestId("position-notice")).toHaveTextContent("Closed 0.40 of 1.00 lots EURUSD; 0.60 lots stay open.");
    expect((await venue.snapshot(live.accountId)).state.positions[0].lots).toBe(0.6);

    fireEvent.click(screen.getByRole("tab", { name: "Account" }));
    const progress = await screen.findByTestId("target-progress");
    expect(progress).toHaveTextContent("Trading days1 of 5");
    expect(progress).toHaveTextContent("Still needed:");
    expect(progress).toHaveTextContent("Close 1 open position.");
  });
});

describe("terminal: pending orders", () => {
  afterEach(cleanup);
  // A Wednesday: the forex market is open (the engine enforces Sunday 17:00 – Friday 17:00 New York).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("edits the price, stop loss and take profit of a pending order through the engine", async () => {
    const live = { ...account, tradingEnabled: true, tradingHoldReason: "" };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [live] } : live);
    const now = Date.now();
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), new MemoryStore(),
      async () => ({ startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now });
    await venue.open(live.accountId);
    await venue.place(live.accountId, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.079, stopLoss: 1.077 });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: "Pending orders" }));
    const orders = await screen.findByTestId("engine-orders");
    fireEvent.click(await within(orders).findByRole("button", { name: /Edit price, stop loss or take profit of EURUSD order/ }));
    const editor = screen.getByTestId("order-editor");
    expect(within(editor).getByTestId("order-distance")).toHaveTextContent("11.0 pips below the current ask 1.08010");
    expect(within(editor).getByTestId("order-sl-outcome")).toHaveTextContent("If hit after the fill: -$200.00 (-20.0 pips)");
    expect(within(editor).getByRole("button", { name: "Save order" })).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("Buy limit price"), { target: { value: "1.0810" } });
    expect(within(editor).getAllByRole("alert")[0]).toHaveTextContent("A buy limit must be below the current ask 1.08010");
    expect(within(editor).getByRole("button", { name: "Save order" })).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("Buy limit price"), { target: { value: "1.0785" } });
    fireEvent.change(within(editor).getByLabelText("Stop loss (price)"), { target: { value: "1.0790" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("Stop loss must be below the order price 1.07850.");
    fireEvent.change(within(editor).getByLabelText("Stop loss (price)"), { target: { value: "1.0765" } });
    fireEvent.change(within(editor).getByLabelText("Take profit (price)"), { target: { value: "1.0835" } });
    expect(within(editor).getByTestId("order-tp-outcome")).toHaveTextContent("If hit after the fill: $500.00 (+50.0 pips)");
    await act(async () => { fireEvent.click(within(editor).getByRole("button", { name: "Save order" })); });
    expect(await screen.findByTestId("order-notice")).toHaveTextContent("price 1.07850, stop loss 1.07650, take profit 1.08350");
    expect((await venue.snapshot(live.accountId)).state.orders[0]).toMatchObject({ price: 1.0785, stopLoss: 1.0765, takeProfit: 1.0835, lots: 1 });
    expect(within(screen.getByTestId("engine-orders")).getByText("1.08350")).toBeInTheDocument();
  });
});

describe("terminal: market hours", () => {
  afterEach(cleanup);
  afterEach(() => { vi.useRealTimers(); });
  it("on a Saturday shows when the market opens and sends nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const live = { ...account, tradingEnabled: true, tradingHoldReason: "" };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [live] } : live);
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), new MemoryStore(),
      async () => ({ startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: Date.now() });
    await venue.open(live.accountId);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    const ticket = screen.getByTestId("order-ticket");
    const note = within(ticket).getByTestId("market-closed");
    expect(note).toHaveTextContent("Forex market closed");
    expect(note).toHaveTextContent("Sun, 08 Nov 2026 22:00 UTC");
    expect(note).toHaveTextContent("in 1d 10h 00m");
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(screen.queryByTestId("confirm-order")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-review")).toHaveTextContent("The EURUSD market is closed. It opens");
    await expect(venue.place(live.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1 })).rejects.toMatchObject({ code: "market_closed" });
  });
});

describe("position protection helpers", () => {
  it("reads prices, checks sides and works out results", async () => {
    const { parseLevel, levelErrors, levelOutcome, protectionChange, parseCloseLots } = await import("@/trade-access/protection");
    expect(parseLevel("", 5, "Stop loss")).toEqual({ ok: true, value: null });
    expect(parseLevel("1,0805", 5, "Stop loss")).toEqual({ ok: true, value: 1.0805 });
    expect(parseLevel("1.080051", 5, "Stop loss")).toEqual({ ok: false, error: "Stop loss: use at most 5 decimals." });
    expect(parseLevel("abc", 3, "Take profit")).toMatchObject({ ok: false });
    expect(levelErrors("sell", 150.1, 150.0, null, 3)[0]).toMatch(/above the current ask 150.100/);
    expect(levelErrors("sell", 150.1, 150.5, 149.5, 3)).toEqual([]);
    const book = { USDJPY: { symbol: "USDJPY", bid: 150, ask: 150.02, time: 0 } };
    expect(levelOutcome(findPair("USDJPY")!, "sell", 1, 150.5, 150, book)).toEqual({ pips: 50, dollars: 333.31 });
    expect(levelOutcome(findPair("EURGBP")!, "buy", 1, 0.85, 0.851, {}).dollars).toBeNull();
    expect(protectionChange({ stopLoss: 1.07 }, { stopLoss: 1.07, takeProfit: null })).toEqual({});
    expect(protectionChange({ stopLoss: 1.07, takeProfit: 1.1 }, { stopLoss: null, takeProfit: 1.09 })).toEqual({ stopLoss: null, takeProfit: 1.09 });
    expect(parseCloseLots("0.255", 1)).toMatchObject({ ok: false, error: "Volume goes in steps of 0.01 lots." });
    expect(parseCloseLots("0.25", 1)).toEqual({ ok: true, value: 0.25 });
  });
});

describe("terminal: holiday closure from the trading server", () => {
  afterEach(cleanup);
  afterEach(() => { vi.useRealTimers(); });
  it("marks the closed pair in Market Watch and explains it in the editors before anything is sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    const live = { ...account, tradingEnabled: true, tradingHoldReason: "" };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [live] } : live);
    const closure = { from: Date.parse("2026-11-04T10:30:00Z"), to: Date.parse("2026-11-05T00:00:00Z"), reason: "Tokyo holiday" };
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, hoursBySymbol: { USDJPY: { ...FOREX_HOURS, closures: [closure] } } }), new MemoryStore(),
      async () => ({ startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "USDJPY", bid: 150, ask: 150.02, time: Date.now() });
    await venue.open(live.accountId);
    await venue.place(live.accountId, { symbol: "USDJPY", side: "buy", type: "market", lots: 0.5 });
    await venue.place(live.accountId, { symbol: "USDJPY", side: "buy", type: "limit", lots: 0.5, price: 149.5 });
    vi.setSystemTime(new Date("2026-11-04T11:00:00Z"));
    feed.push({ symbol: "USDJPY", bid: 150.1, ask: 150.12, time: Date.now() });
    render(<MemoryRouter initialEntries={["/trade?symbol=USDJPY"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    const watch = screen.getByTestId("market-watch");
    expect(await within(watch).findByTestId("closed-USDJPY")).toHaveTextContent("Tokyo holiday");
    expect(within(watch).queryByTestId("closed-EURUSD")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("order-ticket")).getByTestId("market-closed")).toHaveTextContent("USDJPY market closed · Tokyo holiday");

    const positions = await screen.findByTestId("engine-positions");
    expect(await within(positions).findByRole("button", { name: /Close USDJPY position .* \(market closed\)/ })).toBeDisabled();
    fireEvent.click(within(positions).getByRole("button", { name: /Edit stop loss, take profit or volume of USDJPY/ }));
    const editor = screen.getByTestId("position-editor");
    expect(within(editor).getByTestId("editor-market-closed")).toHaveTextContent("The USDJPY market is closed (Tokyo holiday). It opens");
    expect(within(editor).getByTestId("editor-market-closed")).toHaveTextContent("in 13h 00m");
    fireEvent.change(within(editor).getByLabelText("Stop loss (price)"), { target: { value: "149.800" } });
    expect(within(editor).getByRole("button", { name: "Save levels" })).toBeDisabled();
    expect(within(editor).getByRole("button", { name: "Close part" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "Pending orders" }));
    const orders = await screen.findByTestId("engine-orders");
    fireEvent.click(await within(orders).findByRole("button", { name: /Edit price, stop loss or take profit of USDJPY order/ }));
    const orderEditor = screen.getByTestId("order-editor");
    expect(within(orderEditor).getByTestId("editor-market-closed")).toHaveTextContent("Cancelling the order works at any time.");
    fireEvent.change(within(orderEditor).getByLabelText("Buy limit price"), { target: { value: "149.400" } });
    expect(within(orderEditor).getByRole("button", { name: "Save order" })).toBeDisabled();
    const cancel = within(orders).getByRole("button", { name: /Cancel USDJPY order/ });
    expect(cancel).toBeEnabled();
    await act(async () => { fireEvent.click(cancel); });
    expect((await venue.snapshot(live.accountId)).state.orders).toEqual([]);
    expect((await venue.snapshot(live.accountId)).state.positions[0].stopLoss).toBeUndefined();
  });
});


describe("terminal history with archived trades", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("says how many older trades are in the archive and their net result", async () => {
    const live = { ...account, tradingEnabled: true, tradingHoldReason: "" };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [live] } : live);
    const now = Date.now();
    const store = new MemoryStore();
    const rules = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 };
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), store, async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: now });
    await venue.open(live.accountId);
    for (let i = 0; i < 3; i++) {
      const s = await venue.place(live.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1 });
      await venue.close(live.accountId, s.state.positions[0].id);
    }
    const before = (await store.load(live.accountId))!;
    await store.save(archiveHistory(before, { keep: 1, resetHourUtc: 22 }).state, before.sequence);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    await screen.findByTestId("engine-positions");
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const history = await screen.findByTestId("engine-history");
    expect(within(history).getAllByText("manual")).toHaveLength(1);
    expect(within(history).getByTestId("history-archived")).toHaveTextContent(/Showing the latest 1 closed trade\. 2 older trades .*net -\$\d+\.\d{2}\) are kept in the account archive/);
  });
});

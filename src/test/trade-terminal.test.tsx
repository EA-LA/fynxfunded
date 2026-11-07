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

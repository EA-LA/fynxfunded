import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profitUsd } from "@/engine/core";
import type { Deal, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { FOREX_PAIRS, findPair } from "@/trade-access/instruments";
import { lotsForRisk, parseRisk, pipValuePerLot, riskWarnings } from "@/trade-access/sizing";
import { ticketFigures } from "@/trade-access/ticket";
import { STATEMENT_HEADERS, statementCsv, statementFileName, statementSummary } from "@/trade-access/statement";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
const book = (...qs: Quote[]) => Object.fromEntries(qs.map(x => [x.symbol, x]));
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });

describe("size by risk: pip values", () => {
  it("uses the contract for USD-quoted pairs and the server's prices for the rest", () => {
    expect(pipValuePerLot(findPair("EURUSD")!)).toEqual({ perLot: 10, source: "contract" });
    expect(pipValuePerLot(findPair("USDJPY")!)).toBeNull();
    expect(pipValuePerLot(findPair("USDJPY")!, {})).toBeNull();
    const jpy = pipValuePerLot(findPair("USDJPY")!, book(q("USDJPY", 149.99, 150.01)))!;
    expect(jpy.source).toBe("server");
    expect(jpy.perLot).toBeCloseTo(1000 / 150, 6);
    expect(jpy.via).toBe("USDJPY 150 (mid)");
    // EURGBP is converted with GBPUSD (direct), as the engine does.
    expect(pipValuePerLot(findPair("EURGBP")!, book(q("GBPUSD", 1.25, 1.25)))!.perLot).toBeCloseTo(12.5, 6);
    // No conversion price for the quote currency: nothing is guessed.
    expect(pipValuePerLot(findPair("EURGBP")!, book(q("EURUSD", 1.08, 1.0801)))).toBeNull();
  });

  it("matches the engine's own profit for one pip", () => {
    const quotes = book(q("USDJPY", 150, 150.02), q("GBPUSD", 1.27, 1.2702), q("AUDUSD", 0.65, 0.6501));
    for (const sym of ["USDJPY", "GBPJPY", "EURGBP", "EURUSD"]) {
      const pair = findPair(sym)!, pv = pipValuePerLot(pair, quotes)!;
      expect(pv.perLot).toBeCloseTo(profitUsd(specs[sym], "buy", 1, 1, 1 + pair.pipSize, quotes), 1);
    }
  });

  it("ticket figures give dollar risk for every pair once the server's prices are there", () => {
    const pair = findPair("USDJPY")!;
    expect(ticketFigures({ pair, lots: 1, slPips: 20, tpPips: 30 })).toMatchObject({ pipValue: null, pipSource: null, risk: null });
    const f = ticketFigures({ pair, lots: 1, slPips: 20, tpPips: 30, balance: 10000, quotes: book(q("USDJPY", 160, 160)) });
    expect(f).toMatchObject({ pipValue: 6.25, pipSource: "server", risk: 125, reward: 187.5, riskPercent: 1.25 });
    expect(ticketFigures({ pair: findPair("EURUSD")!, lots: 0.5, slPips: 20, tpPips: null })).toMatchObject({ pipValue: 5, pipSource: "contract", risk: 100 });
  });
});

describe("size by risk: reading the risk and working out lots", () => {
  it("reads percent and dollars", () => {
    expect(parseRisk("", "percent", 10000)).toEqual({ ok: true, usd: null });
    expect(parseRisk("0,5", "percent", 10000)).toEqual({ ok: true, usd: 50 });
    expect(parseRisk("1%", "percent", 25000)).toEqual({ ok: true, usd: 250 });
    expect(parseRisk("$75", "usd", 10000)).toEqual({ ok: true, usd: 75 });
    expect(parseRisk("abc", "percent", 10000)).toMatchObject({ ok: false });
    expect(parseRisk("0", "usd", 10000)).toMatchObject({ ok: false });
    expect(parseRisk("0.001", "percent", 10000)).toMatchObject({ ok: false, error: "The smallest risk is 0.01% of the balance." });
    expect(parseRisk("11", "percent", 10000)).toMatchObject({ ok: false, error: "Risk is limited to 10% of the balance per trade here." });
    expect(parseRisk("10001", "usd", 10000)).toMatchObject({ ok: false, error: expect.stringMatching(/more than the whole balance/) });
    expect(parseRisk("1", "percent", undefined)).toMatchObject({ ok: false, error: expect.stringMatching(/balance isn.t known/) });
  });

  it("rounds down to the 0.01 step so the stop never costs more than chosen", () => {
    expect(lotsForRisk(100, 20, 10)).toEqual({ lots: 0.5, riskAtLots: 100, minLotRisk: 2, capped: false });
    expect(lotsForRisk(100, 30, 10)).toEqual({ lots: 0.33, riskAtLots: 99, minLotRisk: 3, capped: false });
    expect(lotsForRisk(50, 17.5, 1000 / 150)).toMatchObject({ lots: 0.42 }); // 50 / (6.667 × 17.5) = 0.4286
    expect(lotsForRisk(1, 200, 10)).toEqual({ lots: null, riskAtLots: null, minLotRisk: 20, capped: false });
    expect(lotsForRisk(100000, 1, 10)).toMatchObject({ lots: 50, capped: true });
    expect(lotsForRisk(0, 20, 10)).toBeNull();
    expect(lotsForRisk(100, 0, 10)).toBeNull();
    // Floating-point edge: 0.29 lots exactly must not come out as 0.28.
    expect(lotsForRisk(58, 20, 10)!.lots).toBe(0.29);
  });

  it("warns against the room left before the loss limit", () => {
    expect(riskWarnings(100, { roomToFloor: 500 })).toEqual([]);
    expect(riskWarnings(300, { roomToFloor: 500 })).toEqual([{ level: "warn", text: "This uses 60% of the $500.00 left before your loss limit." }]);
    expect(riskWarnings(500, { roomToFloor: 500 })[0]).toMatchObject({ level: "stop", text: expect.stringMatching(/would reach your loss limit/) });
    expect(riskWarnings(600, { dailyLossAmount: 500 })[0]).toMatchObject({ level: "stop", text: expect.stringMatching(/whole daily loss allowance \(\$500.00\)/) });
    expect(riskWarnings(100, {})).toEqual([]);
  });
});

describe("size by risk in the order ticket", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 };
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
    feed.push(q("USDJPY", 149.99, 150.01, Date.now()));
    await venue.open(account.accountId);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={withGateway ? <TradeAccess gateway={new LocalGatewayAdapter(venue)} /> : <TradeAccess />} /></Routes></MemoryRouter>);
    if (withGateway) expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    return { venue };
  }

  it("works out the volume from a share of the balance and fills the volume field", async () => {
    const { venue } = await setup();
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    fireEvent.click(within(ticket).getByTestId("risk-size-open"));
    const box = within(ticket).getByTestId("risk-size");
    expect(box).toHaveTextContent("Type how much the stop loss may cost");
    fireEvent.click(within(box).getByRole("button", { name: "Risk 0.5% of the balance" }));
    expect(box).toHaveTextContent("Set a stop loss in pips below to size the trade for a $50.00 risk.");
    fireEvent.change(within(ticket).getByLabelText("Stop loss (pips)"), { target: { value: "15" } });
    expect(within(box).getByTestId("risk-size-result")).toHaveTextContent("0.33 lots · a 15-pip stop would cost $49.50 of the $50.00 you chose (0.5% of the balance).");
    fireEvent.click(within(box).getByTestId("risk-size-use"));
    expect(within(ticket).getByLabelText("Volume (lots)")).toHaveValue("0.33");
    expect(within(box).getByTestId("risk-size-use")).toHaveTextContent("Volume set to 0.33 lots");
    expect(ticket).toHaveTextContent("$49.50 (0.5% of balance)");
    // Nothing is sent from the sizing box.
    const spy = vi.spyOn(venue, "place");
    expect(spy).not.toHaveBeenCalled();
    // Dollars, too, with a warning when the risk reaches the loss limit ($1,000 of room on a fresh $10,000 account).
    fireEvent.click(within(box).getByRole("button", { name: "Dollars" }));
    fireEvent.change(within(box).getByLabelText("Risk (dollars)"), { target: { value: "1000" } });
    expect(within(box).getByTestId("risk-size-warning")).toHaveTextContent("would reach your loss limit");
    fireEvent.change(within(box).getByLabelText("Risk (dollars)"), { target: { value: "0.5" } });
    expect(box).toHaveTextContent("A 15-pip stop costs $1.50 even at the smallest volume (0.01 lots), more than $0.50.");
  });

  it("converts yen pairs with the trading server's price", async () => {
    await setup();
    fireEvent.click(screen.getAllByRole("button", { name: /^USDJPY/ })[0]);
    await waitFor(() => expect(within(screen.getByTestId("order-ticket")).getByText("USDJPY")).toBeInTheDocument());
    const ticket = screen.getByTestId("order-ticket");
    fireEvent.change(within(ticket).getByLabelText("Stop loss (pips)"), { target: { value: "20" } });
    fireEvent.click(within(ticket).getByTestId("risk-size-open"));
    const box = within(ticket).getByTestId("risk-size");
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Risk 1% of the balance" })); });
    // $100 / ($6.667 × 20) = 0.75 lots.
    expect(within(box).getByTestId("risk-size-result")).toHaveTextContent("0.75 lots · a 20-pip stop would cost $100.00 of the $100.00 you chose");
    expect(box).toHaveTextContent("$6.67 per pip on 1.00 lot, converted with USDJPY 150 (mid) from the trading server");
    expect(ticket).toHaveTextContent("per pip at the server’s price now");
  });

  it("says plainly that a yen pair needs the server's price when trading is not connected", async () => {
    await setup(false);
    fireEvent.click(screen.getAllByRole("button", { name: /^USDJPY/ })[0]);
    await waitFor(() => expect(within(screen.getByTestId("order-ticket")).getByText("USDJPY")).toBeInTheDocument());
    const ticket = screen.getByTestId("order-ticket");
    fireEvent.change(within(ticket).getByLabelText("Stop loss (pips)"), { target: { value: "20" } });
    fireEvent.click(within(ticket).getByTestId("risk-size-open"));
    const box = within(ticket).getByTestId("risk-size");
    fireEvent.click(within(box).getByRole("button", { name: "Risk 1% of the balance" }));
    await waitFor(() => expect(box).toHaveTextContent("worked out from the trading server's price once trading is connected"));
    expect(within(box).queryByTestId("risk-size-result")).toBeNull();
  });
});

describe("History tab statement", () => {
  const deal = (over: Partial<Deal>): Deal => ({ id: "d1", positionId: "p1", symbol: "EURUSD", side: "buy", lots: 0.5, entryPrice: 1.08, exitPrice: 1.081, openedAt: Date.parse("2026-11-03T09:00:00Z"), closedAt: Date.parse("2026-11-03T10:00:00Z"), grossProfit: 50, commission: 3.5, netProfit: 46.5, reason: "take_profit", ...over });
  const deals = [
    deal({}),
    deal({ id: "d2", positionId: "p2", symbol: "USDJPY", side: "sell", entryPrice: 150.1, exitPrice: 150.3, closedAt: Date.parse("2026-11-04T10:00:00Z"), grossProfit: -66.53, commission: 3.5, swap: -1.2, netProfit: -71.23, reason: "stop_loss", entryRisk: { stopLoss: 150.3, amount: 71.23, percent: 0.71, balance: 10046.5 } as Deal["entryRisk"] }),
    deal({ id: "d3", positionId: "p3", closedAt: Date.parse("2026-11-02T10:00:00Z"), grossProfit: 0, commission: 0, netProfit: 0, reason: "manual" }),
  ];

  it("adds up the trades on screen", () => {
    expect(statementSummary(deals)).toEqual({ trades: 3, wins: 1, losses: 1, winRate: 33.3, grossProfit: 46.5, grossLoss: -71.23, commission: 7, swap: -1.2, net: -24.73, profitFactor: 0.65, lots: 1.5, firstClosedAt: Date.parse("2026-11-02T10:00:00Z"), lastClosedAt: Date.parse("2026-11-04T10:00:00Z") });
    expect(statementSummary([])).toMatchObject({ trades: 0, winRate: null, profitFactor: null, firstClosedAt: null });
    expect(statementSummary([deals[0]]).profitFactor).toBeNull();
  });

  it("writes a CSV oldest first with prices at the pair's decimals, R and totals", () => {
    const csv = statementCsv("acc-1", deals);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(STATEMENT_HEADERS.map(h => `"${h}"`).join(","));
    expect(lines[1]).toMatch(/^"d3",/);
    expect(lines[2]).toBe('"d1","p1","EURUSD","buy",0.5,"2026-11-03T09:00:00Z","1.08000","2026-11-03T10:00:00Z","1.08100",50,-3.5,0,46.5,"","","Take profit"');
    expect(lines[3]).toBe('"d2","p2","USDJPY","sell",0.5,"2026-11-03T09:00:00Z","150.100","2026-11-04T10:00:00Z","150.300",-66.53,-3.5,-1.2,-71.23,71.23,-1,"Stop loss"');
    expect(lines).toContain('"Net result (USD)",-24.73');
    expect(lines).toContain('"Account","acc-1"');
    expect(statementCsv("=x", [])).toContain('"Account","\'=x"'); // no spreadsheet formulas from text
    expect(statementFileName("acc/1 2", Date.parse("2026-11-10T04:00:00Z"))).toBe("fynx-trade-statement-acc12-2026-11-10.csv");
  });

  afterEach(cleanup);
  // A fixed weekday: with the real clock this test failed whenever it ran while the forex market was closed (Friday 22:00 to Sunday 22:00 UTC).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.parse("2026-11-11T10:00:00Z"))); });
  afterEach(() => { vi.useRealTimers(); });
  it("shows totals and a download in the terminal's History tab", async () => {
    const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22 };
    const account = { accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active", currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "", rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 } };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    await venue.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 });
    feed.push(q("EURUSD", 1.0811, 1.0812, Date.now()));
    const pos = (await venue.snapshot(account.accountId)).state.positions[0];
    await venue.close(account.accountId, pos.id);
    const created: Blob[] = [];
    const orig = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return "blob:x"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const bar = await screen.findByTestId("history-statement");
    expect(bar).toHaveTextContent("Totals for the 1 closed trade shown");
    expect(bar).toHaveTextContent("1 · 1 won, 0 lost");
    expect(bar).toHaveTextContent("No losses yet");
    expect(bar).toHaveTextContent("Commission-$7.00"); // 3.50 per lot per side
    expect(bar).toHaveTextContent("Net result$93.00"); // 10 pips × $10 − $7
    fireEvent.click(within(bar).getByTestId("statement-download"));
    expect(click).toHaveBeenCalled();
    const text = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(created[0]); });
    expect(text).toContain('"Closed by you"');
    expect(text).toContain('"Net result (USD)",93');
    click.mockRestore(); URL.createObjectURL = orig.create; URL.revokeObjectURL = orig.revoke;
  });
});

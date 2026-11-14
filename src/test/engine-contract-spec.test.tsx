import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter, parseSchedule } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { ALWAYS_OPEN, FOREX_HOURS, isMarketOpen, scheduleBetween } from "@/engine/hours";
import { FOREX_PAIRS, findPair } from "@/trade-access/instruments";
import { openHours, sessionRows, spreadOf, weekHours } from "@/trade-access/contract-spec";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const H = 3_600_000, D = 24 * H;
const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, US winter time: week closes Fri 22:00 UTC, opens Sun 22:00 UTC
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const maintenance = { from: Date.parse("2026-11-06T12:00:00Z"), to: Date.parse("2026-11-06T22:00:00Z"), reason: "Provider maintenance" };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 20, hoursBySymbol: { USDTRY: { ...FOREX_HOURS, closures: [maintenance] } } });

describe("trading hours for a period (engine)", () => {
  it("lists the open stretches of the forex week, cut at the period's ends", () => {
    const s = scheduleBetween(FOREX_HOURS, T0, T0 + 7 * D);
    expect(s.sessions).toEqual([
      { from: T0, to: Date.parse("2026-11-06T22:00:00Z") },
      { from: Date.parse("2026-11-08T22:00:00Z"), to: T0 + 7 * D },
    ]);
    expect(s.closures).toEqual([]);
    for (const x of s.sessions) { expect(isMarketOpen(FOREX_HOURS, x.from)).toBe(true); expect(isMarketOpen(FOREX_HOURS, x.to - 1)).toBe(true); }
  });

  it("follows the daylight-saving change and starts closed on a Saturday", () => {
    const sat = Date.parse("2026-03-07T12:00:00Z"); // US clocks change Sunday 8 March
    const s = scheduleBetween(FOREX_HOURS, sat, sat + 7 * D);
    expect(s.sessions[0]).toEqual({ from: Date.parse("2026-03-08T21:00:00Z"), to: Date.parse("2026-03-13T21:00:00Z") });
    expect(s.sessions).toHaveLength(1);
  });

  it("cuts a closure out of the week and reports it", () => {
    const s = scheduleBetween({ ...FOREX_HOURS, closures: [maintenance, { from: T0 - 30 * D, to: T0 - 29 * D, reason: "Old" }] }, T0, T0 + 7 * D);
    expect(s.sessions[0]).toEqual({ from: T0, to: maintenance.from });
    expect(s.sessions[1].from).toBe(Date.parse("2026-11-08T22:00:00Z"));
    expect(s.closures).toEqual([maintenance]);
  });

  it("is one stretch without hours or when always open, and refuses an empty period", () => {
    expect(scheduleBetween(undefined, T0, T0 + D)).toEqual({ sessions: [{ from: T0, to: T0 + D }], closures: [] });
    expect(scheduleBetween(ALWAYS_OPEN, T0, T0 + 7 * D).sessions).toEqual([{ from: T0, to: T0 + 7 * D }]);
    expect(() => scheduleBetween(FOREX_HOURS, T0, T0)).toThrow(RangeError);
  });
});

describe("schedule in /v1/status", () => {
  const venue = () => new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);

  it("is published per symbol by the venue, the host, HttpGateway and the local adapter", async () => {
    const v = venue();
    const all = v.schedule();
    expect(Object.keys(all)).toHaveLength(FOREX_PAIRS.length);
    expect(all.EURUSD).toEqual(scheduleBetween(FOREX_HOURS, T0, T0 + 7 * D));
    expect(all.USDTRY.closures).toEqual([maintenance]);
    expect(v.schedule(30, ["EURUSD"]).EURUSD.sessions.at(-1)!.to).toBe(T0 + 14 * D);
    const opts: HostOptions = { venue: v, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => false, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string> }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const status = await new HttpGateway("https://api.example.com", async () => "t", fetcher).status();
    expect(status.schedule?.USDTRY).toEqual(all.USDTRY);
    expect((await new LocalGatewayAdapter(v).status()).schedule?.EURUSD).toEqual(all.EURUSD);
  });

  it("works with older servers and drops malformed entries", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ priceFeed: true, execution: true, message: "ok" }), { status: 200 }));
    expect((await new HttpGateway("https://api.example.com", async () => "t", fetcher).status()).schedule).toBeUndefined();
    const good = { sessions: [{ from: T0, to: T0 + D }], closures: [{ from: T0 + D, to: T0 + 2 * D, reason: "Holiday" }] };
    expect(parseSchedule(null)).toBeUndefined();
    expect(parseSchedule([good])).toBeUndefined();
    expect(parseSchedule({
      EURUSD: good,
      eurusd: good,
      GBPUSD: { sessions: [{ from: T0 + D, to: T0 }] },
      USDJPY: { sessions: [{ from: T0, to: T0 + 2 * D }, { from: T0 + D, to: T0 + 3 * D }] },
      AUDUSD: { sessions: [{ from: T0, to: T0 + 30 * D }] },
      NZDUSD: { sessions: [], closures: [{ from: T0, to: T0 + D, reason: "" }] },
      USDCAD: { sessions: "x" },
      USDCHF: { sessions: [{ from: T0, to: T0 + D }] },
    })).toEqual({ EURUSD: good, USDCHF: { sessions: [{ from: T0, to: T0 + D }], closures: [] } });
  });
});

describe("contract specification figures (terminal)", () => {
  const book = { EURUSD: q("EURUSD", 1.08, 1.08012), USDJPY: q("USDJPY", 150, 150.015), GBPJPY: q("GBPJPY", 190, 190.03) };
  it("measures the spread in pips and dollars from the server's prices", () => {
    expect(spreadOf(findPair("EURUSD")!, book.EURUSD, book)).toEqual({ pips: 1.2, usdPerLot: 12 });
    const jpy = spreadOf(findPair("GBPJPY")!, book.GBPJPY, book)!;
    expect(jpy.pips).toBe(3);
    expect(jpy.usdPerLot).toBeCloseTo(3 * 1000 / 150.0075, 1);
    expect(spreadOf(findPair("GBPJPY")!, book.GBPJPY, { GBPJPY: book.GBPJPY })).toEqual({ pips: 3, usdPerLot: null });
    expect(spreadOf(findPair("EURUSD")!, undefined, book)).toBeNull();
    expect(spreadOf(findPair("EURUSD")!, { bid: 1.1, ask: 1.09 }, book)).toBeNull();
  });

  it("uses the server's hours when sent and the standard week otherwise", () => {
    const fallback = weekHours(null, "EURUSD", T0);
    expect(fallback.source).toBe("schedule");
    expect(fallback.sessions).toEqual(scheduleBetween(FOREX_HOURS, T0, T0 + 7 * D).sessions);
    const status = { connected: true, priceFeed: true, execution: true, message: "", schedule: { EURUSD: { sessions: [{ from: T0 - D, to: T0 - H }, { from: T0 + H, to: T0 + 5 * H }], closures: [] } } };
    expect(weekHours(status, "EURUSD", T0)).toEqual({ source: "server", sessions: [{ from: T0 + H, to: T0 + 5 * H }], closures: [] });
    // The server cut its first stretch when it answered, a moment after the terminal's clock.
    const late = { ...status, schedule: { EURUSD: { sessions: [{ from: T0 + 30_000, to: T0 + 5 * H }], closures: [] } } };
    expect(weekHours(late, "EURUSD", T0, true).sessions[0].from).toBe(T0);
    expect(weekHours(late, "EURUSD", T0, false).sessions[0].from).toBe(T0 + 30_000);
    // An old answer that has fully passed is not trusted.
    expect(weekHours(status, "EURUSD", T0 + 6 * H).source).toBe("schedule");
    expect(openHours([{ from: T0 - H, to: T0 + 2 * H }, { from: T0 + 3 * H, to: T0 + 4.5 * H }], T0)).toBe(3.5);
    const rows = sessionRows([{ from: T0 - H, to: T0 + 2 * H }, { from: T0 + 3 * H, to: T0 + 4 * H }], T0);
    expect(rows[0]).toMatchObject({ opens: "Open now", openNow: true, utc: "now – Wed 12:00 UTC" });
    expect(rows[1]).toMatchObject({ openNow: false, utc: "Wed 13:00 UTC – Wed 14:00 UTC" });
  });
});

describe("terminal: spread next to SELL/BUY and the contract specification", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup(withGateway = true, symbol = "EURUSD") {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.08012, Date.now()));
    await venue.open(account.accountId);
    render(<MemoryRouter initialEntries={[`/trade?symbol=${symbol}`]}><Routes><Route path="/trade" element={withGateway ? <TradeAccess gateway={new LocalGatewayAdapter(venue)} /> : <TradeAccess />} /></Routes></MemoryRouter>);
  }

  it("shows the live spread under SELL/BUY in pips and dollars for the volume", async () => {
    await setup();
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("ticket-spread")).toHaveTextContent("Spread 1.2 pips · $1.20 on 0.10 lots"));
  });

  it("says the spread comes from the server's prices when not connected", async () => {
    await setup(false);
    const ticket = await screen.findByTestId("order-ticket");
    expect(within(ticket).getByTestId("ticket-spread")).toHaveTextContent("Spread: from the trading server’s live prices");
  });

  it("opens the specification with the server's conditions and this week's hours", async () => {
    await setup();
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByText("1:30")).toBeInTheDocument());
    fireEvent.click(within(ticket).getByRole("button", { name: "Contract specification for EURUSD" }));
    const spec = await screen.findByTestId("contract-spec");
    expect(within(spec).getByTestId("spec-spread")).toHaveTextContent("1.2 pips · $12.00 per lot");
    expect(within(spec).getByTestId("spec-pip-value")).toHaveTextContent("$10.00");
    const c = within(spec).getByTestId("spec-conditions");
    expect(c).toHaveTextContent("1:30");
    expect(c).toHaveTextContent("0.01 to 20 lots, step 0.01");
    expect(c).toHaveTextContent("$3,600.20");
    expect(c).toHaveTextContent("$3.50 per lot per side ($7.00 round turn)");
    expect(c).toHaveTextContent("No swap");
    expect(within(spec).getByTestId("spec-state")).toHaveTextContent("Open now, closes");
    expect(within(spec).getByTestId("spec-sessions").querySelectorAll("tbody tr")).toHaveLength(2);
    expect(within(spec).getByTestId("spec-sessions")).toHaveTextContent("now – Fri 22:00 UTC");
    expect(within(spec).getByTestId("spec-hours-source")).toHaveTextContent("From the trading server’s own hours");
  });

  it("lists a server closure for the pair", async () => {
    await setup(true, "USDTRY");
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByText("1:30")).toBeInTheDocument());
    fireEvent.click(within(ticket).getByRole("button", { name: "Contract specification for USDTRY" }));
    const spec = await screen.findByTestId("contract-spec");
    expect(within(spec).getByTestId("spec-closures")).toHaveTextContent("Provider maintenance: closed");
    expect(within(spec).getByTestId("spec-sessions")).toHaveTextContent("now – Fri 12:00 UTC");
    expect(within(spec).getByTestId("spec-pip-value")).toHaveTextContent("Needs a live server price");
  });

  it("opens from any Market Watch row without changing the chosen pair", async () => {
    await setup(true, "EURUSD");
    const ticket = await screen.findByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByText("1:30")).toBeInTheDocument());
    const watch = screen.getByTestId("market-watch");
    fireEvent.click(within(watch).getByTestId("watch-spec-USDTRY"));
    const spec = await screen.findByTestId("contract-spec");
    expect(within(spec).getByRole("heading", { name: /USDTRY/ })).toBeInTheDocument();
    expect(within(spec).getByTestId("spec-closures")).toHaveTextContent("Provider maintenance: closed");
    expect(within(spec).getByTestId("spec-conditions")).toHaveTextContent("1:30");
    fireEvent.keyDown(spec, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("contract-spec")).toBeNull());
    // The order panel stays on EURUSD.
    expect(within(ticket).getByRole("button", { name: "Contract specification for EURUSD" })).toBeInTheDocument();
    // Every row has its own button.
    expect(within(watch).getAllByRole("button", { name: /^Contract specification for / })).toHaveLength(FOREX_PAIRS.length);
  });

  it("is honest before trading is connected", async () => {
    await setup(false);
    const ticket = await screen.findByTestId("order-ticket");
    fireEvent.click(within(ticket).getByRole("button", { name: "Contract specification for EURUSD" }));
    const spec = await screen.findByTestId("contract-spec");
    expect(within(spec).getByTestId("spec-conditions-missing")).toHaveTextContent("Shown once trading is connected");
    expect(within(spec).getByTestId("spec-spread")).toHaveTextContent("From the trading server’s live prices");
    expect(within(spec).getByTestId("spec-hours-source")).toHaveTextContent("The standard forex week");
    expect(within(spec).getByTestId("spec-sessions").querySelectorAll("tbody tr")).toHaveLength(2);
  });
});

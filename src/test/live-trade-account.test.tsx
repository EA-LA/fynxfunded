import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalVenue, MemoryStore, StaticQuoteFeed, buildSpecs } from "@/engine/venue";
import { DisconnectedGateway, LocalGatewayAdapter, type TradingGateway } from "@/engine/gateway";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { accountStatusLabel, liveAccountSummary, positionProfitUsd } from "@/trade-access/live-account";
import { useEngine } from "@/trade-access/useEngine";
import LiveTradeAccountCard from "@/components/LiveTradeAccountCard";

const mocks = vi.hoisted(() => ({ accounts: [] as unknown[], auth: { user: { userId: "u1" } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-trading-data", async () => {
  const actual = await import("@/lib/tradingData");
  return { useTradingData: () => ({ loading: false, error: "", trades: [] }), computeAnalytics: actual.computeAnalytics };
});
vi.mock("@/services/database", () => ({
  dataService: {
    getChallenges: async () => [{ challengeId: "ch-1", name: "$10K 2-Phase", status: "active", phase: "2-phase", accountSize: 10000, style: "standard" }],
    getAccounts: async () => mocks.accounts,
  },
}));
vi.mock("@/components/AccountEquityHistory", () => ({ default: () => null }));
vi.mock("@/components/TradingAccess", () => ({ default: () => null }));
vi.mock("@/components/OrderProgress", () => ({ default: () => null }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, Area: () => null, AreaChart: () => null, Bar: () => null, BarChart: () => null, Cell: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import AccountWorkspace from "@/pages/dashboard/AccountWorkspace";

const RULES = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22, consistencyPercent: 40 };

async function venueWithTrade(opts: { stopLoss?: number } = { stopLoss: 1.078 }) {
  const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 }), new MemoryStore(), async () => RULES, { maxQuoteAgeMs: 60_000 });
  const feed = new StaticQuoteFeed(); venue.connect(feed);
  feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: Date.now() });
  await venue.open("acc-1");
  await venue.place("acc-1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, ...(opts.stopLoss ? { stopLoss: opts.stopLoss } : {}), clientId: "c1" });
  return { venue, feed };
}

function Harness({ gateway }: { gateway: TradingGateway }) {
  const engine = useEngine("acc-1", gateway, { pollMs: 5000 });
  return <MemoryRouter><LiveTradeAccountCard engine={engine} accountId="acc-1" startingBalance={10000} /></MemoryRouter>;
}

afterEach(cleanup);

describe("live account figures from an engine snapshot", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("gives balance, equity, open profit and the room left before both loss limits", async () => {
    const { venue, feed } = await venueWithTrade();
    feed.push({ symbol: "EURUSD", bid: 1.079, ask: 1.0791, time: Date.now() });
    const s = liveAccountSummary(await venue.snapshot("acc-1"), 10000);
    // Bought 1 lot at 1.0801, now 1.0790 bid: -110 USD open; 3.50 commission charged on entry.
    expect(s.balance).toBe(9996.5);
    expect(s.floatingProfit).toBeCloseTo(-110, 2);
    expect(s.equity).toBeCloseTo(9886.5, 2);
    expect(s.dailyLoss).toEqual({ floor: 9500, room: 386.5, allowance: 500, usedPercent: 22.7 });
    expect(s.maxLoss).toEqual({ floor: 9000, room: 886.5, allowance: 1000, usedPercent: 11.35 });
    expect(s.closerLimit).toBe("daily");
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0]).toMatchObject({ symbol: "EURUSD", side: "buy", lots: 1, stopLoss: 1.078 });
    expect(s.positions[0].profit).toBeCloseTo(-110, 2);
    expect(s.pricesAt).toBe(Date.now());
  });

  it("does not invent an allowance it can't know, and handles missing prices", async () => {
    const { venue } = await venueWithTrade();
    const snap = await venue.snapshot("acc-1");
    expect(liveAccountSummary(snap).maxLoss.allowance).toBeNull();
    expect(liveAccountSummary(snap).maxLoss.usedPercent).toBeNull();
    expect(liveAccountSummary(snap, Number.NaN).maxLoss.allowance).toBeNull();
    expect(positionProfitUsd({ symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08 }, {})).toBeNaN();
    expect(positionProfitUsd({ symbol: "XXXYYY", side: "buy", lots: 1, entryPrice: 1.08 }, snap.quotes)).toBeNaN();
    // Swap is part of a position's open result.
    expect(positionProfitUsd({ symbol: "EURUSD", side: "sell", lots: 1, entryPrice: 1.0801, swap: -2 }, { EURUSD: { symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: 1 } })).toBeCloseTo(-2, 6);
  });

  it("never reports less than zero room or more than 100% used once a limit is passed", async () => {
    const { venue, feed } = await venueWithTrade({});
    feed.push({ symbol: "EURUSD", bid: 1.07, ask: 1.0701, time: Date.now() });
    const s = liveAccountSummary(await venue.snapshot("acc-1"), 10000);
    expect(s.status).toBe("breached");
    expect(s.statusLabel).toBe("Loss limit reached · account closed");
    expect(s.dailyLoss.room).toBe(0);
    expect(s.dailyLoss.usedPercent).toBe(100);
    expect(s.positions).toHaveLength(0);
  });

  it("names every account state in plain words", () => {
    expect(accountStatusLabel("active")).toBe("Active");
    expect(accountStatusLabel("passed")).toBe("Target met · waiting for review");
    expect(accountStatusLabel("disabled")).toBe("Disabled");
  });
});

describe("Live on FYNX Trade card", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("says the engine isn't connected and shows no figures", async () => {
    const gateway = new DisconnectedGateway();
    const snap = vi.spyOn(gateway, "snapshot");
    render(<Harness gateway={gateway} />);
    const card = await screen.findByTestId("live-trade-card");
    await waitFor(() => expect(within(card).getByTestId("live-engine-status")).toHaveTextContent("Engine not connected"));
    expect(card).toHaveTextContent("The trading engine is not connected yet");
    expect(card).not.toHaveTextContent("$");
    expect(snap).not.toHaveBeenCalled();
    expect(within(card).getByRole("link", { name: "Open FYNX Trade" })).toHaveAttribute("href", "/trade/access?account=acc-1");
  });

  it("shows the live account, open trades, loss-limit room and target progress", async () => {
    const { venue, feed } = await venueWithTrade();
    feed.push({ symbol: "EURUSD", bid: 1.079, ask: 1.0791, time: Date.now() });
    render(<Harness gateway={new LocalGatewayAdapter(venue)} />);
    const card = await screen.findByTestId("live-trade-card");
    await waitFor(() => expect(card).toHaveTextContent("Active"));
    expect(within(card).getByTestId("live-engine-status")).toHaveTextContent("Trading engine live");
    expect(card).toHaveTextContent("$9,996.50");
    expect(card).toHaveTextContent("$9,886.50");
    expect(card).toHaveTextContent("-$110.00");
    const daily = within(card).getByTestId("room-daily-loss-limit");
    expect(daily).toHaveTextContent("$386.50 left");
    expect(daily).toHaveTextContent("Account closes if equity reaches $9,500.00 · 22.7% of today's allowance used");
    expect(daily).toHaveTextContent("Closer limit");
    expect(within(card).getByTestId("room-maximum-loss")).toHaveTextContent("$886.50 left");
    const row = within(within(card).getByTestId("live-positions")).getAllByRole("row")[1];
    expect(row).toHaveTextContent("EURUSD");
    expect(row).toHaveTextContent("1.07800");
    expect(row).toHaveTextContent("None"); // no take profit
    expect(within(card).getByTestId("target-progress")).toHaveTextContent("Trading days");
  });

  it("explains when the account can't be loaded from the engine", async () => {
    const { venue } = await venueWithTrade();
    const gateway = new LocalGatewayAdapter(venue);
    gateway.snapshot = async () => { throw new Error("Account not found."); };
    render(<Harness gateway={gateway} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This account could not be loaded from FYNX Trade: Account not found.");
  });
});

describe("account workspace with a FYNX Trade account", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  const page = (gateway?: TradingGateway) => render(<MemoryRouter initialEntries={["/dashboard/accounts/ch-1"]}><Routes><Route path="/dashboard/accounts/:challengeId" element={<AccountWorkspace gateway={gateway} />} /></Routes></MemoryRouter>);

  it("uses the engine's live balance and equity in the overview tiles", async () => {
    mocks.accounts = [{ accountId: "acc-1", challengeId: "ch-1", platform: "FYNX Trade", balance: 10000, equity: 10000 }];
    const { venue } = await venueWithTrade();
    await act(async () => { page(new LocalGatewayAdapter(venue)); });
    expect(await screen.findByText("Balance · live")).toBeInTheDocument();
    expect(screen.getByText("Equity · live")).toBeInTheDocument();
    expect(screen.getByTestId("live-trade-card")).toBeInTheDocument();
  });

  it("keeps the stored figures and asks nothing of the engine for other platforms", async () => {
    mocks.accounts = [{ accountId: "acc-1", challengeId: "ch-1", platform: "MT5", balance: 10250, equity: 10300 }];
    const gateway = new DisconnectedGateway();
    const status = vi.spyOn(gateway, "status");
    page(gateway);
    expect(await screen.findByText("$10,250.00")).toBeInTheDocument();
    expect(screen.queryByTestId("live-trade-card")).toBeNull();
    expect(screen.queryByText("Balance · live")).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });
});

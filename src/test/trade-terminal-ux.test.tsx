import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const base = {
  accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
  currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
  rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
};

async function setup(tradingEnabled: boolean) {
  const account = { ...base, tradingEnabled, tradingHoldReason: tradingEnabled ? "" : "Trading is not available yet." };
  mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
  const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
  const feed = new StaticQuoteFeed(); venue.connect(feed);
  feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: Date.now() });
  await venue.open(account.accountId);
  render(<MemoryRouter initialEntries={["/trade/access"]}><Routes><Route path="/trade/access" element={<TradeAccess gateway={new LocalGatewayAdapter(venue)} />} /></Routes></MemoryRouter>);
  return { venue, feed, account };
}

describe("FYNX Trade terminal: entering trades quickly", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("hides the 'Trading opens soon' note once the account can trade, and shows it while it cannot", async () => {
    await setup(true);
    await screen.findByTestId("watch-price-EURUSD");
    expect(screen.queryByTestId("trading-soon")).toBeNull();
    cleanup();
    await setup(false);
    expect(await screen.findByTestId("trading-soon")).toHaveTextContent("Trading opens soon");
  });

  it("Market Watch shows the trading server's bid and ask", async () => {
    await setup(true);
    const price = await screen.findByTestId("watch-price-EURUSD");
    expect(price).toHaveTextContent("1.08000");
    expect(price).toHaveTextContent("1.08010");
    expect(price).toHaveTextContent("spread 1.0");
  });

  it("BUY on the chart opens the order review for a buy, and Confirm opens the position", async () => {
    const { venue, account } = await setup(true);
    const bar = await screen.findByTestId("quote-bar");
    await waitFor(() => expect(within(bar).getByRole("button", { name: "Buy EURUSD" })).toHaveTextContent("1.08010"));
    fireEvent.click(within(bar).getByRole("button", { name: "Buy EURUSD" }));
    const review = await screen.findByTestId("order-review");
    expect(review).toHaveTextContent("Buy 0.10 EURUSD at market");
    await act(async () => { fireEvent.click(within(review).getByTestId("confirm-order")); });
    await waitFor(async () => expect((await venue.snapshot(account.accountId)).state.positions).toHaveLength(1));
    expect(await screen.findByTestId("order-sent")).toHaveTextContent("Bought 0.10 EURUSD");
  });

  it("keeps the advanced order options folded until used, and says which are set", async () => {
    await setup(true);
    const more = await screen.findByTestId("ticket-more");
    expect(more).not.toHaveAttribute("open");
    fireEvent.change(within(more).getByLabelText("Trailing stop (pips)"), { target: { value: "20" } });
    expect(screen.getByTestId("ticket-more")).toHaveAttribute("open");
    expect(within(screen.getByTestId("ticket-more")).getByText(/trailing stop/, { selector: "span" })).toBeInTheDocument();
  });
});

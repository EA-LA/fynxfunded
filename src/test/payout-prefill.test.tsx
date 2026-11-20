import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalVenue, MemoryStore, StaticQuoteFeed, buildSpecs } from "@/engine/venue";
import { DisconnectedGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { accountIds, accountPayouts, payoutPrefill, selfCheckLink, type PayoutPrefillInput } from "@/lib/payoutPrefill";
import { checkPayoutReadiness } from "@/lib/payoutReadiness";
import type { Trade } from "@/lib/tradingData";

const mocks = vi.hoisted(() => ({ trades: [] as unknown[] }));
vi.mock("@/hooks/use-trading-data", () => ({ useTradingData: () => ({ hasAccount: false, payout: null, trades: mocks.trades }) }));
import AccountPayoutReadiness from "@/components/AccountPayoutReadiness";
import PayoutReadiness from "@/components/PayoutReadiness";

afterEach(() => { cleanup(); mocks.trades = []; vi.useRealTimers(); });

const trade = (id: string, closeTime: string, pnl: number, extra: Partial<Trade> = {}): Trade => ({
  id, accountId: "acc-1", challengeId: "f1", symbol: "EURUSD", type: "Buy", openTime: closeTime, closeTime, lots: 1, pnl, pips: 0,
  duration: "1m", riskPercent: null, rr: null, session: "London", result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven", ...extra,
});

const base = (over: Partial<PayoutPrefillInput> = {}): PayoutPrefillInput => ({
  challenge: { challengeId: "f1", accountSize: 10000, phase: "2-phase", status: "funded", brokerAccountId: "acc-1", fundedAt: "2026-11-02T09:00:00Z" },
  account: { accountId: "acc-1", login: "FX100", platform: "FYNX Trade", status: "active" },
  trades: [],
  payouts: [],
  fundedCount: 1,
  kycVerified: true,
  live: null,
  ...over,
});

describe("payout readiness from the trader's own records", () => {
  it("counts trading days (22:00 UTC days) and net profit since the account was funded", () => {
    const p = payoutPrefill(base({
      trades: [
        trade("t0", "2026-11-01T10:00:00Z", 999), // before funding: not counted
        trade("t1", "2026-11-02T10:00:00Z", 120.5),
        trade("t2", "2026-11-02T21:59:00Z", -20.25), // same trading day as t1
        trade("t3", "2026-11-02T22:01:00Z", 50), // next trading day (after the 22:00 reset)
        trade("t4", "2026-11-04T08:00:00Z", 10, { challengeId: "", accountId: "FX100" }), // matched by login
        trade("x1", "2026-11-04T08:00:00Z", 500, { challengeId: "other", accountId: "other" }),
      ],
    }));
    expect(p.program).toBe("2-phase");
    expect(p.since).toEqual({ at: "2026-11-02T09:00:00.000Z", kind: "funded" });
    expect(p.tradesCounted).toBe(4);
    expect(p.input.tradingDays).toBe(3);
    expect(p.input.netProfit).toBe(160.25);
    expect(p.notes.days).toMatchObject({ source: "trades" });
    expect(p.notes.days.note).toMatch(/since this account was funded \(Nov 2, 2026, UTC\).*4 recorded trades/);
    // Funded 2-phase $10K splits 80%: 160.25 → 128.20 share, over the $50 minimum; 3 days < 5.
    const r = checkPayoutReadiness({ accountSize: 10000, program: "2-phase", ...p.input }, new Date("2026-11-05T00:00:00Z"));
    expect(r.checks.find(c => c.id === "minimum")!.state).toBe("met");
    expect(r.checks.find(c => c.id === "days")!.state).toBe("missing");
    expect(r.traderShare).toBe(128.2);
  });

  it("counts from the last approved or paid request, and notes a request still waiting", () => {
    const p = payoutPrefill(base({
      trades: [trade("t1", "2026-11-05T10:00:00Z", 300), trade("t2", "2026-11-12T10:00:00Z", 40)],
      payouts: [
        { accountId: "acc-1", status: "paid", requestedAt: "2026-11-03T08:00:00Z", amount: 100 },
        { accountId: "", status: "approved", requestedAt: "2026-11-08T08:00:00Z", amount: 200 }, // no account: the only funded account
        { accountId: "acc-1", status: "denied", requestedAt: "2026-11-15T08:00:00Z" },
        { accountId: "acc-1", status: "requested", requestedAt: "2026-11-16T08:00:00Z", amount: 30 },
        { accountId: "someone-else", status: "paid", requestedAt: "2026-11-18T08:00:00Z" },
      ],
    }));
    expect(p.since).toEqual({ at: "2026-11-08T08:00:00.000Z", kind: "payout" });
    expect(p.input).toMatchObject({ tradingDays: 1, netProfit: 40 });
    expect(p.notes.days.note).toMatch(/since your last approved payout request \(Nov 8, 2026, UTC\)/);
    expect(p.pending).toEqual({ requestedAt: "2026-11-16T08:00:00.000Z", amount: 30 });
  });

  it("does not give a request without an account to one of several funded accounts", () => {
    const ids = accountIds(base().challenge, base().account);
    expect(ids).toEqual(["f1", "acc-1", "FX100"]);
    const rows = [{ accountId: "", status: "paid", requestedAt: "2026-11-08T08:00:00Z" }];
    expect(accountPayouts(rows, ids, 1)).toHaveLength(1);
    expect(accountPayouts(rows, ids, 2)).toHaveLength(0);
  });

  it("leaves days and profit unanswered when the funded date is not recorded", () => {
    const p = payoutPrefill(base({ challenge: { ...base().challenge, fundedAt: undefined }, trades: [trade("t1", "2026-11-05T10:00:00Z", 300)] }));
    expect(p.since).toBeNull();
    expect(p.input).toMatchObject({ tradingDays: null, netProfit: null });
    expect(p.notes.days).toMatchObject({ source: "unknown" });
    expect(p.notes.days.note).toMatch(/don't say when it was funded/);
    // The account document's funded date is used when the challenge has none.
    const q = payoutPrefill(base({ challenge: { ...base().challenge, fundedAt: undefined }, account: { ...base().account!, fundedAt: { toDate: () => new Date("2026-11-04T00:00:00Z") } }, trades: [trade("t1", "2026-11-05T10:00:00Z", 300)] }));
    expect(q.since?.kind).toBe("funded");
    expect(q.input.netProfit).toBe(300);
  });

  it("uses the live FYNX Trade account for open trades and broken limits; never guesses without it", () => {
    expect(payoutPrefill(base()).input).toMatchObject({ positionsClosed: null, noViolations: null, kycDone: true });
    expect(payoutPrefill(base({ live: { positions: 0, status: "active" } })).input).toMatchObject({ positionsClosed: true, noViolations: true });
    const open = payoutPrefill(base({ live: { positions: 2, status: "breached" } }));
    expect(open.input).toMatchObject({ positionsClosed: false, noViolations: false });
    expect(open.notes.positions.note).toBe("FYNX Trade shows 2 open trades right now.");
    expect(open.notes.violations.note).toMatch(/broken loss limit/);
    const suspended = payoutPrefill(base({ account: { ...base().account!, status: "suspended" } }));
    expect(suspended.input.noViolations).toBe(false);
    expect(suspended.notes.violations).toMatchObject({ source: "account" });
    expect(payoutPrefill(base({ kycVerified: false })).input.kycDone).toBe(false);
    expect(payoutPrefill(base({ kycVerified: null })).input.kycDone).toBeNull();
  });

  it("knows when the plan is not in the published schedule, and builds the self-check link", () => {
    expect(payoutPrefill(base({ challenge: { ...base().challenge, accountSize: 12345 } })).program).toBeNull();
    const p = payoutPrefill(base({ trades: [trade("t1", "2026-11-05T10:00:00Z", 80.5)] }));
    expect(selfCheckLink(p)).toBe("/payouts?size=10000&program=2-phase&days=1&profit=80.5#readiness");
    const unknown = payoutPrefill(base({ challenge: { ...base().challenge, fundedAt: undefined } }));
    expect(selfCheckLink(unknown)).toBe("/payouts?size=10000&program=2-phase#readiness");
  });
});

const RULES = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 5, resetHourUtc: 22, consistencyPercent: 40 };

describe("Payout readiness card on dashboard Payouts", () => {
  const challenges = [
    { challengeId: "f1", name: "$10K 2-Phase", accountReference: "FX-F1", accountSize: 10000, phase: "2-phase", status: "funded", brokerAccountId: "acc-1", fundedAt: "2026-11-02T09:00:00Z" },
    { challengeId: "f2", name: "$50K 3-Phase", accountReference: "FX-F2", accountSize: 50000, phase: "3-phase", status: "funded" },
    { challengeId: "a1", name: "Evaluation", accountSize: 5000, phase: "1-phase", status: "active" },
  ];
  const accounts = [{ accountId: "acc-1", login: "FX100", challengeId: "f1", platform: "FYNX Trade", status: "active" }];

  it("shows nothing without a funded account", () => {
    render(<MemoryRouter><AccountPayoutReadiness challenges={[challenges[2]]} accounts={[]} payouts={[]} kycVerified={true} gateway={new DisconnectedGateway()} /></MemoryRouter>);
    expect(screen.queryByTestId("account-payout-readiness")).toBeNull();
  });

  it("fills the conditions from records and the live engine, and switches accounts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    mocks.trades = [trade("t1", "2026-11-03T10:00:00Z", 400), trade("t2", "2026-11-04T10:00:00Z", 100)];
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 }), new MemoryStore(), async () => RULES, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: Date.now() });
    await venue.open("acc-1");
    await venue.place("acc-1", { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1, stopLoss: 1.07, clientId: "c1" });
    const gateway = new LocalGatewayAdapter(venue);

    render(<MemoryRouter><AccountPayoutReadiness challenges={challenges} accounts={accounts} payouts={[]} kycVerified={true} gateway={gateway} now={new Date("2026-11-05T12:00:00Z")} /></MemoryRouter>);
    const card = await screen.findByTestId("account-payout-readiness");
    await waitFor(() => expect(card.querySelector('[data-check="positions"]')!.getAttribute("data-state")).toBe("missing"));
    expect(card.querySelector('[data-check="positions"]')).toHaveTextContent("FYNX Trade shows 1 open trade right now.");
    expect(card.querySelector('[data-check="violations"]')!.getAttribute("data-state")).toBe("met");
    expect(card.querySelector('[data-check="kyc"]')!.getAttribute("data-state")).toBe("met");
    expect(card.querySelector('[data-check="minimum"]')!.getAttribute("data-state")).toBe("met");
    expect(card.querySelector('[data-check="days"]')).toHaveTextContent(/2 trading days so far/);
    const summary = within(card).getByTestId("account-readiness-summary");
    expect(summary).toHaveTextContent("3 of 5 conditions met");
    expect(summary).toHaveTextContent("Not ready yet");
    expect(summary).toHaveTextContent("$500.00");
    expect(summary).toHaveTextContent("$400.00"); // 80% of $500
    expect(within(card).getByRole("link", { name: "Open in the self-check" }).getAttribute("href")).toBe("/payouts?size=10000&program=2-phase&days=2&profit=500#readiness");

    // Second funded account: no funded date, not on FYNX Trade: honest unknowns.
    within(card).getByRole("button", { name: /FX-F2/ }).click();
    await waitFor(() => expect(card.querySelector('[data-check="days"]')!.getAttribute("data-state")).toBe("unanswered"));
    expect(card.querySelector('[data-check="positions"]')!.getAttribute("data-state")).toBe("unanswered");
    expect(card.querySelector('[data-check="positions"]')).toHaveTextContent("Check yourself");
    expect(within(card).getByTestId("account-readiness-summary")).toHaveTextContent("1 of 5 conditions met");
  });

  it("says when the plan is not in the schedule", () => {
    render(<MemoryRouter><AccountPayoutReadiness challenges={[{ ...challenges[0], accountSize: 12345 }]} accounts={[]} payouts={[]} kycVerified={false} gateway={new DisconnectedGateway()} /></MemoryRouter>);
    expect(screen.getByTestId("readiness-no-plan")).toHaveTextContent(/isn't in the published schedule/);
  });
});

describe("public self-check filled in from the dashboard link", () => {
  it("uses valid size, program, days and profit from the address", () => {
    render(<MemoryRouter initialEntries={["/payouts?size=50000&program=3-phase&days=6&profit=1200.5#readiness"]}><PayoutReadiness now={new Date("2026-11-05T12:00:00Z")} /></MemoryRouter>);
    expect(screen.getByTestId("readiness-from-dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$50K" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3 phase" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByDisplayValue("6")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1200.5")).toBeInTheDocument();
  });

  it("ignores values that aren't valid and shows no note without them", () => {
    render(<MemoryRouter initialEntries={["/payouts?size=12345&program=9-phase&days=abc&profit=1e9"]}><PayoutReadiness now={new Date("2026-11-05T12:00:00Z")} /></MemoryRouter>);
    expect(screen.queryByTestId("readiness-from-dashboard")).toBeNull();
    expect(screen.getByRole("button", { name: "$25K" })).toHaveAttribute("aria-pressed", "true");
  });
});

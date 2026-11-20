import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, EngineError, Quote, QuoteBook, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { DisconnectedGateway, HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { newAccount, placeOrder, reversePosition, type EngineContext } from "@/engine/core";
import { refusalEntry } from "@/engine/journal";
import { requestClass } from "@/engine/rate-limit";
import { reverseBlocked } from "@/trade-access/reverse";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

// Test values only: these prices exercise the plumbing; they are not market data.
const WED = Date.parse("2026-11-11T10:00:00Z");
const SAT = Date.parse("2026-11-14T10:00:00Z");
const base: RuleSet = { startingBalance: 100000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eurusd: [number, number] = [1.08, 1.0801]): QuoteBook => ({ EURUSD: q("EURUSD", eurusd[0], eurusd[1], time), GBPUSD: q("GBPUSD", 1.25, 1.2501, time) });
const ctxAt = (now: number, r: RuleSet = base, quotes: QuoteBook = book(now)): EngineContext => ({ specs, quotes, rules: r, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}` });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };
const withBuy = (r: RuleSet = base, lots = 1, extra: { stopLoss?: number; takeProfit?: number; trailingPips?: number } = {}): AccountState =>
  placeOrder(newAccount("acc_1", r, WED), { symbol: "EURUSD", side: "buy", type: "market", lots, ...extra }, ctxAt(WED, r)).state;

describe("engine: reversePosition", () => {
  it("closes the buy at the bid and opens a sell of the same volume at the same bid, without stops", () => {
    const s = withBuy(base, 1, { stopLoss: 1.07, takeProfit: 1.09, trailingPips: 20 });
    const id = s.positions[0].id;
    const later = WED + 60_000;
    const step = reversePosition(s, id, ctxAt(later, base, book(later, [1.081, 1.0811])));
    expect(step.events.map(e => e.type)).toEqual(["position_closed", "position_opened"]);
    expect(step.state.positions).toHaveLength(1);
    const now = step.state.positions[0];
    expect(now).toMatchObject({ symbol: "EURUSD", side: "sell", lots: 1, entryPrice: 1.081, openedAt: later });
    expect(now.stopLoss).toBeUndefined();
    expect(now.takeProfit).toBeUndefined();
    expect(now.trailingStop).toBeUndefined();
    const deal = step.state.history.at(-1)!;
    expect(deal).toMatchObject({ positionId: id, side: "buy", exitPrice: 1.081, reason: "manual" });
    // 9 pips on 1 lot = $90 gross; 3.50 commission per side on each trade.
    expect(deal.grossProfit).toBe(90);
    expect(step.state.balance).toBe(100000 - 3.5 + 90 - 3.5 - 3.5);
  });

  it("a sell reverses into a buy at the ask; partial volumes stay whole", () => {
    const r0 = newAccount("acc_1", base, WED);
    const s = placeOrder(r0, { symbol: "EURUSD", side: "sell", type: "market", lots: 0.37 }, ctxAt(WED)).state;
    const step = reversePosition(s, s.positions[0].id, ctxAt(WED + 1000));
    expect(step.state.positions[0]).toMatchObject({ side: "buy", lots: 0.37, entryPrice: 1.0801 });
  });

  it("if the new trade is refused nothing is closed (one step)", () => {
    // Stop loss required on every new order: the reversed trade would have none.
    const r = { ...base, stopLossRequired: true } as RuleSet;
    const s = withBuy(r, 1, { stopLoss: 1.07 });
    expect(code(() => reversePosition(s, s.positions[0].id, ctxAt(WED + 1000, r)))).toBe("risk_limit");
    // No hedging with another buy left open on the pair.
    const nh: RuleSet = { ...base, hedgingAllowed: false };
    const two = placeOrder(withBuy(nh, 1), { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 }, ctxAt(WED, nh)).state;
    expect(code(() => reversePosition(two, two.positions[0].id, ctxAt(WED + 1000, nh)))).toBe("hedging");
    // With only that one buy, no hedging is fine: it is closed first.
    const one = withBuy(nh, 1);
    expect(reversePosition(one, one.positions[0].id, ctxAt(WED + 1000, nh)).state.positions[0].side).toBe("sell");
  });

  it("refuses unknown positions, closed accounts, closed markets and stale prices", () => {
    const s = withBuy();
    expect(code(() => reversePosition(s, "pos_nope", ctxAt(WED)))).toBe("no_position");
    expect(code(() => reversePosition({ ...s, status: "breached" }, s.positions[0].id, ctxAt(WED)))).toBe("account_closed");
    expect(code(() => reversePosition(s, s.positions[0].id, ctxAt(SAT, base, book(SAT))))).toBe("market_closed");
    expect(code(() => reversePosition(s, s.positions[0].id, ctxAt(WED + 120_000, base, book(WED))))).toBe("stale_quote");
  });

  it("a retried request with the same client id reverses only once", () => {
    const s = withBuy();
    const once = reversePosition(s, s.positions[0].id, ctxAt(WED + 1000), "rev-1");
    expect(once.state.positions[0].clientId).toBe("rev-1");
    const again = reversePosition(once.state, s.positions[0].id, ctxAt(WED + 2000), "rev-1");
    expect(again.events).toEqual([]);
    expect(again.state).toBe(once.state);
    expect(code(() => reversePosition(s, s.positions[0].id, ctxAt(WED), "x".repeat(101)))).toBe("bad_request");
  });
});

describe("journal, limits and gateways", () => {
  it("a refused reverse is journaled in plain words", () => {
    const s = withBuy();
    const e = refusalEntry({ type: "reverse", positionId: s.positions[0].id }, { code: "no_margin", message: "Not enough free margin." }, s, WED);
    expect(e).toMatchObject({ kind: "refused", code: "no_margin", symbol: "EURUSD", ref: s.positions[0].id });
    expect(e!.text).toMatch(new RegExp(`^Refused reversing position #${s.positions[0].id} .*EURUSD.*: Not enough free margin\\.$`));
  });

  it("counts as a trade request for the rate limits (it opens a trade)", () => {
    expect(requestClass("POST", "/v1/accounts/a/positions/p/reverse")).toBe("trade");
    expect(requestClass("POST", "/v1/accounts/a/positions/p/close")).toBe("reduce");
  });

  it("HTTP gateway posts an empty body with the Idempotency-Key; disconnected refuses", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const g = new HttpGateway("https://engine.example", async () => "tok", async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); });
    await g.reversePosition("acc 1", "pos/2", "rev-9");
    expect(calls[0].url).toBe("https://engine.example/v1/accounts/acc%201/positions/pos%2F2/reverse");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe("{}");
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("rev-9");
    await expect(new DisconnectedGateway().reversePosition()).rejects.toMatchObject({ code: "not_connected" });
  });

  it("local gateway: reverse goes through the venue and is journaled; refused while paused", async () => {
    const v = new LocalVenue(specs, new MemoryStore(), async () => base, { maxQuoteAgeMs: 60_000 }, () => WED);
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, WED));
    await v.open("acc_1");
    const placed = await v.place("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 });
    let paused = false;
    const g = new LocalGatewayAdapter(v, { pause: () => (paused ? { reason: "Maintenance", since: WED, until: null } : null) });
    const after = await g.reversePosition("acc_1", placed.state.positions[0].id, "rev-a");
    expect(after.state.positions.map(p => p.side)).toEqual(["sell"]);
    expect(after.state.journal?.some(j => /closed/i.test(j.text))).toBe(true);
    paused = true;
    await expect(g.reversePosition("acc_1", after.state.positions[0].id)).rejects.toMatchObject({ code: "trading_paused" });
  });
});

describe("HTTP contract: POST /v1/accounts/{id}/positions/{positionId}/reverse", () => {
  it("needs trading switched on, takes an empty body, honours the Idempotency-Key", async () => {
    const now = WED;
    let enabled = false;
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async () => base, feed, accounts: async () => ["acc_9"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => enabled,
      clock: () => now, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    enabled = true;
    const opened = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } });
    const posId = (opened.body as { state: AccountState }).state.positions[0].id;
    const path = `/v1/accounts/acc_9/positions/${posId}/reverse`;
    enabled = false;
    expect((await server.handle({ method: "POST", path, headers: auth, body: {} })).status).toBe(403);
    enabled = true;
    expect((await server.handle({ method: "GET", path, headers: auth })).status).toBe(405);
    const bad = await server.handle({ method: "POST", path, headers: auth, body: { lots: 0.5 } });
    expect(bad.status).toBe(400);
    const ok = await server.handle({ method: "POST", path, headers: { ...auth, "Idempotency-Key": "rev-1" }, body: {} });
    expect(ok.status).toBe(200);
    const st = (ok.body as { state: AccountState }).state;
    expect(st.positions.map(p => [p.side, p.lots])).toEqual([["sell", 1]]);
    // The same key again: the old position is gone, but the request is recognised and nothing changes.
    const again = await server.handle({ method: "POST", path, headers: { ...auth, "Idempotency-Key": "rev-1" }, body: {} });
    expect(again.status).toBe(200);
    expect((again.body as { state: AccountState }).state.positions).toHaveLength(1);
    expect((await server.handle({ method: "POST", path: `/v1/accounts/acc_9/orders/${posId}/reverse`, headers: auth, body: {} })).status).toBe(404);
    await server.stop();
  });
});

describe("terminal: Reverse in the position editor", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(WED)); });
  afterEach(() => { vi.useRealTimers(); });

  it("explains blocks before sending", () => {
    const p = { id: "p1", symbol: "EURUSD", side: "buy" as const };
    expect(reverseBlocked({ position: p, positions: [p], stopRequired: false, hedgingAllowed: true })).toBeNull();
    expect(reverseBlocked({ position: p, positions: [p], stopRequired: true, hedgingAllowed: true })).toMatch(/needs a stop loss on every new trade/);
    expect(reverseBlocked({ position: p, positions: [p, { id: "p2", symbol: "EURUSD", side: "buy" }], stopRequired: false, hedgingAllowed: false })).toBe("This account does not allow a buy and a sell on the same pair at once, and trade #p2 stays open BUY on EURUSD. Close it first.");
    expect(reverseBlocked({ position: p, positions: [p, { id: "p2", symbol: "EURUSD", side: "sell" }, { id: "p3", symbol: "GBPUSD", side: "buy" }], stopRequired: false, hedgingAllowed: false })).toBeNull();
  });

  it("confirms what will happen, then reverses on the server", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 100000, balance: 100000, equity: 100000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => base, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5, stopLoss: 1.07 });
    feed.push(q("EURUSD", 1.081, 1.0811, Date.now()));
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const positions = await screen.findByTestId("engine-positions");
    fireEvent.click(await within(positions).findByRole("button", { name: /Edit stop loss, take profit or volume of EURUSD/ }));
    const editor = screen.getByTestId("position-editor");
    fireEvent.click(within(editor).getByRole("button", { name: "Reverse to SELL" }));
    const confirm = within(editor).getByTestId("reverse-confirm");
    expect(confirm).toHaveTextContent("Closes all 0.50 lots BUY EURUSD at the bid (now 1.08100), result about $45.00 before commission.");
    expect(confirm).toHaveTextContent("Opens 0.50 lots SELL EURUSD at that same price, in the same step.");
    expect(confirm).toHaveTextContent("If the server cannot open the new trade (margin, rules, market), nothing is closed and you keep this position.");
    expect(within(confirm).queryByTestId("reverse-blocked")).toBeNull();
    await act(async () => { fireEvent.click(within(confirm).getByTestId("reverse-confirm-button")); });
    expect(await screen.findByTestId("position-notice")).toHaveTextContent("Reversed EURUSD");
    expect(screen.getByTestId("position-notice")).toHaveTextContent("opened 0.50 lots SELL at 1.08100. Set a stop loss on the new trade.");
    const snap = await v.snapshot(account.accountId);
    expect(snap.state.positions.map(p => [p.side, p.lots, p.entryPrice])).toEqual([["sell", 0.5, 1.081]]);
    expect(snap.state.history).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByTestId("engine-positions")).getAllByRole("row").some(r => /SELL/i.test(r.textContent ?? "") && /0\.50/.test(r.textContent ?? ""))).toBe(true));
  });

  it("locks Confirm with a reason on accounts that need a stop loss", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 100000, balance: 100000, equity: 100000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const r = { ...base, stopLossRequired: true } as RuleSet;
    const v = new LocalVenue(specs, new MemoryStore(), async () => r, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5, stopLoss: 1.07 });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const positions = await screen.findByTestId("engine-positions");
    fireEvent.click(await within(positions).findByRole("button", { name: /Edit stop loss, take profit or volume of EURUSD/ }));
    fireEvent.click(within(screen.getByTestId("position-editor")).getByRole("button", { name: "Reverse to SELL" }));
    expect(screen.getByTestId("reverse-blocked")).toHaveTextContent("This account needs a stop loss on every new trade");
    expect(screen.getByTestId("reverse-confirm-button")).toBeDisabled();
  });
});

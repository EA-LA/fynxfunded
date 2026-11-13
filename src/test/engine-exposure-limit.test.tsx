import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, Quote, QuoteBook, RuleSet } from "@/engine/types";
import type { EngineError } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { cancelOrder, closePosition, modifyOrder, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import { exposureBreach, exposureLimits, exposureRuleText, exposureUse } from "@/engine/exposure";
import { exposureRule, ticketExposure } from "@/trade-access/exposure-limit";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

// Test values only: these prices exercise the plumbing; they are not market data.
const WED = Date.parse("2026-11-11T10:00:00Z");
const base: RuleSet = { startingBalance: 100000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const rules: RuleSet = { ...base, maxOpenLots: 3, maxOpenTrades: 3 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eurusd: [number, number] = [1.08, 1.0801]): QuoteBook => ({ EURUSD: q("EURUSD", eurusd[0], eurusd[1], time), GBPUSD: q("GBPUSD", 1.25, 1.2501, time) });
const ctxAt = (now: number, quotes: QuoteBook = book(now), r: RuleSet = rules): EngineContext => ({ specs, quotes, rules: r, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}` });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };

describe("counting what is open", () => {
  it("adds open trades and waiting orders; a linked pair counts once at its larger leg", () => {
    expect(exposureUse({ positions: [], orders: [] })).toEqual({ lots: 0, trades: 0 });
    expect(exposureUse({ positions: [{ lots: 0.1 }, { lots: 0.2 }], orders: [{ id: "a", lots: 0.3 }] })).toEqual({ lots: 0.6, trades: 3 }); // no float drift
    expect(exposureUse({ positions: [{ lots: 1 }], orders: [{ id: "a", lots: 0.5, ocoWith: "b" }, { id: "b", lots: 2, ocoWith: "a" }] })).toEqual({ lots: 3, trades: 2 });
    // A one-sided link (should not happen) counts both orders: never undercount.
    expect(exposureUse({ positions: [], orders: [{ id: "a", lots: 1, ocoWith: "b" }, { id: "b", lots: 1 }] })).toEqual({ lots: 2, trades: 2 });
  });

  it("only a measure that grows can break a limit (lowering a limit never traps an account)", () => {
    const limits = { maxOpenLots: 2, maxOpenTrades: 2 };
    expect(exposureBreach({ lots: 1.5, trades: 1 }, { lots: 2, trades: 2 }, limits)).toBeNull(); // exactly at the limits
    expect(exposureBreach({ lots: 1.5, trades: 1 }, { lots: 2.01, trades: 2 }, limits)).toMatchObject({ measure: "lots", limit: 2, before: 1.5, after: 2.01 });
    expect(exposureBreach({ lots: 1.5, trades: 1 }, { lots: 2.01, trades: 2 }, limits)!.message).toMatch(/at most 2\.00 lots open at once .* You have 1\.50 lots; this would make 2\.01 lots, so the most you can add now is 0\.50 lots\. Nothing was sent\./);
    expect(exposureBreach({ lots: 1, trades: 2 }, { lots: 1.5, trades: 3 }, limits)).toMatchObject({ measure: "trades" });
    expect(exposureBreach({ lots: 5, trades: 5 }, { lots: 5, trades: 4 }, limits)).toBeNull(); // already above, nothing grows
    expect(exposureBreach({ lots: 5, trades: 1 }, { lots: 9, trades: 2 }, null)).toBeNull();
  });

  it("reads only valid limits", () => {
    expect(exposureLimits(null)).toBeNull();
    expect(exposureLimits({})).toBeNull();
    expect(exposureLimits({ maxOpenLots: 5 })).toEqual({ maxOpenLots: 5 });
    expect(exposureLimits({ maxOpenLots: 0, maxOpenTrades: 2.5 })).toBeNull();
    expect(exposureLimits({ maxOpenLots: "5", maxOpenTrades: 10 })).toEqual({ maxOpenTrades: 10 });
    expect(exposureRuleText({ maxOpenLots: 5, maxOpenTrades: 1 })).toBe("up to 5.00 lots and up to 1 trade open at once (waiting orders count; a linked pair counts once)");
  });
});

describe("limits from the purchased rules", () => {
  const ok = { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 };
  it("missing, null or empty = no limit; numbers or number text are read", () => {
    const r = rulesFromPurchase(10000, ok);
    expect("maxOpenLots" in r || "maxOpenTrades" in r).toBe(false);
    expect(rulesFromPurchase(10000, { ...ok, max_open_lots: null, max_open_trades: "" })).not.toHaveProperty("maxOpenLots");
    expect(rulesFromPurchase(10000, { ...ok, max_open_lots: "10", max_open_trades: 5 })).toMatchObject({ maxOpenLots: 10, maxOpenTrades: 5 });
    expect(rulesFromPurchase(10000, { ...ok, max_open_lots: 2.5 })).toMatchObject({ maxOpenLots: 2.5 });
  });
  it("unclear values are refused so the account goes to review", () => {
    for (const bad of [0, -1, "abc", 2.555, 20000, true]) expect(() => rulesFromPurchase(10000, { ...ok, max_open_lots: bad as number })).toThrow(/Maximum open lots/);
    for (const bad of [0, 1.5, "x", 501]) expect(() => rulesFromPurchase(10000, { ...ok, max_open_trades: bad as number })).toThrow(/Maximum open trades/);
  });
});

describe("engine core", () => {
  const fresh = (): AccountState => newAccount("acc_1", rules, WED);

  it("refuses a market order past the lot limit with nothing changed; at the limit it opens", () => {
    let s = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 2 }, ctxAt(WED)).state;
    expect(code(() => placeOrder(s, { symbol: "GBPUSD", side: "sell", type: "market", lots: 1.01 }, ctxAt(WED)))).toBe("exposure_limit");
    s = placeOrder(s, { symbol: "GBPUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED)).state;
    expect(s.positions).toHaveLength(2);
    // Closing part of a trade frees room again.
    s = closePosition(s, s.positions[0].id, 0.5, ctxAt(WED)).state;
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 }, ctxAt(WED)))).toBe("ok");
  });

  it("waiting orders count, so they always fill; cancelling frees room", () => {
    let s = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "limit", lots: 2, price: 1.07 }, ctxAt(WED)).state;
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1.5 }, ctxAt(WED)))).toBe("exposure_limit");
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED)).state;
    // The limit price is reached: the waiting order fills although 3 lots are now open.
    const t = WED + 1000;
    s = tick(s, ctxAt(t, book(t, [1.0699, 1.07]))).state;
    expect(s.orders).toHaveLength(0);
    expect(s.positions.map(p => p.lots).sort()).toEqual([1, 2]);
    const c = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "limit", lots: 3, price: 1.07 }, ctxAt(WED)).state;
    expect(code(() => placeOrder(c, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.01 }, ctxAt(WED)))).toBe("exposure_limit");
    expect(code(() => placeOrder(cancelOrder(c, c.orders[0].id).state, { symbol: "EURUSD", side: "buy", type: "market", lots: 3 }, ctxAt(WED)))).toBe("ok");
  });

  it("a linked (one cancels the other) pair counts once; unlinking that would break a limit is refused", () => {
    let s = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "stop", lots: 2, price: 1.09 }, ctxAt(WED)).state;
    const first = s.orders[0].id;
    // Unlinked, a second 2-lot order would make 4 lots.
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "sell", type: "stop", lots: 2, price: 1.07 }, ctxAt(WED)))).toBe("exposure_limit");
    s = placeOrder(s, { symbol: "EURUSD", side: "sell", type: "stop", lots: 2, price: 1.07, ocoWith: first }, ctxAt(WED)).state;
    expect(exposureUse(s)).toEqual({ lots: 2, trades: 1 });
    // A larger linked leg takes the larger volume: 1 lot linked with a 3-lot order counts 3.
    const big = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 }, ctxAt(WED)).state;
    expect(code(() => placeOrder(big, { symbol: "EURUSD", side: "sell", type: "limit", lots: 3, price: 1.09, ocoWith: big.orders[0].id }, ctxAt(WED)))).toBe("ok");
    expect(code(() => placeOrder(big, { symbol: "EURUSD", side: "sell", type: "limit", lots: 3.01, price: 1.09, ocoWith: big.orders[0].id }, ctxAt(WED)))).toBe("exposure_limit");
    expect(code(() => modifyOrder(s, first, { ocoWith: null }, ctxAt(WED)))).toBe("exposure_limit");
    // Other changes to a linked order still work.
    expect(code(() => modifyOrder(s, first, { price: 1.095 }, ctxAt(WED)))).toBe("ok");
  });

  it("the trade-count limit, and accounts without limits behave as before", () => {
    let s = fresh();
    for (let i = 0; i < 3; i++) s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.01 }, ctxAt(WED)).state;
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.01, price: 1.07 }, ctxAt(WED)))).toBe("exposure_limit");
    let free = newAccount("acc_2", base, WED);
    for (let i = 0; i < 6; i++) free = placeOrder(free, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED, book(WED), base)).state;
    expect(free.positions).toHaveLength(6);
  });

  it("an idempotent replay is not refused by the limit", () => {
    const s = placeOrder(fresh(), { symbol: "EURUSD", side: "buy", type: "market", lots: 3, clientId: "c1" }, ctxAt(WED)).state;
    expect(placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 3, clientId: "c1" }, ctxAt(WED)).state).toBe(s);
  });
});

describe("terminal helpers", () => {
  const state = { positions: [{ lots: 1 }], orders: [{ id: "o1", lots: 1.5 }] };
  it("reads the limits from the snapshot only", () => {
    expect(exposureRule(null)).toBeNull();
    expect(exposureRule({})).toBeNull();
    expect(exposureRule({ exposure: { maxOpenLots: 3 } })).toEqual({ maxOpenLots: 3 });
    expect(ticketExposure({ state }, { lots: 1, type: "market" })).toBeNull();
  });
  it("shows usage, the usage after the order, warns near the limit and explains a refusal", () => {
    const t = ticketExposure({ state, exposure: { maxOpenLots: 5, maxOpenTrades: 10 } }, { lots: 0.5, type: "market" })!;
    expect(t.breach).toBeNull();
    expect(t.warn).toBe(false);
    expect(t.text).toBe("Open at once on this account: 2.50 of 5.00 lots · 2 of 10 trades (open trades and waiting orders count; after this order 3.00 lots · 3 trades).");
    expect(ticketExposure({ state, exposure: { maxOpenLots: 3 } }, { lots: 0.1, type: "market" })!.warn).toBe(true);
    const over = ticketExposure({ state, exposure: { maxOpenLots: 3 } }, { lots: 1, type: "limit" })!;
    expect(over.breach?.measure).toBe("lots");
    expect(over.text).toMatch(/^This account allows at most 3\.00 lots open at once .* the most you can add now is 0\.50 lots\.$/);
    // Linked with the waiting 1.5-lot order, a 1-lot order adds nothing.
    const linked = ticketExposure({ state, exposure: { maxOpenLots: 3 } }, { lots: 1, type: "stop", ocoWith: "o1" })!;
    expect(linked.breach).toBeNull();
    expect(linked.text).not.toMatch(/after this order/);
  });
});

describe("server and terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(WED)); });
  afterEach(() => { vi.useRealTimers(); });

  it("HTTP contract: snapshot carries exposure, an order past a limit is 409 exposure_limit", async () => {
    const now = WED;
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async id => (id === "acc_9" ? rules : base), feed, accounts: async () => ["acc_9"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      clock: () => now, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    const first = await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    expect((first.body as { exposure?: unknown }).exposure).toEqual({ maxOpenLots: 3, maxOpenTrades: 3 });
    expect((await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 3 } })).status).toBe(200);
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 0.01 } });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string; message: string } }).error).toMatchObject({ code: "exposure_limit", message: expect.stringMatching(/at most 3\.00 lots open at once/) });
    const other = await server.handle({ method: "GET", path: "/v1/accounts/acc_free", headers: auth });
    expect(other.body).not.toHaveProperty("exposure");
    await server.stop();
  });

  it("terminal: usage under the volume, Confirm locked past a limit, and the Account rules line", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 100000, balance: 100000, equity: 100000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 2.95 });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const note = await screen.findByTestId("exposure-note");
    // The panel starts at 0.10 lots: 2.95 + 0.10 would pass 3.00.
    expect(note).toHaveTextContent(/at most 3\.00 lots open at once .* You have 2\.95 lots; this would make 3\.05 lots, so the most you can add now is 0\.05 lots\./);
    await waitFor(() => expect(screen.getByTestId("buy-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("buy-button"));
    const review = await screen.findByTestId("order-review");
    await waitFor(() => expect(review).toHaveTextContent(/at most 3\.00 lots open at once.*This order was not sent\./));
    expect(screen.queryByTestId("confirm-order")).toBeNull();
    // 0.05 lots fits: usage is shown and Confirm is available.
    fireEvent.change(screen.getByLabelText("Volume (lots)"), { target: { value: "0.05" } });
    await waitFor(() => expect(screen.getByTestId("exposure-note")).toHaveTextContent("Open at once on this account: 2.95 of 3.00 lots · 1 of 3 trades (open trades and waiting orders count; after this order 3.00 lots · 2 trades)."));
    expect(await screen.findByTestId("confirm-order")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Account" })); });
    await waitFor(() => expect(screen.getByTestId("trade-rules")).toHaveTextContent("Open at once" + "up to 3.00 lots and up to 3 trades open at once"));
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, Quote, QuoteBook, RuleSet } from "@/engine/types";
import type { EngineError } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { closePosition, modifyOrder, modifyPosition, newAccount, placeOrder, riskAtStop, tick, type EngineContext } from "@/engine/core";
import { changeRiskProblem, newOrderRiskProblem, riskCapUsd, tradeRiskRule, tradeRiskRuleText, validRiskPercent } from "@/engine/trade-risk";
import { editorRiskProblem, ticketRiskRule, tradeRiskFromSnapshot } from "@/trade-access/trade-risk";
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
const slOnly: RuleSet = { ...base, stopLossRequired: true };
const capped: RuleSet = { ...base, stopLossRequired: true, maxRiskPercent: 1 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eurusd: [number, number] = [1.08, 1.0801]): QuoteBook => ({ EURUSD: q("EURUSD", eurusd[0], eurusd[1], time), GBPUSD: q("GBPUSD", 1.25, 1.2501, time) });
const ctxAt = (now: number, r: RuleSet, quotes: QuoteBook = book(now)): EngineContext => ({ specs, quotes, rules: r, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}` });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };
const msg = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as Error).message; } return ""; };

describe("the rule", () => {
  it("accepts 0.1–10 % with at most two decimals", () => {
    for (const ok of [0.1, 0.5, 1, 1.25, 2, 10]) expect(validRiskPercent(ok)).toBe(true);
    for (const bad of [0, 0.09, 10.01, 1.255, -1, NaN, Infinity, "1", null]) expect(validRiskPercent(bad)).toBe(false);
  });

  it("reads only valid rules; a cap always means a stop loss is required", () => {
    expect(tradeRiskRule(null)).toBeNull();
    expect(tradeRiskRule({})).toBeNull();
    expect(tradeRiskRule({ stopLossRequired: false })).toBeNull();
    expect(tradeRiskRule({ stopLossRequired: "true" })).toBeNull();
    expect(tradeRiskRule({ stopLossRequired: true })).toEqual({ stopLossRequired: true });
    expect(tradeRiskRule({ maxRiskPercent: 2 })).toEqual({ stopLossRequired: true, maxRiskPercent: 2 });
    expect(tradeRiskRule({ stopLossRequired: true, maxRiskPercent: 50 })).toEqual({ stopLossRequired: true });
  });

  it("the dollar cap is rounded down to the cent", () => {
    expect(riskCapUsd({ stopLossRequired: true, maxRiskPercent: 1 }, 100000)).toBe(1000);
    expect(riskCapUsd({ stopLossRequired: true, maxRiskPercent: 1 }, 99996.5)).toBe(999.96);
    expect(riskCapUsd({ stopLossRequired: true, maxRiskPercent: 0.25 }, 12345.67)).toBe(30.86);
    expect(riskCapUsd({ stopLossRequired: true }, 100000)).toBeNull();
    expect(riskCapUsd({ stopLossRequired: true, maxRiskPercent: 1 }, 0)).toBeNull();
    expect(riskCapUsd(null, 100000)).toBeNull();
  });

  it("plain rule text", () => {
    expect(tradeRiskRuleText({ stopLossRequired: true })).toBe("Every order needs a stop loss; a stop loss can be moved but not removed");
    expect(tradeRiskRuleText({ stopLossRequired: true, maxRiskPercent: 1 }, 100000)).toBe("Every order needs a stop loss, and a trade may lose at most 1% of the balance at its stop loss ($1,000.00 today); a stop loss can be moved closer but not removed");
  });

  it("new orders: no stop, unpriced, over and at the cap", () => {
    const rule = { stopLossRequired: true as const, maxRiskPercent: 1 };
    expect(newOrderRiskProblem(null, null, 100000)).toBeNull();
    expect(newOrderRiskProblem({ stopLossRequired: true }, null, 100000)).toMatch(/needs a stop loss on every order/);
    expect(newOrderRiskProblem({ stopLossRequired: true }, { priced: true, amount: 99999 }, 100000)).toBeNull();
    expect(newOrderRiskProblem(rule, { priced: false, amount: 0 }, 100000)).toMatch(/cannot be worked out in dollars yet/);
    expect(newOrderRiskProblem(rule, { priced: true, amount: 1000 }, 100000)).toBeNull();
    expect(newOrderRiskProblem(rule, { priced: true, amount: 1010 }, 100000)).toBe("This order would lose $1,010.00 at its stop loss (1.01% of the $100,000.00 balance); this account allows at most 1% ($1,000.00) per trade. Move the stop loss closer or lower the volume. Nothing was sent.");
  });

  it("changes: a stop can be moved but not removed; tightening is always allowed", () => {
    const rule = { stopLossRequired: true as const, maxRiskPercent: 1 };
    const r = (amount: number) => ({ priced: true, amount });
    expect(changeRiskProblem(rule, r(500), null, 100000, "trade")).toMatch(/every trade: it can be moved, not removed/);
    expect(changeRiskProblem(rule, null, null, 100000, "trade")).toBeNull(); // a trade without a stop (opened before the rule) keeps working
    expect(changeRiskProblem(rule, null, r(2000), 100000, "trade")).toMatch(/would lose \$2,000\.00/);
    expect(changeRiskProblem(rule, null, r(800), 100000, "trade")).toBeNull();
    expect(changeRiskProblem(rule, r(1500), r(1200), 100000, "trade")).toBeNull(); // tighter, still over the cap
    expect(changeRiskProblem(rule, r(800), r(1200), 100000, "order")).toMatch(/^With this stop loss the order would lose \$1,200\.00/);
    expect(changeRiskProblem({ stopLossRequired: true }, r(800), r(5000), 100000, "trade")).toBeNull();
  });
});

describe("rules from the purchase", () => {
  const ok = { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 };
  it("missing = today's behaviour; true / percent text are read; a cap implies the stop loss", () => {
    const r = rulesFromPurchase(10000, ok);
    expect("stopLossRequired" in r || "maxRiskPercent" in r).toBe(false);
    expect(rulesFromPurchase(10000, { ...ok, stop_loss_required: false, max_risk_per_trade_percent: "" })).not.toHaveProperty("stopLossRequired");
    expect(rulesFromPurchase(10000, { ...ok, stop_loss_required: "true" })).toMatchObject({ stopLossRequired: true });
    expect(rulesFromPurchase(10000, { ...ok, stop_loss_required: true })).not.toHaveProperty("maxRiskPercent");
    expect(rulesFromPurchase(10000, { ...ok, max_risk_per_trade_percent: "1.5%" })).toMatchObject({ stopLossRequired: true, maxRiskPercent: 1.5 });
    expect(rulesFromPurchase(10000, { ...ok, stop_loss_required: false, max_risk_per_trade_percent: 2 })).toMatchObject({ stopLossRequired: true, maxRiskPercent: 2 });
  });
  it("unclear values are refused so the account goes to review", () => {
    for (const bad of ["yes", 1, "TRUE "]) expect(() => rulesFromPurchase(10000, { ...ok, stop_loss_required: bad as unknown as boolean })).toThrow(/Stop loss required must be true or false/);
    for (const bad of [0, 11, "abc", 1.234, true]) expect(() => rulesFromPurchase(10000, { ...ok, max_risk_per_trade_percent: bad as unknown as number })).toThrow(/Maximum risk per trade must be a percent from 0.1 to 10/);
  });
});

describe("engine core", () => {
  const fresh = (r: RuleSet): AccountState => newAccount("acc_1", r, WED);

  it("measures the loss at the stop from the entry (0 at break-even or better)", () => {
    const s = specs.EURUSD;
    expect(riskAtStop(s, "buy", 1, 1.0801, undefined, book(WED))).toBeNull();
    expect(riskAtStop(s, "buy", 1, 1.0801, 1.0701, book(WED))).toEqual({ priced: true, amount: 1000 });
    expect(riskAtStop(s, "sell", 1, 1.08, 1.079, book(WED))).toEqual({ priced: true, amount: 0 });
    // USDJPY needs a USDJPY price to turn yen into dollars.
    expect(riskAtStop(specs.USDJPY, "buy", 1, 150, 149, book(WED))).toEqual({ priced: false, amount: 0 });
  });

  it("stop loss required: market and pending orders without a stop are refused; with one they go", () => {
    const s = fresh(slOnly);
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED, slOnly)))).toBe("risk_limit");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 }, ctxAt(WED, slOnly)))).toBe("risk_limit");
    // A trailing stop alone is not a stop loss: it only starts once the trade is in profit.
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, trailingPips: 20 }, ctxAt(WED, slOnly)))).toBe("risk_limit");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 20, stopLoss: 1.0 }, ctxAt(WED, slOnly)))).toBe("ok");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07, stopLoss: 1.06 }, ctxAt(WED, slOnly)))).toBe("ok");
    // Accounts without the rule behave as before.
    expect(code(() => placeOrder(fresh(base), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED, base)))).toBe("ok");
  });

  it("maximum risk: measured from the fill price for market orders and the order price for pending ones", () => {
    const s = fresh(capped);
    // Buy fills at the ask 1.0801: 100 pips on 1 lot = $1,000 = exactly 1 % of $100,000.
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.0701 }, ctxAt(WED, capped)))).toBe("ok");
    expect(msg(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.07 }, ctxAt(WED, capped)))).toMatch(/would lose \$1,010\.00 at its stop loss \(1\.01% of the \$100,000\.00 balance\)/);
    // A buy limit at 1.0700 with the stop 100 pips lower is fine, though the market is higher.
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07, stopLoss: 1.06 }, ctxAt(WED, capped)))).toBe("ok");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07, stopLoss: 1.0599 }, ctxAt(WED, capped)))).toBe("risk_limit");
    // No conversion price yet (USDJPY not quoted): refused rather than guessed.
    const jpy: QuoteBook = { ...book(WED) };
    expect(code(() => placeOrder(s, { symbol: "USDJPY", side: "buy", type: "market", lots: 0.1, stopLoss: 149 }, ctxAt(WED, capped, jpy)))).not.toBe("ok");
  });

  it("open trades: the stop can move closer, to break-even or beyond, never be removed or widened past the cap", () => {
    let s = placeOrder(fresh(capped), { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.0751, takeProfit: 1.09 }, ctxAt(WED, capped)).state;
    const id = s.positions[0].id;
    expect(code(() => modifyPosition(s, id, { stopLoss: null }, ctxAt(WED, capped)))).toBe("risk_limit");
    expect(msg(() => modifyPosition(s, id, { stopLoss: null }, ctxAt(WED, capped)))).toMatch(/every trade: it can be moved, not removed/);
    expect(code(() => modifyPosition(s, id, { stopLoss: 1.069 }, ctxAt(WED, capped)))).toBe("risk_limit"); // 111 pips > $999.96 cap
    expect(code(() => modifyPosition(s, id, { takeProfit: null }, ctxAt(WED, capped)))).toBe("ok"); // other changes still work
    s = modifyPosition(s, id, { stopLoss: 1.0711 }, ctxAt(WED, capped)).state; // 90 pips, widened but within the cap
    expect(s.positions[0].stopLoss).toBe(1.0711);
    // The price rises: break-even and a profit-locking stop are always allowed.
    const t = WED + 1000, up = book(t, [1.086, 1.0861]);
    s = tick(s, ctxAt(t, capped, up)).state;
    expect(code(() => modifyPosition(s, id, { stopLoss: 1.0801 }, ctxAt(t, capped, up)))).toBe("ok");
    expect(code(() => modifyPosition(s, id, { stopLoss: 1.083 }, ctxAt(t, capped, up)))).toBe("ok");
    // Closing part of the trade is never refused.
    expect(code(() => closePosition(s, id, 0.5, ctxAt(t, capped, up)))).toBe("ok");
  });

  it("a trade opened without a stop before the rule is not trapped; a tighter stop over the cap is allowed", () => {
    const s = placeOrder(fresh(base), { symbol: "EURUSD", side: "buy", type: "market", lots: 5 }, ctxAt(WED, base)).state;
    const id = s.positions[0].id;
    expect(code(() => modifyPosition(s, id, { takeProfit: 1.09 }, ctxAt(WED, capped)))).toBe("ok");
    expect(code(() => modifyPosition(s, id, { stopLoss: 1.0601 }, ctxAt(WED, capped)))).toBe("risk_limit"); // $10,000 > $1,000
    const withStop = modifyPosition(s, id, { stopLoss: 1.0601 }, ctxAt(WED, base)).state;
    expect(code(() => modifyPosition(withStop, id, { stopLoss: 1.0701 }, ctxAt(WED, capped)))).toBe("ok"); // tighter, still $5,000
  });

  it("pending orders: moving the price or the stop is checked, removing the stop is refused", () => {
    const s = placeOrder(fresh(capped), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07, stopLoss: 1.065 }, ctxAt(WED, capped)).state;
    const id = s.orders[0].id;
    expect(code(() => modifyOrder(s, id, { stopLoss: null }, ctxAt(WED, capped)))).toBe("risk_limit");
    expect(code(() => modifyOrder(s, id, { stopLoss: 1.0599 }, ctxAt(WED, capped)))).toBe("risk_limit");
    expect(code(() => modifyOrder(s, id, { stopLoss: 1.06 }, ctxAt(WED, capped)))).toBe("ok");
    // Moving the order price up 60 pips makes the same stop 110 pips away.
    expect(code(() => modifyOrder(s, id, { price: 1.076 }, ctxAt(WED, capped)))).toBe("risk_limit");
    expect(code(() => modifyOrder(s, id, { price: 1.074 }, ctxAt(WED, capped)))).toBe("ok"); // 90 pips
    expect(code(() => modifyOrder(s, id, { takeProfit: 1.09 }, ctxAt(WED, capped)))).toBe("ok");
  });

  it("fills are never refused, even when the order now risks more than the cap", () => {
    let s = placeOrder(fresh(capped), { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07, stopLoss: 1.06 }, ctxAt(WED, capped)).state;
    // The cap is now 0.5 % ($500), below the order's $1,000 risk: it still fills.
    const t = WED + 1000, lower: RuleSet = { ...capped, maxRiskPercent: 0.5 };
    s = tick(s, ctxAt(t, lower, book(t, [1.0699, 1.07]))).state;
    expect(s.orders).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
  });
});

describe("terminal helpers", () => {
  it("reads the rule from the snapshot only", () => {
    expect(tradeRiskFromSnapshot(null)).toBeNull();
    expect(tradeRiskFromSnapshot({})).toBeNull();
    expect(tradeRiskFromSnapshot({ tradeRisk: { stopLossRequired: true, maxRiskPercent: 1 } })).toEqual({ stopLossRequired: true, maxRiskPercent: 1 });
    expect(ticketRiskRule({}, { slPips: null, risk: null, balance: 100000 })).toBeNull();
  });

  it("order panel: locks without a stop or over the cap, warns near it", () => {
    const snap = { tradeRisk: { stopLossRequired: true, maxRiskPercent: 1 } };
    const none = ticketRiskRule(snap, { slPips: null, risk: null, balance: 100000 })!;
    expect(none.blocks).toBe(true);
    expect(none.text).toBe("This account needs a stop loss on every order, risking at most 1% of the balance ($1,000.00) at the stop loss. Enter a stop loss in pips to continue.");
    const over = ticketRiskRule(snap, { slPips: 150, risk: 1500, balance: 100000 })!;
    expect(over.blocks).toBe(true);
    expect(over.text).toMatch(/^This order would lose \$1,500\.00 at its stop loss \(1\.5% of the balance\)/);
    const near = ticketRiskRule(snap, { slPips: 90, risk: 900, balance: 100000 })!;
    expect(near).toMatchObject({ blocks: false, warn: true, cap: 1000 });
    expect(near.text).toBe("Risk at the stop loss $900.00 (0.9%) of the $1,000.00 allowed per trade on this account. The trading server checks it again at the fill price.");
    expect(ticketRiskRule(snap, { slPips: 20, risk: 200, balance: 100000 })).toMatchObject({ blocks: false, warn: false });
    expect(ticketRiskRule(snap, { slPips: 20, risk: null, balance: 100000 })!.text).toMatch(/checks it when the order arrives/);
    expect(ticketRiskRule({ tradeRisk: { stopLossRequired: true } }, { slPips: 20, risk: 5000, balance: 100000 })).toMatchObject({ blocks: false });
  });

  it("editors: same decisions as the server", () => {
    const rule = { stopLossRequired: true as const, maxRiskPercent: 1 };
    expect(editorRiskProblem(rule, { hasStop: true, risk: 500 }, { hasStop: false, risk: null }, 100000, "trade")).toMatch(/can be moved, not removed/);
    expect(editorRiskProblem(rule, { hasStop: true, risk: 500 }, { hasStop: true, risk: 1200 }, 100000, "trade")).toMatch(/would lose \$1,200\.00 \(1\.2% of the balance\)/);
    expect(editorRiskProblem(rule, { hasStop: true, risk: 1500 }, { hasStop: true, risk: 1200 }, 100000, "trade")).toBeNull();
    expect(editorRiskProblem(rule, { hasStop: false, risk: null }, { hasStop: false, risk: null }, 100000, "order")).toBeNull();
    expect(editorRiskProblem(null, { hasStop: true, risk: 1 }, { hasStop: false, risk: null }, 100000, "trade")).toBeNull();
  });
});

describe("server and terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(WED)); });
  afterEach(() => { vi.useRealTimers(); });

  it("HTTP contract: snapshot carries tradeRisk, an order without a stop is 409 risk_limit", async () => {
    const now = WED;
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async id => (id === "acc_9" ? capped : base), feed, accounts: async () => ["acc_9"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      clock: () => now, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    const first = await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    expect((first.body as { tradeRisk?: unknown }).tradeRisk).toEqual({ stopLossRequired: true, maxRiskPercent: 1 });
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string; message: string } }).error).toMatchObject({ code: "risk_limit", message: expect.stringMatching(/needs a stop loss on every order/) });
    expect((await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.0751 } })).status).toBe(200);
    const other = await server.handle({ method: "GET", path: "/v1/accounts/acc_free", headers: auth });
    expect(other.body).not.toHaveProperty("tradeRisk");
    await server.stop();
  });

  it("terminal: stop loss marked required, Confirm locked without a stop or over the cap, and the Account rules line", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 100000, balance: 100000, equity: 100000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => capped, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const note = await screen.findByTestId("trade-risk-note");
    expect(note).toHaveTextContent("This account needs a stop loss on every order, risking at most 1% of the balance ($1,000.00) at the stop loss. Enter a stop loss in pips to continue.");
    const slInput = screen.getByLabelText(/Stop loss \(pips\)/);
    expect(slInput).toHaveAttribute("placeholder", "Required");
    await waitFor(() => expect(screen.getByTestId("buy-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("buy-button"));
    const review = await screen.findByTestId("order-review");
    await waitFor(() => expect(review).toHaveTextContent(/needs a stop loss on every order.*This order was not sent\./));
    expect(screen.queryByTestId("confirm-order")).toBeNull();
    // 0.10 lots × 1,500 pips = $1,500: over the $1,000 cap.
    fireEvent.change(slInput, { target: { value: "1500" } });
    await waitFor(() => expect(screen.getByTestId("trade-risk-note")).toHaveTextContent(/This order would lose \$1,500\.00 at its stop loss/));
    expect(screen.queryByTestId("confirm-order")).toBeNull();
    // 500 pips = $500: allowed.
    fireEvent.change(slInput, { target: { value: "500" } });
    await waitFor(() => expect(screen.getByTestId("trade-risk-note")).toHaveTextContent("Risk at the stop loss $500.00 (0.5%) of the $1,000.00 allowed per trade on this account."));
    expect(await screen.findByTestId("confirm-order")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Account" })); });
    await waitFor(() => expect(screen.getByTestId("trade-rules")).toHaveTextContent("Stop loss" + "Every order needs a stop loss, and a trade may lose at most 1% of the balance at its stop loss ($1,000.00 today)"));
  });
});

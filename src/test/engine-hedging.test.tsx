import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, EngineError, Quote, QuoteBook, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { createEngineServer } from "@/engine/server";
import { cancelOrder, closePosition, modifyOrder, modifyPosition, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import { HEDGING_RULE_TEXT, hedgeHoldsFill, hedgeMessage, hedgeProblem, noHedging, oppositeOpen } from "@/engine/hedging";
import { hedgeHold, hedgingOff, ticketHedge } from "@/trade-access/hedging";
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
const noHedge: RuleSet = { ...base, hedgingAllowed: false };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
let seq = 0;
const q = (symbol: string, bid: number, ask: number, time: number): Quote => ({ symbol, bid, ask, time });
const book = (time: number, eurusd: [number, number] = [1.08, 1.0801]): QuoteBook => ({ EURUSD: q("EURUSD", eurusd[0], eurusd[1], time), GBPUSD: q("GBPUSD", 1.25, 1.2501, time) });
const ctxAt = (now: number, r: RuleSet, quotes: QuoteBook = book(now)): EngineContext => ({ specs, quotes, rules: r, now, maxQuoteAgeMs: 60_000, newId: p => `${p}_${++seq}` });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };
const msg = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as Error).message; } return ""; };
const fresh = (r: RuleSet): AccountState => newAccount("acc_1", r, WED);

describe("the rule", () => {
  it("only an explicit false forbids hedging", () => {
    expect(noHedging(null)).toBe(false);
    expect(noHedging({})).toBe(false);
    expect(noHedging({ hedgingAllowed: true })).toBe(false);
    expect(noHedging({ hedgingAllowed: "false" })).toBe(false);
    expect(noHedging({ hedgingAllowed: false })).toBe(true);
  });

  it("finds open trades in the other direction on the same pair only", () => {
    const positions = [
      { symbol: "EURUSD", side: "buy" as const, lots: 0.5 },
      { symbol: "EURUSD", side: "buy" as const, lots: 0.25 },
      { symbol: "GBPUSD", side: "sell" as const, lots: 1 },
    ];
    expect(oppositeOpen(positions, "EURUSD", "sell")).toEqual({ symbol: "EURUSD", side: "buy", trades: 2, lots: 0.75 });
    expect(oppositeOpen(positions, "EURUSD", "buy")).toBeNull();
    expect(oppositeOpen(positions, "GBPUSD", "buy")).toEqual({ symbol: "GBPUSD", side: "sell", trades: 1, lots: 1 });
    expect(oppositeOpen(positions, "USDJPY", "buy")).toBeNull();
    // Lots add up without floating-point noise.
    expect(oppositeOpen([{ symbol: "EURUSD", side: "buy", lots: 0.1 }, { symbol: "EURUSD", side: "buy", lots: 0.2 }], "EURUSD", "sell")!.lots).toBe(0.3);
  });

  it("plain messages and checks", () => {
    expect(hedgeMessage("sell", { symbol: "EURUSD", side: "buy", trades: 1, lots: 0.5 })).toBe("This account does not allow buy and sell trades on the same pair at once: EURUSD has 1 buy trade (0.50 lots) open, so a new sell order cannot be placed. Close the buy trade first, or add to it with another buy order. Nothing was sent.");
    const open = [{ symbol: "EURUSD", side: "buy" as const, lots: 0.5 }];
    expect(hedgeProblem(base, open, "EURUSD", "sell")).toBeNull();
    expect(hedgeProblem(noHedge, open, "EURUSD", "buy")).toBeNull();
    expect(hedgeProblem(noHedge, open, "EURUSD", "sell")).toMatch(/^This account does not allow buy and sell trades/);
    expect(hedgeHoldsFill(noHedge, open, { symbol: "EURUSD", side: "sell" })).toBe(true);
    expect(hedgeHoldsFill(noHedge, open, { symbol: "EURUSD", side: "buy" })).toBe(false);
    expect(hedgeHoldsFill(base, open, { symbol: "EURUSD", side: "sell" })).toBe(false);
    expect(HEDGING_RULE_TEXT).toMatch(/^Not allowed: each pair can hold buy trades or sell trades, not both at once/);
  });
});

describe("rules from the purchase", () => {
  const ok = { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 };
  it("missing or true = today's behaviour; false (or \"false\") forbids hedging", () => {
    expect(rulesFromPurchase(10000, ok)).not.toHaveProperty("hedgingAllowed");
    expect(rulesFromPurchase(10000, { ...ok, hedging_allowed: true })).not.toHaveProperty("hedgingAllowed");
    expect(rulesFromPurchase(10000, { ...ok, hedging_allowed: "true" })).not.toHaveProperty("hedgingAllowed");
    expect(rulesFromPurchase(10000, { ...ok, hedging_allowed: false })).toMatchObject({ hedgingAllowed: false });
    expect(rulesFromPurchase(10000, { ...ok, hedging_allowed: "false" })).toMatchObject({ hedgingAllowed: false });
  });
  it("unclear values are refused so the account goes to review", () => {
    for (const bad of ["no", 0, 1, "FALSE "]) expect(() => rulesFromPurchase(10000, { ...ok, hedging_allowed: bad as unknown as boolean })).toThrow(/Hedging allowed must be true or false/);
  });
});

describe("engine", () => {
  it("without the rule nothing changes: a buy and a sell on one pair can be open together", () => {
    let s = placeOrder(fresh(base), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED, base)).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED, base)).state;
    expect(s.positions.map(p => p.side)).toEqual(["buy", "sell"]);
  });

  it("refuses a market or pending order against an open trade; same direction and other pairs are fine", () => {
    const s = placeOrder(fresh(noHedge), { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 }, ctxAt(WED, noHedge)).state;
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED, noHedge)))).toBe("hedging");
    expect(msg(() => placeOrder(s, { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED, noHedge)))).toMatch(/EURUSD has 1 buy trade \(0\.50 lots\) open, so a new sell order cannot be placed/);
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "sell", type: "limit", lots: 1, price: 1.09 }, ctxAt(WED, noHedge)))).toBe("hedging");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "sell", type: "stop", lots: 1, price: 1.07 }, ctxAt(WED, noHedge)))).toBe("hedging");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED, noHedge)))).toBe("ok");
    expect(code(() => placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 }, ctxAt(WED, noHedge)))).toBe("ok");
    expect(code(() => placeOrder(s, { symbol: "GBPUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED, noHedge)))).toBe("ok");
    // A refused order records nothing.
    try { placeOrder(s, { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED, noHedge)); } catch { /* refused */ }
    expect(s.positions).toHaveLength(1);
  });

  it("closing, changing stops and cancelling are never refused", () => {
    let s = placeOrder(fresh(noHedge), { symbol: "EURUSD", side: "buy", type: "market", lots: 1 }, ctxAt(WED, noHedge)).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 }, ctxAt(WED, noHedge)).state;
    const pid = s.positions[0].id, oid = s.orders[0].id;
    expect(code(() => modifyPosition(s, pid, { stopLoss: 1.075, takeProfit: 1.09 }, ctxAt(WED, noHedge)))).toBe("ok");
    expect(code(() => modifyOrder(s, oid, { price: 1.071 }, ctxAt(WED, noHedge)))).toBe("ok");
    expect(code(() => cancelOrder(s, oid))).toBe("ok");
    expect(code(() => closePosition(s, pid, 0.5, ctxAt(WED, noHedge)))).toBe("ok");
    const closed = closePosition(s, pid, undefined, ctxAt(WED, noHedge)).state;
    // Once flat, the other direction is open again.
    expect(code(() => placeOrder(closed, { symbol: "EURUSD", side: "sell", type: "market", lots: 1 }, ctxAt(WED, noHedge)))).toBe("ok");
  });

  it("a waiting order in the other direction is held while the trade is open, and fills on the first price after it closes", () => {
    // Bracket: sell stop below and buy stop above; both pending is allowed.
    let s = placeOrder(fresh(noHedge), { symbol: "EURUSD", side: "buy", type: "stop", lots: 1, price: 1.082 }, ctxAt(WED, noHedge)).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "sell", type: "stop", lots: 1, price: 1.078, stopLoss: 1.081 }, ctxAt(WED, noHedge)).state;
    expect(s.orders).toHaveLength(2);
    // Price rises: the buy stop fills.
    let t = WED + 1000;
    s = tick(s, ctxAt(t, noHedge, book(t, [1.0821, 1.0822]))).state;
    expect(s.positions.map(p => p.side)).toEqual(["buy"]);
    const buyId = s.positions[0].id;
    // Price falls through the sell stop while the buy is open (with a stop below, so it is not stopped out): held.
    s = modifyPosition(s, buyId, { stopLoss: 1.07 }, ctxAt(t, noHedge, book(t, [1.0821, 1.0822]))).state;
    t += 1000;
    s = tick(s, ctxAt(t, noHedge, book(t, [1.0775, 1.0776]))).state;
    expect(s.positions.map(p => p.side)).toEqual(["buy"]);
    expect(s.orders.map(o => o.side)).toEqual(["sell"]);
    // The trader closes the buy; the next price fills the sell stop at the market.
    s = closePosition(s, buyId, undefined, ctxAt(t, noHedge, book(t, [1.0775, 1.0776]))).state;
    t += 1000;
    const step = tick(s, ctxAt(t, noHedge, book(t, [1.0774, 1.0775])));
    expect(step.state.orders).toHaveLength(0);
    expect(step.state.positions).toMatchObject([{ side: "sell", entryPrice: 1.0774 }]);
    expect(step.events.some(e => e.type === "order_triggered")).toBe(true);
  });

  it("two opposite orders hit on the same price: only the first fills, the other waits", () => {
    // A sell limit and a buy stop at the same level, both reached together.
    let s = placeOrder(fresh(noHedge), { symbol: "EURUSD", side: "sell", type: "limit", lots: 1, price: 1.082 }, ctxAt(WED, noHedge)).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "stop", lots: 1, price: 1.082 }, ctxAt(WED, noHedge)).state;
    const t = WED + 1000;
    s = tick(s, ctxAt(t, noHedge, book(t, [1.0825, 1.0826]))).state;
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].side).toBe("sell");
    expect(s.orders.map(o => `${o.side} ${o.type}`)).toEqual(["buy stop"]);
  });

  it("without the rule the same orders both fill", () => {
    let s = placeOrder(fresh(base), { symbol: "EURUSD", side: "sell", type: "limit", lots: 1, price: 1.082 }, ctxAt(WED, base)).state;
    s = placeOrder(s, { symbol: "EURUSD", side: "buy", type: "stop", lots: 1, price: 1.082 }, ctxAt(WED, base)).state;
    const t = WED + 1000;
    s = tick(s, ctxAt(t, base, book(t, [1.0825, 1.0826]))).state;
    expect(s.positions).toHaveLength(2);
  });
});

describe("terminal helpers", () => {
  const snap = (positions: { symbol: string; side: "buy" | "sell"; lots: number }[], allowed: unknown = false) => ({ hedging: { allowed }, state: { positions } });
  it("reads the rule from the snapshot only", () => {
    expect(hedgingOff(null)).toBe(false);
    expect(hedgingOff({})).toBe(false);
    expect(hedgingOff({ hedging: { allowed: true } })).toBe(false);
    expect(hedgingOff({ hedging: { allowed: false } })).toBe(true);
    expect(ticketHedge({ state: { positions: [{ symbol: "EURUSD", side: "buy", lots: 1 }] } }, "EURUSD", "sell")).toBeNull();
    expect(ticketHedge(snap([]), "EURUSD", "sell")).toBeNull();
  });

  it("order panel: note for the open side, locks the other side", () => {
    const s = snap([{ symbol: "EURUSD", side: "buy", lots: 0.5 }]);
    expect(ticketHedge(s, "GBPUSD", "sell")).toBeNull();
    expect(ticketHedge(s, "EURUSD", null)).toEqual({ blocked: ["sell"], blocks: false, text: "No hedging on this account: EURUSD has 1 buy trade (0.50 lots) open, so new EURUSD orders can only be buys until it is closed." });
    expect(ticketHedge(s, "EURUSD", "buy")!.blocks).toBe(false);
    const sell = ticketHedge(s, "EURUSD", "sell")!;
    expect(sell.blocks).toBe(true);
    expect(sell.text).toBe("This account does not allow buy and sell trades on the same pair at once: EURUSD has 1 buy trade (0.50 lots) open, so a sell order cannot be placed. Close the buy trade first (Positions tab), or add to it with a buy order.");
    // Both sides open (from before the rule): nothing new on the pair.
    const both = ticketHedge(snap([{ symbol: "EURUSD", side: "buy", lots: 1 }, { symbol: "EURUSD", side: "sell", lots: 0.3 }]), "EURUSD", "buy")!;
    expect(both.blocked).toEqual(["buy", "sell"]);
    expect(both.blocks).toBe(true);
    expect(both.text).toMatch(/EURUSD has 1 buy trade \(1\.00 lots\) and 1 sell trade \(0\.30 lots\) open .* until one side is closed\./);
  });

  it("pending tab: held tag only for waiting orders against an open trade", () => {
    const s = snap([{ symbol: "EURUSD", side: "buy", lots: 0.5 }, { symbol: "EURUSD", side: "buy", lots: 0.5 }]);
    const h = hedgeHold(s, { symbol: "EURUSD", side: "sell" })!;
    expect(h).toMatchObject({ kind: "hedge", label: "Held · hedge", until: null });
    expect(h.text).toBe("Held: this account does not allow buy and sell trades on EURUSD at once, and 2 buy trades (1.00 lots) are open. This sell order stays in place but does not fill until those trades are closed; the first price after that decides the fill. You can cancel it at any time.");
    expect(hedgeHold(s, { symbol: "EURUSD", side: "buy" })).toBeNull();
    expect(hedgeHold(snap([{ symbol: "EURUSD", side: "buy", lots: 1 }], true), { symbol: "EURUSD", side: "sell" })).toBeNull();
  });
});

describe("server and terminal", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(WED)); });
  afterEach(() => { vi.useRealTimers(); });

  it("HTTP contract: snapshot carries hedging, an opposite order is 409 hedging", async () => {
    const now = WED;
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async id => (id === "acc_9" ? noHedge : base), feed, accounts: async () => ["acc_9"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      clock: () => now, rateLimits: false,
    });
    server.start();
    const auth = { authorization: "Bearer t" };
    feed.push(q("EURUSD", 1.08, 1.0801, now));
    const first = await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: auth });
    expect((first.body as { hedging?: unknown }).hedging).toEqual({ allowed: false });
    expect((await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } })).status).toBe(200);
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: auth, body: { symbol: "EURUSD", side: "sell", type: "market", lots: 1 } });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string; message: string } }).error).toMatchObject({ code: "hedging", message: expect.stringMatching(/does not allow buy and sell trades on the same pair at once/) });
    const other = await server.handle({ method: "GET", path: "/v1/accounts/acc_free", headers: auth });
    expect(other.body).not.toHaveProperty("hedging");
    await server.stop();
  });

  it("terminal: note on the pair, Confirm locked for the other side, Held tag and the Account rules line", async () => {
    const account = {
      accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
      currentPhase: 1, startingBalance: 100000, balance: 100000, equity: 100000, tradingEnabled: true, tradingHoldReason: "",
      rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 1 },
    };
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = new LocalVenue(specs, new MemoryStore(), async () => noHedge, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await v.open(account.accountId);
    // A sell stop placed first, then a buy: the sell stop waits held.
    await v.place(account.accountId, { symbol: "EURUSD", side: "sell", type: "stop", lots: 0.2, price: 1.07 });
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 0.5 });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v)} />} /></Routes></MemoryRouter>);
    const note = await screen.findByTestId("hedge-note");
    expect(note).toHaveTextContent("No hedging on this account: EURUSD has 1 buy trade (0.50 lots) open, so new EURUSD orders can only be buys until it is closed.");
    await waitFor(() => expect(screen.getByTestId("sell-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("sell-button"));
    const review = await screen.findByTestId("order-review");
    await waitFor(() => expect(review).toHaveTextContent(/so a sell order cannot be placed\..*This order was not sent\./));
    expect(screen.queryByTestId("confirm-order")).toBeNull();
    // The buy side stays open to trade.
    fireEvent.click(screen.getByTestId("buy-button"));
    expect(await screen.findByTestId("confirm-order")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Pending orders" })); });
    const held = await screen.findByText("Held · hedge");
    expect(held).toHaveAttribute("title", expect.stringMatching(/^Held: this account does not allow buy and sell trades on EURUSD at once/));
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Account" })); });
    await waitFor(() => expect(screen.getByTestId("trade-rules")).toHaveTextContent("Hedging" + HEDGING_RULE_TEXT));
  });
});

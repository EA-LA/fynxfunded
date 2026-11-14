import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAlert, alertHit, MAX_ALERTS, newAccount, removeAlert, tick, TRIGGERED_ALERTS_KEPT, type EngineContext } from "@/engine/core";
import type { AccountState, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { DisconnectedGateway, HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, parseAlertRequest, type HostOptions } from "@/engine/host";
import { EngineRunner } from "@/engine/runner";
import { FOREX_PAIRS, findPair } from "@/trade-access/instruments";
import { byDistance, firedSentence, newlyFired, pipsAway, readAlertDraft, suggestedCondition } from "@/trade-access/alerts";

const mocks = vi.hoisted(() => ({ call: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const SATURDAY = Date.parse("2026-11-07T12:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
let n = 0;
const ctx = (quotes: Quote[], now = T0): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}${++n}` });
const base = () => newAccount("a", rules, T0);
const eur = ctx([q("EURUSD", 1.08, 1.0801)]);

describe("engine: price alerts", () => {
  it("sets an alert with id, time and note, and refuses bad ones", () => {
    const step = addAlert(base(), { symbol: "EURUSD", condition: "above", price: 1.085, note: "  weekly high " }, eur);
    expect(step.state.alerts).toEqual([{ id: expect.stringMatching(/^alr/), symbol: "EURUSD", condition: "above", price: 1.085, createdAt: T0, note: "weekly high" }]);
    expect(step.state.sequence).toBe(1);
    expect(step.events).toEqual([{ type: "alert_added", alert: step.state.alerts![0] }]);
    const s = base();
    expect(() => addAlert(s, { symbol: "XXXYYY", condition: "above", price: 1 }, eur)).toThrow(/not available/);
    expect(() => addAlert(s, { symbol: "EURUSD", condition: "sideways" as "above", price: 1.09 }, eur)).toThrow(/above or below/);
    expect(() => addAlert(s, { symbol: "EURUSD", condition: "above", price: 0 }, eur)).toThrow(/positive price/);
    expect(() => addAlert(s, { symbol: "EURUSD", condition: "above", price: 1.085001 }, eur)).toThrow(/steps of 0.00001/);
    expect(() => addAlert(s, { symbol: "EURUSD", condition: "above", price: 1.085, note: "x".repeat(81) }, eur)).toThrow(/80 characters/);
    // Already met by the fresh bid: refused so it can't fire by mistake.
    expect(() => addAlert(s, { symbol: "EURUSD", condition: "above", price: 1.0795 }, eur)).toThrow(/already above 1.0795 \(now 1.08000\)/);
    expect(() => addAlert(s, { symbol: "EURUSD", condition: "below", price: 1.08 }, eur)).toThrow(/already below/);
    // A stale price does not block it (the next fresh price decides).
    expect(addAlert(s, { symbol: "EURUSD", condition: "above", price: 1.0795 }, ctx([q("EURUSD", 1.08, 1.0801, T0 - 60_000)])).state.alerts).toHaveLength(1);
    const dup = addAlert(s, { symbol: "EURUSD", condition: "above", price: 1.085 }, eur).state;
    expect(() => addAlert(dup, { symbol: "EURUSD", condition: "above", price: 1.085 }, eur)).toThrow(/already have this alert/);
    const breached: AccountState = { ...s, status: "breached" };
    expect(() => addAlert(breached, { symbol: "EURUSD", condition: "above", price: 1.085 }, eur)).toThrow(/loss limit/);
  });

  it("works with the market closed and caps the number of alerts", () => {
    expect(addAlert(base(), { symbol: "GBPUSD", condition: "below", price: 1.25 }, ctx([], SATURDAY)).state.alerts).toHaveLength(1);
    let s = base();
    for (let i = 0; i < MAX_ALERTS; i++) s = addAlert(s, { symbol: "EURUSD", condition: "above", price: Number((1.09 + i / 1000).toFixed(3)) }, eur).state;
    try { addAlert(s, { symbol: "EURUSD", condition: "below", price: 1.07 }, eur); expect.unreachable(); } catch (e) { expect((e as { code: string }).code).toBe("too_many_alerts"); }
  });

  it("removes an alert, and says so when it is gone", () => {
    const s = addAlert(base(), { symbol: "EURUSD", condition: "above", price: 1.085 }, eur).state;
    const id = s.alerts![0].id;
    const gone = removeAlert(s, id);
    expect(gone.state.alerts).toEqual([]);
    expect(gone.events).toEqual([{ type: "alert_removed", alertId: id }]);
    expect(() => removeAlert(gone.state, id)).toThrow(/not waiting/);
    expect(() => removeAlert(base(), "nope")).toThrow(/not waiting/);
  });

  it("fires once on the first fresh bid at or beyond the level, on the bid only", () => {
    let s = addAlert(base(), { symbol: "EURUSD", condition: "above", price: 1.085 }, eur).state;
    s = addAlert(s, { symbol: "EURUSD", condition: "below", price: 1.075 }, eur).state;
    // Ask reaches the level but the bid does not: nothing.
    const askOnly = tick(s, ctx([q("EURUSD", 1.0849, 1.0851, T0 + 1000)], T0 + 1000));
    expect(askOnly.events.filter(e => e.type === "alert_triggered")).toEqual([]);
    // Stale quote at the level: nothing.
    expect(tick(s, ctx([q("EURUSD", 1.09, 1.0901, T0)], T0 + 10_000)).events).toEqual([]);
    const hit = tick(s, ctx([q("EURUSD", 1.085, 1.0851, T0 + 2000)], T0 + 2000));
    expect(hit.events).toEqual([{ type: "alert_triggered", alert: expect.objectContaining({ symbol: "EURUSD", condition: "above", price: 1.085, triggeredAt: T0 + 2000, triggerPrice: 1.085 }) }]);
    expect(hit.state.alerts!.map(a => a.condition)).toEqual(["below"]);
    expect(hit.state.triggeredAlerts).toHaveLength(1);
    expect(hit.state.sequence).toBe(s.sequence + 1);
    // Fires only once.
    expect(tick(hit.state, ctx([q("EURUSD", 1.09, 1.0901, T0 + 3000)], T0 + 3000)).events).toEqual([]);
    // Alerts never trade.
    expect(hit.state.positions).toEqual([]); expect(hit.state.orders).toEqual([]); expect(hit.state.balance).toBe(10000);
    expect(alertHit({ condition: "below", price: 1.075 }, 1.075)).toBe(true);
    expect(alertHit({ condition: "below", price: 1.075 }, 1.07501)).toBe(false);
  });

  it("keeps the newest fired alerts first, at most TRIGGERED_ALERTS_KEPT", () => {
    let s = base();
    for (let i = 0; i < TRIGGERED_ALERTS_KEPT + 5; i++) s = addAlert(s, { symbol: "EURUSD", condition: "above", price: Number((1.081 + i / 10000).toFixed(4)) }, eur).state;
    const all = tick(s, ctx([q("EURUSD", 1.2, 1.2001, T0 + 1000)], T0 + 1000));
    expect(all.events).toHaveLength(TRIGGERED_ALERTS_KEPT + 5);
    expect(all.state.triggeredAlerts).toHaveLength(TRIGGERED_ALERTS_KEPT);
    expect(all.state.triggeredAlerts![0].price).toBe(1.0834); // last one set comes first
    expect(all.state.alerts).toEqual([]);
  });

  it("does not check alerts on breached or passed accounts", () => {
    const s = addAlert(base(), { symbol: "EURUSD", condition: "above", price: 1.085 }, eur).state;
    expect(tick({ ...s, status: "passed" }, ctx([q("EURUSD", 1.09, 1.0901, T0 + 1000)], T0 + 1000)).events.some(e => e.type === "alert_triggered")).toBe(false);
  });
});

describe("engine: price alerts over the HTTP contract", () => {
  async function server(tradingEnabled = false) {
    let clock = T0;
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => clock);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801));
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async t => (t === "good" ? "u1" : null), canAccess: async (_u, id) => id === "acc_1", tradingEnabled: async () => tradingEnabled, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    return { venue, feed, opts, gw: new HttpGateway("https://api.example.com", async () => "good", fetcher), tickTo: (t: number) => { clock = t; } };
  }

  it("adds and deletes alerts through HttpGateway, also before trading is switched on", async () => {
    const { gw } = await server(false);
    const added = await gw.addAlert("acc_1", { symbol: "EURUSD", condition: "above", price: 1.085, note: "breakout" });
    expect(added.state.alerts).toEqual([expect.objectContaining({ symbol: "EURUSD", condition: "above", price: 1.085, note: "breakout" })]);
    await expect(gw.addAlert("acc_1", { symbol: "EURUSD", condition: "above", price: 1.07 })).rejects.toMatchObject({ code: "bad_alert" });
    const removed = await gw.removeAlert("acc_1", added.state.alerts![0].id);
    expect(removed.state.alerts).toEqual([]);
    await expect(gw.removeAlert("acc_1", "alr_missing")).rejects.toMatchObject({ code: "no_alert" });
    // Orders still need the owner's switch.
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1 })).rejects.toMatchObject({ code: "trading_disabled" });
  });

  it("answers with the right status codes and refuses loose bodies", async () => {
    const { opts } = await server();
    const call = (method: string, path: string, body?: unknown, token = "good") => handleEngineRequest({ method, path, headers: { authorization: `Bearer ${token}` }, body }, opts);
    expect((await call("POST", "/v1/accounts/acc_1/alerts", { symbol: "EURUSD", condition: "above", price: 1.085, extra: 1 })).status).toBe(400);
    expect((await call("POST", "/v1/accounts/acc_1/alerts", { symbol: "EURUSD", condition: "up", price: 1.085 })).status).toBe(400);
    expect((await call("POST", "/v1/accounts/acc_1/alerts", { symbol: "EURUSD", condition: "above", price: "1.085" })).status).toBe(400);
    expect((await call("POST", "/v1/accounts/acc_1/alerts", { symbol: "EURUSD", condition: "above", price: 1.07 })).status).toBe(422);
    expect((await call("DELETE", "/v1/accounts/acc_1/alerts/nope")).status).toBe(404);
    expect((await call("GET", "/v1/accounts/acc_1/alerts")).status).toBe(405);
    expect((await call("POST", "/v1/accounts/acc_1/alerts/x")).status).toBe(405);
    expect((await call("POST", "/v1/accounts/acc_2/alerts", { symbol: "EURUSD", condition: "above", price: 1.085 })).status).toBe(403);
    expect((await call("POST", "/v1/accounts/acc_1/alerts", { symbol: "EURUSD", condition: "above", price: 1.085 }, "bad")).status).toBe(401);
    expect(parseAlertRequest({ symbol: "EURUSD", condition: "below", price: 1.07 })).toEqual({ symbol: "EURUSD", condition: "below", price: 1.07 });
    expect(() => parseAlertRequest([])).toThrow(/JSON object/);
  });

  it("the server's timer step fires alerts with nobody online, and keeps accounts with alerts busy", async () => {
    const { venue, feed, tickTo } = await server();
    await venue.addAlert("acc_1", { symbol: "EURUSD", condition: "above", price: 1.085 });
    const events: string[] = [];
    venue.onEvents((_id, evs) => events.push(...evs.map(e => e.type)));
    const runner = new EngineRunner({ venue, accounts: async () => ["acc_1"], clock: () => T0 + 1000 });
    tickTo(T0 + 1000);
    // No positions or orders, but a waiting alert: checked every round, not once a minute.
    expect((await runner.runOnce()).checked).toBe(1);
    expect((await runner.runOnce())).toMatchObject({ checked: 1, idleSkipped: 0 });
    feed.push(q("EURUSD", 1.0852, 1.0853, T0 + 1000));
    await runner.runOnce();
    expect(events).toContain("alert_triggered");
    const snap = await venue.snapshot("acc_1");
    expect(snap.state.triggeredAlerts![0]).toMatchObject({ price: 1.085, triggerPrice: 1.0852 });
  });

  it("the disconnected gateway refuses alerts without sending anything", async () => {
    await expect(new DisconnectedGateway().addAlert()).rejects.toMatchObject({ code: "not_connected" });
    await expect(new DisconnectedGateway().removeAlert()).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("terminal: alert helpers", () => {
  const eurusd = findPair("EURUSD")!, usdjpy = findPair("USDJPY")!;
  it("reads the alert form", () => {
    const quote = { bid: 1.08, time: T0 };
    expect(readAlertDraft(eurusd, "above", "", "", quote, T0)).toEqual({ ok: false, message: "Enter the price level." });
    expect(readAlertDraft(eurusd, "above", "abc", "", quote, T0)).toMatchObject({ ok: false, message: expect.stringMatching(/like 1.08500/) });
    expect(readAlertDraft(eurusd, "above", "1.085001", "", quote, T0)).toMatchObject({ ok: false, message: expect.stringMatching(/steps of 0.00001 \(5 decimals\)/) });
    expect(readAlertDraft(usdjpy, "above", "150.0015", "", undefined, T0)).toMatchObject({ ok: false, message: expect.stringMatching(/steps of 0.001/) });
    expect(readAlertDraft(eurusd, "above", "1.0790", "", quote, T0)).toMatchObject({ ok: false, message: "The bid is already above this level (now 1.08000)." });
    expect(readAlertDraft(eurusd, "above", "1.0790", "", { bid: 1.08, time: T0 - 120_000 }, T0)).toEqual({ ok: true, price: 1.079 });
    expect(readAlertDraft(eurusd, "above", "1,08500", " note ", quote, T0)).toEqual({ ok: true, price: 1.085, note: "note" });
    expect(readAlertDraft(eurusd, "below", "1.07", "x".repeat(81), quote, T0)).toMatchObject({ ok: false, message: expect.stringMatching(/80 characters/) });
  });
  it("suggests the side, measures pips and sorts by distance", () => {
    expect(suggestedCondition(1.085, 1.08)).toBe("above");
    expect(suggestedCondition(1.075, 1.08)).toBe("below");
    expect(suggestedCondition(1.08, 1.08)).toBeNull();
    expect(suggestedCondition(1.08, undefined)).toBeNull();
    expect(pipsAway(eurusd, 1.085, 1.08)).toBe(50);
    expect(pipsAway(usdjpy, 150.123, 150.0)).toBe(12.3);
    expect(pipsAway(eurusd, 1.085, undefined)).toBeNull();
    const a = (id: string, symbol: string, price: number) => ({ id, symbol, condition: "above" as const, price, createdAt: T0 });
    const bids: Record<string, number> = { EURUSD: 1.08, GBPUSD: 1.25 };
    expect(byDistance([a("1", "EURUSD", 1.09), a("2", "GBPUSD", 1.251), a("3", "AUDUSD", 0.7)], findPair, s => bids[s]).map(x => x.id)).toEqual(["2", "1", "3"]);
    expect(firedSentence({ symbol: "EURUSD", condition: "above", price: 1.085, triggerPrice: 1.08512 }, 5)).toBe("EURUSD bid went above 1.08500 (1.08512)");
    const seen = new Set(["x"]);
    expect(newlyFired([{ ...a("x", "EURUSD", 1), triggeredAt: 1, triggerPrice: 1 }, { ...a("y", "EURUSD", 1), triggeredAt: 1, triggerPrice: 1 }], seen).map(x => x.id)).toEqual(["y"]);
    expect(newlyFired(undefined, seen)).toEqual([]);
    expect(seen.has("y")).toBe(true);
  });
});

describe("terminal: Alerts tab", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); mocks.toast.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup(gatewayFor?: (venue: LocalVenue) => unknown) {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    const gateway = (gatewayFor?.(venue) ?? new LocalGatewayAdapter(venue)) as LocalGatewayAdapter;
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={gateway} />} /></Routes></MemoryRouter>);
    return { venue, feed };
  }

  it("sets, lists and deletes an alert, and pops up when it fires", async () => {
    const { venue, feed } = await setup();
    expect(await screen.findByText("Trading engine live")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Alerts" }));
    const panel = await screen.findByTestId("engine-alerts");
    await waitFor(() => expect(within(panel).getByTestId("alert-bid")).toHaveTextContent("Bid now 1.08000"));
    expect(within(panel).getByTestId("alert-create")).toBeDisabled();
    fireEvent.change(within(panel).getByTestId("alert-price"), { target: { value: "1.07500" } });
    // Level below the bid while "above" is chosen: the server would refuse it, so does the form, with a one-tap fix.
    expect(within(panel).getByTestId("alert-problem")).toHaveTextContent("already above this level");
    fireEvent.click(within(panel).getByRole("button", { name: /alert when the bid goes below/ }));
    expect(within(panel).getByRole("button", { name: "Bid at or below" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByTestId("alert-bid")).toHaveTextContent("50 pips away");
    fireEvent.change(within(panel).getByTestId("alert-note"), { target: { value: "Last week's low" } });
    await act(async () => { fireEvent.click(within(panel).getByTestId("alert-create")); });
    expect(await within(panel).findByTestId("alert-message")).toHaveTextContent("Alert set: EURUSD bid at or below 1.07500.");
    const table = within(panel).getByTestId("alerts-table");
    expect(table).toHaveTextContent("EURUSD");
    expect(table).toHaveTextContent("Last week's low");
    expect(table).toHaveTextContent("50 pips");
    expect(screen.getByRole("tab", { name: "Alerts (1)" })).toBeInTheDocument();
    expect((await venue.snapshot(account.accountId)).state.alerts).toHaveLength(1);

    // A second alert, deleted from the table.
    fireEvent.change(within(panel).getByTestId("alert-price"), { target: { value: "1.09000" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Bid at or above" }));
    await act(async () => { fireEvent.click(within(panel).getByTestId("alert-create")); });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alerts (2)" })).toBeInTheDocument());
    await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Delete alert EURUSD above 1.09000" })); });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alerts (1)" })).toBeInTheDocument());
    expect(await within(panel).findByTestId("alert-message")).toHaveTextContent("Alert deleted.");

    // The price falls to the level: the server fires it and the terminal pops it up once.
    feed.push(q("EURUSD", 1.0749, 1.075, Date.now()));
    await act(async () => { await venue.snapshot(account.accountId); });
    expect(await within(panel).findByTestId("alerts-fired", {}, { timeout: 4000 })).toHaveTextContent("EURUSD bid went below 1.07500 (1.07490)");
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Price alert: EURUSD bid went below 1.07500 (1.07490)", { description: "Last week's low" }));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Alerts" })).toBeInTheDocument();
  });

  it("says plainly that alerts need the trading server while it is not connected", async () => {
    await setup(() => new DisconnectedGateway());
    fireEvent.click(await screen.findByRole("tab", { name: "Alerts" }));
    const panel = await screen.findByTestId("engine-alerts");
    expect(within(panel).getByTestId("alert-offline")).toHaveTextContent("Price alerts start working once the trading server is connected.");
    expect(within(panel).getByTestId("alert-bid")).toHaveTextContent("The bid shows here once trading is connected.");
    fireEvent.change(within(panel).getByTestId("alert-price"), { target: { value: "1.09000" } });
    expect(within(panel).getByTestId("alert-create")).toBeDisabled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

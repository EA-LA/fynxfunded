import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter, parsePaused } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { createEngineServer } from "@/engine/server";
import {
  cleanReason, DEFAULT_PAUSE_REASON, pausedMessage, PAUSE_REASON_MAX, readPauseDocument, readPauseSetting, readTime, TradingPause,
} from "@/engine/trading-pause";
import { engineLabel, useEngine } from "@/trade-access/useEngine";
import { pausedSentence, pausedUntilText } from "@/trade-access/paused";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";
import LiveTradeAccountCard from "@/components/LiveTradeAccountCard";

// Test values only: these prices exercise the plumbing and are not market prices.
const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const HOUR = 3_600_000;
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });

describe("pause switch: reading the control document", () => {
  it("is not paused without a document or with paused false", () => {
    expect(readPauseDocument(undefined, T0)).toEqual({ state: null, problems: [] });
    expect(readPauseDocument({ paused: false, reason: "x" }, T0).state).toBeNull();
    expect(readPauseDocument({ paused: "false" }, T0).state).toBeNull();
    expect(readPauseDocument({ reason: "only a reason" }, T0).state).toBeNull();
  });

  it("pauses with the reason, an end time and a start time", () => {
    const r = readPauseDocument({ paused: true, reason: "  Our price provider\nhas an outage. ", until: "2026-11-04T12:00:00Z", since: T0 - HOUR }, T0);
    expect(r).toEqual({ state: { reason: "Our price provider has an outage.", until: Date.parse("2026-11-04T12:00:00Z"), since: T0 - HOUR, source: "control" }, problems: [] });
    expect(readPauseDocument({ paused: "true" }, T0).state).toEqual({ reason: DEFAULT_PAUSE_REASON, since: T0, until: null, source: "control" });
  });

  it("reads Firestore timestamps, dates and milliseconds", () => {
    const at = T0 + HOUR;
    for (const until of [at, new Date(at), { toMillis: () => at }, new Date(at).toISOString()]) {
      expect(readPauseDocument({ paused: true, until }, T0).state?.until).toBe(at);
    }
    expect(readTime("tomorrow")).toBe("bad");
    expect(readTime(-5)).toBe("bad");
    expect(readTime({})).toBe("bad");
  });

  it("ends by itself once until has passed", () => {
    expect(readPauseDocument({ paused: true, until: T0 }, T0).state).toBeNull();
    expect(readPauseDocument({ paused: true, until: T0 - 1 }, T0).state).toBeNull();
  });

  it("is fail-safe: an unreadable switch pauses, an unreadable end keeps the pause until lifted", () => {
    const odd = readPauseDocument({ paused: "yes please" }, T0);
    expect(odd.state?.reason).toBe(DEFAULT_PAUSE_REASON);
    expect(odd.problems[0]).toMatch(/"paused" should be true or false/);
    const badEnd = readPauseDocument({ paused: true, until: "next week" }, T0);
    expect(badEnd.state).toMatchObject({ until: null });
    expect(badEnd.problems[0]).toMatch(/"until" is not a time/);
    const badReason = readPauseDocument({ paused: true, reason: 42 }, T0);
    expect(badReason.state?.reason).toBe(DEFAULT_PAUSE_REASON);
    expect(badReason.problems[0]).toMatch(/"reason" should be text/);
    // A start time in the future is not believed.
    expect(readPauseDocument({ paused: true, since: T0 + HOUR }, T0).state?.since).toBe(T0);
  });

  it("cleans the reason: no control characters, at most 200 characters", () => {
    expect(cleanReason("a\u0000b c\td")).toBe("a b c d");
    expect(cleanReason("   ")).toBe(DEFAULT_PAUSE_REASON);
    const long = cleanReason("x".repeat(500));
    expect(long).toHaveLength(PAUSE_REASON_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("reads FYNX_ENGINE_PAUSE", () => {
    for (const off of [undefined, "", " ", "false", "OFF", "0", "no"]) expect(readPauseSetting(off, T0)).toBeNull();
    expect(readPauseSetting("true", T0)).toEqual({ reason: DEFAULT_PAUSE_REASON, since: T0, until: null, source: "settings" });
    expect(readPauseSetting("Broker maintenance until 14:00 UTC.", T0)?.reason).toBe("Broker maintenance until 14:00 UTC.");
  });

  it("says plainly what happened to the order", () => {
    expect(pausedMessage({ reason: "Broker outage.", until: null })).toBe("New trading is paused: Broker outage. No order was sent; closing trades and cancelling orders still work.");
    expect(pausedMessage({ reason: "Broker outage.", until: Date.parse("2026-11-04T12:30:00Z") })).toContain("Expected back by 2026-11-04 12:30 UTC.");
  });
});

describe("pause switch: TradingPause", () => {
  function doc(initial: Record<string, unknown> | null) {
    const box = { data: initial, fail: false, reads: 0 };
    return { box, reader: { get: async () => { box.reads += 1; if (box.fail) throw new Error("UNAVAILABLE"); return { exists: box.data !== null, data: () => box.data ?? undefined }; } } };
  }

  it("follows the control document, keeps the start time and reports changes once", async () => {
    let now = T0;
    const { box, reader } = doc({ paused: true, reason: "Provider outage." });
    const changes: (string | null)[] = [];
    const pause = new TradingPause({ control: reader, clock: () => now, onChange: s => changes.push(s?.reason ?? null) });
    expect(pause.current()).toBeNull();
    await pause.refresh();
    expect(pause.current()).toEqual({ reason: "Provider outage.", since: T0, until: null, source: "control" });
    now += 60_000;
    await pause.refresh();
    expect(pause.current()?.since).toBe(T0); // same pause continues
    box.data = { paused: true, reason: "Provider outage; back soon." };
    await pause.refresh();
    expect(pause.current()).toMatchObject({ reason: "Provider outage; back soon.", since: T0 });
    box.data = null; // owner deleted the document
    await pause.refresh();
    expect(pause.current()).toBeNull();
    expect(changes).toEqual(["Provider outage.", "Provider outage; back soon.", null]);
    expect(pause.health()).toMatchObject({ paused: false, lastReadAt: now, readFailures: 0 });
  });

  it("keeps the last known state while the document cannot be read", async () => {
    const { box, reader } = doc({ paused: true, reason: "Checks." });
    const errors: number[] = [];
    const pause = new TradingPause({ control: reader, clock: () => T0, onError: (_e, n) => errors.push(n) });
    await pause.refresh();
    box.fail = true;
    await pause.refresh(); await pause.refresh();
    expect(pause.current()?.reason).toBe("Checks.");
    expect(errors).toEqual([1, 2]);
    expect(pause.health()).toMatchObject({ paused: true, readFailures: 2 });
    box.fail = false; box.data = { paused: false };
    await pause.refresh();
    expect(pause.current()).toBeNull();
    expect(pause.health().readFailures).toBe(0);
  });

  it("ends a timed pause by the clock alone, without another read", async () => {
    let now = T0;
    const { reader } = doc({ paused: true, until: T0 + HOUR });
    const pause = new TradingPause({ control: reader, clock: () => now });
    await pause.refresh();
    expect(pause.current()).not.toBeNull();
    now = T0 + HOUR;
    expect(pause.current()).toBeNull();
  });

  it("the setting pauses whatever the document says; pause()/resume() from code", async () => {
    const { reader } = doc({ paused: false });
    const pause = new TradingPause({ control: reader, initial: readPauseSetting("Start-up checks.", T0), clock: () => T0 });
    await pause.refresh();
    expect(pause.current()).toMatchObject({ reason: "Start-up checks.", source: "settings" });
    const plain = new TradingPause({ clock: () => T0 });
    plain.pause("Test pause.", T0 + HOUR);
    expect(plain.current()).toMatchObject({ reason: "Test pause.", until: T0 + HOUR, source: "code" });
    plain.resume();
    expect(plain.current()).toBeNull();
  });

  it("reads one at a time and every interval after start()", async () => {
    vi.useFakeTimers();
    try {
      const { box, reader } = doc({ paused: false });
      const pause = new TradingPause({ control: reader, everyMs: 10_000 });
      await pause.start();
      expect(box.reads).toBe(1);
      await Promise.all([pause.refresh(), pause.refresh()]);
      expect(box.reads).toBe(2);
      box.data = { paused: true };
      await vi.advanceTimersByTimeAsync(10_000);
      expect(box.reads).toBe(3);
      expect(pause.current()).not.toBeNull();
      pause.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(box.reads).toBe(3);
    } finally { vi.useRealTimers(); }
  });
});

describe("pause switch: HTTP contract", () => {
  async function setup() {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    await venue.open("acc_1");
    const pause = new TradingPause({ clock: () => T0 });
    const opts: HostOptions = {
      venue,
      verifyToken: async t => (t === "good" ? "u1" : null),
      canAccess: async (u, a) => u === "u1" && a === "acc_1",
      tradingEnabled: async () => true,
      status: () => ({ priceFeed: true, execution: true, message: "ok" }),
      pause: () => pause.current(),
    };
    const fetcher = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: u.pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
    return { venue, pause, opts, gw: new HttpGateway("https://api.example.com", async () => "good", fetcher) };
  }

  it("refuses new orders and changes with 503 trading_paused; closing, cancelling and alerts still work", async () => {
    const { venue, pause, opts, gw } = await setup();
    const open = (await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).state.positions[0];
    const order = (await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "limit", lots: 1, price: 1.07 })).state.orders[0];
    pause.pause("Liquidity provider outage.", T0 + HOUR);

    const refused = await handleEngineRequest({ method: "POST", path: "/v1/accounts/acc_1/orders", headers: { authorization: "Bearer good" }, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } }, opts);
    expect(refused.status).toBe(503);
    expect(refused.body).toEqual({ error: { code: "trading_paused", message: "New trading is paused: Liquidity provider outage. Expected back by 2026-11-04 11:00 UTC. No order was sent; closing trades and cancelling orders still work." } });
    await expect(gw.placeOrder("acc_1", { symbol: "EURUSD", side: "sell", type: "market", lots: 1 })).rejects.toMatchObject({ code: "trading_paused" });
    await expect(gw.modifyPosition("acc_1", open.id, { stopLoss: 1.075 })).rejects.toMatchObject({ code: "trading_paused" });
    await expect(gw.modifyOrder("acc_1", order.id, { price: 1.069 })).rejects.toMatchObject({ code: "trading_paused" });
    // Nothing was recorded by the refused requests.
    const during = (await venue.snapshot("acc_1")).state;
    expect(during.positions).toHaveLength(1);
    expect(during.positions[0].stopLoss).toBeUndefined();
    expect(during.orders[0].price).toBe(1.07);

    expect((await gw.addAlert("acc_1", { symbol: "EURUSD", price: 1.09, condition: "above" })).state.alerts).toHaveLength(1);
    expect((await gw.cancelOrder("acc_1", order.id)).state.orders).toEqual([]);
    expect((await gw.closePosition("acc_1", open.id)).state.positions).toEqual([]);

    pause.resume();
    expect((await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).state.positions).toHaveLength(1);
  });

  it("GET /v1/status carries the pause; HttpGateway reads it and the label says so", async () => {
    const { pause, gw } = await setup();
    expect((await gw.status()).paused).toBeUndefined();
    pause.pause("Broker maintenance.", T0 + HOUR);
    const s = await gw.status();
    expect(s.paused).toEqual({ reason: "Broker maintenance.", since: T0, until: T0 + HOUR });
    expect(s.execution).toBe(true);
    expect(engineLabel(s)).toBe("Engine connected · new trading paused");
  });

  it("parsePaused keeps good fields and still pauses on a malformed answer", () => {
    expect(parsePaused(undefined)).toBeUndefined();
    expect(parsePaused(null)).toBeUndefined();
    expect(parsePaused(false)).toBeUndefined();
    expect(parsePaused(true)).toEqual({ reason: "The trading server has paused new trading.", since: null, until: null });
    expect(parsePaused({ reason: "x\u0007y", since: "a", until: -1 })).toEqual({ reason: "x y", since: null, until: null });
    expect(parsePaused({ reason: "r".repeat(300), until: T0 })?.reason).toHaveLength(200);
  });

  it("createEngineServer wires the pause into requests and health; LocalGatewayAdapter refuses too", async () => {
    const pause = new TradingPause({ clock: () => T0 });
    const feed = new StaticQuoteFeed();
    const server = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store: new MemoryStore(),
      rulesFor: async () => rules, feed, accounts: async () => [], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true,
      pause, clock: () => T0, rateLimits: false,
    });
    server.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    pause.pause("Checks.");
    expect(server.status().pause).toMatchObject({ paused: true, reason: "Checks.", source: "code" });
    const status = await server.handle({ method: "GET", path: "/v1/status", headers: { authorization: "Bearer t" } });
    expect((status.body as { paused?: unknown }).paused).toEqual({ reason: "Checks.", since: T0, until: null });
    await server.handle({ method: "GET", path: "/v1/accounts/acc_9", headers: { authorization: "Bearer t" } });
    const refused = await server.handle({ method: "POST", path: "/v1/accounts/acc_9/orders", headers: { authorization: "Bearer t" }, body: { symbol: "EURUSD", side: "buy", type: "market", lots: 1 } });
    expect(refused.status).toBe(503);
    await server.stop();

    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const f2 = new StaticQuoteFeed(); venue.connect(f2); f2.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    await venue.open("a");
    const local = new LocalGatewayAdapter(venue, { pause: () => pause.current() });
    expect((await local.status()).paused).toMatchObject({ reason: "Checks." });
    await expect(local.placeOrder("a", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).rejects.toMatchObject({ code: "trading_paused" });
    pause.resume();
    expect((await local.placeOrder("a", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).state.positions).toHaveLength(1);
  });
});

describe("pause switch: terminal and dashboard", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function venue() {
    const v = new LocalVenue(specs, new MemoryStore(), async () => ({ ...rules, minTradingDays: 5 }), { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); v.connect(feed);
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: Date.now() });
    await v.open(account.accountId);
    return v;
  }

  it("terminal: banner, order buttons locked with the reason; closing a trade still works", async () => {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const v = await venue();
    await v.place(account.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 });
    const pause = new TradingPause();
    pause.pause("Our liquidity provider has an outage.", T0 + 2 * HOUR);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(v, { pause: () => pause.current() })} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Engine connected · new trading paused")).toBeInTheDocument();
    const banner = screen.getByTestId("trading-paused");
    expect(banner).toHaveTextContent("New trading is paused by FYNX. Our liquidity provider has an outage. Expected back by");
    expect(banner).toHaveTextContent("you can still close trades and cancel orders");
    const ticket = screen.getByTestId("order-ticket");
    await waitFor(() => expect(within(ticket).getByTestId("buy-button")).toHaveTextContent("1.08010"));
    fireEvent.click(within(ticket).getByTestId("buy-button"));
    expect(screen.queryByTestId("confirm-order")).toBeNull();
    expect(within(ticket).getByText(/^New trading is paused by FYNX: Our liquidity provider has an outage\. Expected back by .* Closing trades and cancelling orders still work\. This order was not sent\.$/)).toBeInTheDocument();

    // Closing still goes through.
    fireEvent.click(screen.getByRole("tab", { name: /Positions/ }));
    const positionId = (await v.snapshot(account.accountId)).state.positions[0].id;
    const closeButton = await screen.findByRole("button", { name: `Close EURUSD position ${positionId}` });
    await act(async () => { fireEvent.click(closeButton); });
    await waitFor(async () => expect((await v.snapshot(account.accountId)).state.positions).toEqual([]));
  });

  it("dashboard live card shows the pause", async () => {
    const v = await venue();
    const pause = new TradingPause();
    pause.pause("Broker maintenance.");
    const gateway = new LocalGatewayAdapter(v, { pause: () => pause.current() });
    function Harness() {
      const engine = useEngine(account.accountId, gateway, { pollMs: 5000 });
      return <MemoryRouter><LiveTradeAccountCard engine={engine} accountId={account.accountId} startingBalance={10000} /></MemoryRouter>;
    }
    render(<Harness />);
    expect(await screen.findByTestId("live-trading-paused")).toHaveTextContent("New trading is paused by FYNX: Broker maintenance. Open trades, stops and loss limits keep working");
    expect(screen.getByTestId("live-engine-status")).toHaveTextContent("Engine connected · new trading paused");
  });

  it("sentences in local time", () => {
    const p = { reason: "Checks.", since: T0, until: T0 + HOUR };
    expect(pausedUntilText(p, T0, "en-GB")).toMatch(/^Expected back by \d{2}:\d{2} \(your time\)\.$/);
    expect(pausedUntilText({ until: T0 + 3 * 24 * HOUR }, T0, "en-GB")).toMatch(/^Expected back by Sat/);
    expect(pausedUntilText({ until: null }, T0)).toBe("");
    expect(pausedUntilText({ until: T0 - 1 }, T0)).toBe("");
    expect(pausedSentence({ reason: "Checks.", since: null, until: null }, T0)).toBe("New trading is paused by FYNX: Checks. Closing trades and cancelling orders still work.");
  });
});

describe("pause switch: readiness list", () => {
  it("says whether the host starts paused and how to pause later", async () => {
    const { describePauseSetting } = await import("@/engine/preflight");
    expect(describePauseSetting({})).toMatch(/^New trading not paused\. To pause every account without a restart, set the Firestore document engineControl\/trading/);
    expect(describePauseSetting({ FYNX_ENGINE_PAUSE: "Broker checks." })).toBe('New trading starts PAUSED (FYNX_ENGINE_PAUSE: "Broker checks."); closing and cancelling work. Remove the setting and restart to resume.');
  });
});

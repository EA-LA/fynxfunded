import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTICES, newAccount, noticePrefs, setNotices } from "@/engine/core";
import type { Deal, EngineEvent, Position, Quote, RuleSet, TriggeredAlert } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { DisconnectedGateway, HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, parseNotices, type HostOptions } from "@/engine/host";
import { createEngineServer } from "@/engine/server";
import { EngineNotifier, firestoreMailSender, noticeDocId, noticesFor, storePrefs, type Notice, type NoticeRecipient } from "@/engine/notifier";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const mocks = vi.hoisted(() => ({ call: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, market open
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50 });
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const alert: TriggeredAlert = { id: "alr_1", symbol: "EURUSD", condition: "above", price: 1.085, createdAt: T0 - 1000, triggeredAt: T0, triggerPrice: 1.08512, note: "weekly high" };
const position: Position = { id: "pos_1", symbol: "USDJPY", side: "buy", lots: 0.5, entryPrice: 150.123, openedAt: T0, stopLoss: 149.5, commission: -3.5 };
const deal = (reason: Deal["reason"], netProfit: number, id = "deal_1"): Deal => ({ id, positionId: "pos_1", symbol: "EURUSD", side: "sell", lots: 0.2, entryPrice: 1.08, exitPrice: 1.0825, openedAt: T0 - 60_000, closedAt: T0, grossProfit: netProfit + 1.4, commission: -1.4, netProfit, reason });

describe("engine: notice choices", () => {
  it("has honest defaults and changes only the given kinds", () => {
    const s = newAccount("a", rules, T0);
    expect(noticePrefs(s)).toEqual(DEFAULT_NOTICES);
    expect(DEFAULT_NOTICES).toEqual({ alert: true, fill: false, stop: false, limit: true, target: true, expiry: false, near: false });
    const step = setNotices(s, { stop: true, alert: false });
    expect(step.state.notices).toEqual({ ...DEFAULT_NOTICES, stop: true, alert: false });
    expect(step.state.sequence).toBe(s.sequence + 1);
    expect(step.events).toEqual([{ type: "notices_changed", notices: step.state.notices }]);
    // Works after a loss limit too (it never trades).
    expect(setNotices({ ...s, status: "breached" }, { fill: true }).state.notices?.fill).toBe(true);
    expect(() => setNotices(s, {})).toThrow(/Nothing to change/);
    expect(() => setNotices(s, { email: true } as never)).toThrow(/Unknown notice: email/);
    expect(() => setNotices(s, { alert: "yes" } as never)).toThrow(/on \(true\) or off \(false\)/);
    // Stored values that are not booleans are ignored.
    expect(noticePrefs({ notices: { alert: "x" as never, fill: true } })).toEqual({ ...DEFAULT_NOTICES, fill: true });
  });
});

describe("engine: what each notice says", () => {
  it("writes plain notices with fixed ids for alerts, fills, stops, targets and expiries", () => {
    const events: EngineEvent[] = [
      { type: "alert_triggered", alert },
      { type: "position_opened", position },
      { type: "order_triggered", orderId: "ord_9", positionId: "pos_1" },
      { type: "position_closed", deal: deal("take_profit", 48.6) },
      { type: "position_closed", deal: deal("manual", -10, "deal_2") },
      { type: "target_reached" },
      { type: "order_expired", order: { id: "ord_5", symbol: "GBPUSD", side: "buy", type: "limit", lots: 1, price: 1.25, createdAt: T0 - 9e6, expiresAt: T0, expiredAt: T0 } },
      { type: "stop_trailed", positionId: "pos_1", stopLoss: 1 },
    ];
    const out = noticesFor("acc_1", events, T0);
    expect(out.map(n => [n.id, n.kind])).toEqual([
      ["acc_1:alert:alr_1", "alert"], ["acc_1:fill:ord_9", "fill"], ["acc_1:stop:deal_1", "stop"], ["acc_1:target:first", "target"], ["acc_1:expiry:ord_5", "expiry"],
    ]);
    const [a, f, s, t, e] = out;
    expect(a.subject).toBe("Price alert: EURUSD bid went above 1.08500");
    expect(a.text).toContain("fired at 2026-11-04 10:00 UTC");
    expect(a.text).toContain("The bid reached 1.08512");
    expect(a.text).toContain("Your note: weekly high");
    expect(a.text).toContain("nothing was opened or closed");
    expect(a.text).toContain("Open FYNX Trade: https://www.fynxfunded.com/trade/access");
    expect(f.subject).toBe("Order filled: Buy 0.50 USDJPY at 150.123");
    expect(f.text).toContain("Stop loss: 149.500 · Take profit: none");
    expect(s.subject).toBe("Take profit hit: EURUSD +$48.60");
    expect(t.text).toContain("not yet the official result");
    expect(e.subject).toBe("Order expired: buy limit GBPUSD at 1.25000");
    expect(e.text).toContain("Nothing was opened.");
    // Same input, same notices (ids never change on a retry).
    expect(noticesFor("acc_1", events, T0)).toEqual(out);
    // A fill without its opened position in the batch is skipped rather than guessed.
    expect(noticesFor("acc_1", [{ type: "order_triggered", orderId: "o", positionId: "missing" }], T0)).toEqual([]);
  });

  it("sums the trades a loss limit closed, and does not also send a stop notice for them", () => {
    const out = noticesFor("acc_1", [
      { type: "position_closed", deal: deal("daily_loss_limit", -320.5) },
      { type: "position_closed", deal: deal("daily_loss_limit", -180, "deal_2") },
      { type: "account_breached", reason: "daily_loss_limit" },
    ], T0, { terminalUrl: "https://example.test/t" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "limit", subject: "The daily loss limit was reached on your FYNX Trade account" });
    expect(out[0].text).toContain("closed 2 open trades (result -$500.50)");
    expect(out[0].text).toContain("FYNX confirms the official result");
    expect(out[0].text).toContain("https://example.test/t");
    expect(noticesFor("a", [{ type: "account_breached", reason: "maximum_loss_limit" }], T0)[0].text).toContain("maximum loss limit was reached at 2026-11-04 10:00 UTC. The trading server cancelled");
    expect(noticeDocId("acc/1:alert:x y")).toBe("acc_1:alert:x_y");
  });
});

describe("EngineNotifier", () => {
  const to: NoticeRecipient = { email: "trader@example.com" };
  const notice = (id: string, kind: Notice["kind"] = "alert", accountId = "acc_1"): Notice => ({ id, accountId, kind, subject: "s", text: "t", at: T0 });
  const setup = (over: Partial<ConstructorParameters<typeof EngineNotifier>[0]> = {}) => {
    const sent: { notice: Notice; to: NoticeRecipient }[] = [];
    const n = new EngineNotifier({ send: async (notice, r) => { sent.push({ notice, to: r }); return "sent"; }, recipient: async () => to, sleep: async () => {}, clock: () => T0, ...over });
    return { n, sent };
  };

  it("sends from engine events, once per notice, honouring the trader's choices", async () => {
    let prefs = { ...DEFAULT_NOTICES };
    const { n, sent } = setup({ prefsFor: async () => prefs });
    n.listener("acc_1", [{ type: "alert_triggered", alert }, { type: "position_closed", deal: deal("stop_loss", -50) }]);
    n.listener("acc_1", [{ type: "alert_triggered", alert }]); // repeat: ignored
    await n.flush();
    expect(sent.map(s => s.notice.id)).toEqual(["acc_1:alert:alr_1"]);
    expect(sent[0].to).toEqual(to);
    expect(n.health()).toMatchObject({ sent: 1, switchedOff: 1, pending: 0, failed: [], lastSentAt: T0 });
    prefs = { ...prefs, stop: true };
    n.listener("acc_1", [{ type: "position_closed", deal: deal("stop_loss", -50, "deal_7") }]);
    await n.flush();
    expect(sent.map(s => s.notice.subject)).toContain("Stop loss hit: EURUSD -$50.00");
  });

  it("skips accounts without a valid address and caps notices per hour", async () => {
    const { n: none } = setup({ recipient: async () => ({ email: "not-an-email" }) });
    none.enqueue(notice("x")); await none.flush();
    expect(none.health()).toMatchObject({ sent: 0, noRecipient: 1 });
    let now = T0;
    const { n, sent } = setup({ maxPerHour: 2, clock: () => now });
    ["1", "2", "3"].forEach(id => n.enqueue(notice(id)));
    n.enqueue(notice("other", "alert", "acc_2"));
    await n.flush();
    expect(sent.map(s => s.notice.id)).toEqual(["1", "2", "other"]);
    expect(n.health().rateLimited).toBe(1);
    now = T0 + 3_600_001;
    n.enqueue(notice("4")); await n.flush();
    expect(sent.map(s => s.notice.id)).toContain("4");
  });

  it("retries, keeps failures without the address, and sends them again on retryFailed", async () => {
    let fail = true;
    const errors: string[] = [];
    const { n, sent } = setup({
      retryDelaysMs: [1, 1],
      send: async (notice, r) => { if (fail) throw new Error("provider down"); sent.push({ notice, to: r }); return "sent"; },
      onError: (e, info) => errors.push(`${info.noticeId}#${info.attempt}:${e.message}`),
    });
    n.enqueue(notice("x")); await n.flush();
    expect(errors).toEqual(["x#1:provider down", "x#2:provider down", "x#3:provider down"]);
    const h = n.health();
    expect(h.failed).toEqual([{ id: "x", accountId: "acc_1", kind: "alert", reason: "send_failed", at: T0 }]);
    expect(JSON.stringify(h)).not.toContain("trader@example.com");
    expect(n.enqueue(notice("x"))).toBe(false);
    fail = false;
    expect(n.retryFailed()).toBe(1);
    await n.flush();
    expect(sent).toHaveLength(1);
    expect(n.health().failed).toEqual([]);
  });

  it("firestoreMailSender writes the Trigger Email format once per notice", async () => {
    const docs = new Map<string, Record<string, unknown>>();
    const db = { collection: (c: string) => ({ doc: (id: string) => ({ create: async (data: Record<string, unknown>) => { const k = `${c}/${id}`; if (docs.has(k)) throw Object.assign(new Error("exists"), { code: 6 }); docs.set(k, data); } }) }) };
    const send = firestoreMailSender(db);
    const n = notice("acc/1:alert:a");
    expect(await send(n, to)).toBe("sent");
    expect(await send(n, to)).toBe("exists");
    expect(docs.get("mail/acc_1:alert:a")).toEqual({ to: "trader@example.com", message: { subject: "s", text: "t" }, engineNotice: { accountId: "acc_1", kind: "alert", at: T0 } });
    const broken = firestoreMailSender({ collection: () => ({ doc: () => ({ create: async () => { throw new Error("denied"); } }) }) });
    await expect(broken(n, to)).rejects.toThrow("denied");
  });
});

describe("notices over the HTTP contract and createEngineServer", () => {
  async function host() {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async t => (t === "good" ? "u1" : null), canAccess: async (_u, id) => id === "acc_1", tradingEnabled: async () => false, status: () => ({ priceFeed: true, execution: true, message: "ok", notices: true }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    return { venue, opts, gw: new HttpGateway("https://api.example.com", async () => "good", fetcher), fetcher };
  }

  it("changes choices through HttpGateway before trading is switched on, and reports the sender", async () => {
    const { gw, fetcher } = await host();
    expect((await gw.status()).notices).toBe(true);
    const snap = await gw.setNotices("acc_1", { fill: true });
    expect(snap.state.notices).toMatchObject({ fill: true, alert: true });
    expect(fetcher).toHaveBeenLastCalledWith("https://api.example.com/v1/accounts/acc_1/notices", expect.objectContaining({ method: "PATCH" }));
    await expect(gw.setNotices("acc_1", { nope: true } as never)).rejects.toMatchObject({ code: "bad_request" });
    await expect(new DisconnectedGateway().setNotices()).rejects.toMatchObject({ code: "not_connected" });
  });

  it("answers with the right status codes", async () => {
    const { opts } = await host();
    const call = (method: string, path: string, body?: unknown) => handleEngineRequest({ method, path, headers: { authorization: "Bearer good" }, body }, opts);
    expect((await call("PATCH", "/v1/accounts/acc_1/notices", { alert: false })).status).toBe(200);
    expect((await call("PATCH", "/v1/accounts/acc_1/notices", { alert: "no" })).status).toBe(400);
    expect((await call("PATCH", "/v1/accounts/acc_1/notices", {})).status).toBe(400);
    expect((await call("PUT", "/v1/accounts/acc_1/notices", { alert: true })).status).toBe(405);
    expect((await call("PATCH", "/v1/accounts/acc_1/notices/x", { alert: true })).status).toBe(404);
    expect((await call("PATCH", "/v1/accounts/acc_2/notices", { alert: true })).status).toBe(403);
    expect(parseNotices({ target: false })).toEqual({ target: false });
    expect(() => parseNotices([])).toThrow(/JSON object/);
  });

  it("createEngineServer sends a fired alert to the trader with nobody online", async () => {
    let now = T0;
    const store = new MemoryStore(), feed = new StaticQuoteFeed();
    const sent: Notice[] = [];
    const notifier = new EngineNotifier({ send: async n => { sent.push(n); return "sent"; }, recipient: async id => (id === "acc_1" ? { email: "t@example.com" } : null), prefsFor: storePrefs(store), clock: () => now });
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 }, store, rulesFor: async () => rules, feed,
      accounts: () => ["acc_1"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => false, notifier, clock: () => now,
      runner: { intervalMs: 1_000_000, schedule: () => 0, cancel: () => {} },
    });
    engine.start();
    feed.push(q("EURUSD", 1.08, 1.0801));
    await engine.venue.open("acc_1");
    const status = await engine.handle({ method: "GET", path: "/v1/status", headers: { authorization: "Bearer x" } });
    expect(status.body).toMatchObject({ notices: true });
    const added = await engine.handle({ method: "POST", path: "/v1/accounts/acc_1/alerts", headers: { authorization: "Bearer x" }, body: { symbol: "EURUSD", condition: "above", price: 1.085 } });
    expect(added.status).toBe(200);
    now = T0 + 1000;
    feed.push(q("EURUSD", 1.0851, 1.0852, now));
    // Setting an alert makes the account "watched": it is checked on the very next round, not a minute later.
    // Setting an alert makes the account "watched", so the new price is checked at once (not up to a minute later).
    await engine.runner.runOnce();
    await flush(); await notifier.flush();
    expect(sent.map(n => n.subject)).toEqual(["Price alert: EURUSD bid went above 1.08500"]);
    expect(engine.status().notifier).toMatchObject({ sent: 1 });
    await engine.stop();
  });
});

describe("terminal: Email me when… in the Alerts tab", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); mocks.toast.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });
  const account = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };
  async function setup(gatewayFor: (venue: LocalVenue) => unknown) {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [account] } : account);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q("EURUSD", 1.08, 1.0801, Date.now()));
    await venue.open(account.accountId);
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={gatewayFor(venue) as LocalGatewayAdapter} />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: "Alerts" }));
    return { venue, box: await screen.findByTestId("notice-settings") };
  }

  it("shows the choices, saves a change on the server and says the sender is connected", async () => {
    const { venue, box } = await setup(v => new LocalGatewayAdapter(v, { notices: true }));
    await waitFor(() => expect(within(box).getByTestId("notice-alert")).toBeChecked());
    expect(within(box).getByTestId("notice-fill")).not.toBeChecked();
    expect(within(box).getByTestId("notice-limit")).toBeChecked();
    expect(within(box).getByTestId("notice-status")).toHaveTextContent("Sent to the email address of your FYNX account");
    await act(async () => { fireEvent.click(within(box).getByTestId("notice-stop")); });
    expect(await within(box).findByTestId("notice-saved")).toHaveTextContent("On: a stop loss or take profit closes a trade.");
    expect((await venue.snapshot(account.accountId)).state.notices?.stop).toBe(true);
    await waitFor(() => expect(within(box).getByTestId("notice-stop")).toBeChecked());
  });

  it("is honest when no email sender is connected, and when trading is not connected", async () => {
    const { box } = await setup(v => new LocalGatewayAdapter(v));
    await waitFor(() => expect(within(box).getByTestId("notice-status")).toHaveTextContent("Emails start once FYNX connects the email sender; nothing is emailed before that."));
    cleanup();
    const off = await setup(() => new DisconnectedGateway());
    expect(within(off.box).getByTestId("notice-status")).toHaveTextContent("Email notices can be chosen once the trading server is connected.");
    expect(within(off.box).getByTestId("notice-alert")).toBeDisabled();
    expect(within(off.box).getByTestId("notice-alert")).not.toBeChecked();
  });
});

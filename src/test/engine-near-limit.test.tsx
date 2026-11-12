import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEAR_LIMIT_PERCENT, metrics, nearLimitCheck, nearLimitPercent, NEAR_WARNINGS_KEPT, newAccount, setNotices, tick, tradingDayKey, type EngineContext } from "@/engine/core";
import type { AccountState, NearLimitWarning, Position, Quote, RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest, parseNotices, type HostOptions } from "@/engine/host";
import { createEngineServer } from "@/engine/server";
import { fromFirestoreData, toFirestoreData } from "@/engine/firestore-store";
import { EngineNotifier, noticesFor, storePrefs, type Notice } from "@/engine/notifier";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { nearPreview, newlyWarned, previewSentence, todaysWarnings, warningSentence } from "@/trade-access/near-limit";

const mocks = vi.hoisted(() => ({ call: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "u1" }, signOut: vi.fn(async () => {}) }) }));
vi.mock("@/services/funded-access", () => ({ fundedAccessCall: mocks.call }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/trade-access/TvWidget", () => ({ default: ({ title }: { title: string }) => <div data-testid="tv-widget">{title}</div>, readLiveConsent: () => false, saveLiveConsent: () => {} }));
import TradeAccess from "@/trade-access/TradeAccess";

// Daily limit 5% of $10,000 → level $9,500 (allowance $500); maximum 10% → level $9,000 (allowance $1,000).
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 });
const T0 = Date.parse("2026-11-11T10:00:00Z"); // Wednesday, markets open
const DAY = tradingDayKey(T0, 22);
const q = (bid: number, time: number, symbol = "EURUSD"): Quote => ({ symbol, bid, ask: Number((bid + 0.0001).toFixed(5)), time });
const ctx = (now: number, quotes: Quote[] = []): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}x` });
const pos = (over: Partial<Position> = {}): Position => ({ id: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, openedAt: T0 - 3_600_000, commission: 0, ...over });
const account = (over: Partial<AccountState> = {}): AccountState => ({ ...newAccount("acc1", rules, T0 - 3_600_000), positions: [pos()], notices: { near: true }, ...over });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const m = (equity: number, state: AccountState) => ({ equity, dailyLossFloor: state.dayStartBalance * 0.95, maxLossFloor: 9000 });

describe("close-to-limit warning: the rule", () => {
  it("is off by default and uses 25% of the allowance until the trader picks a distance", () => {
    const plain = newAccount("a", rules, T0);
    expect(nearLimitCheck(plain, m(9600, plain), rules, T0)).toBeNull();
    expect(DEFAULT_NEAR_LIMIT_PERCENT).toBe(25);
    expect(nearLimitPercent({})).toBe(25);
    expect(nearLimitPercent({ nearLimitPercent: 10 })).toBe(10);
    expect(nearLimitPercent({ nearLimitPercent: 3 })).toBe(25); // out of range in storage → default
  });

  it("warns at or below the chosen share, never above it", () => {
    const s = account();
    expect(nearLimitCheck(s, m(9630, s), rules, T0)).toBeNull(); // $130 left = 26%
    const w = nearLimitCheck(s, m(9625, s), rules, T0)!; // $125 left = 25%
    expect(w).toEqual({ tradingDay: DAY, limit: "daily", at: T0, equity: 9625, floor: 9500, room: 125, allowance: 500, roomPercent: 25, thresholdPercent: 25 });
    const ten = { ...s, nearLimitPercent: 10 };
    expect(nearLimitCheck(ten, m(9600, ten), rules, T0)).toBeNull(); // 20% left, warns only at 10%
    expect(nearLimitCheck(ten, m(9549, ten), rules, T0)).toMatchObject({ room: 49, roomPercent: 9.8, thresholdPercent: 10 });
  });

  it("names the maximum loss limit when it is the closer one", () => {
    const s = account({ balance: 9200, dayStartBalance: 9200 }); // daily level 8,740, maximum level 9,000 (closer)
    expect(nearLimitCheck(s, m(9200, s), rules, T0)).toMatchObject({ limit: "maximum", floor: 9000, room: 200, allowance: 1000, roomPercent: 20 });
  });

  it("warns once per limit per trading day; a new day starts again", () => {
    const warned: NearLimitWarning = { tradingDay: DAY, limit: "daily", at: T0, equity: 9620, floor: 9500, room: 120, allowance: 500, roomPercent: 24, thresholdPercent: 25 };
    const s = account({ nearWarnings: [warned] });
    expect(nearLimitCheck(s, m(9560, s), rules, T0 + 1000)).toBeNull();
    const nextDay = { ...s, tradingDay: "2026-11-12" };
    expect(nearLimitCheck(nextDay, m(9560, nextDay), rules, T0 + 86_400_000)).toMatchObject({ tradingDay: "2026-11-12", limit: "daily" });
  });

  it("stays quiet on accounts that are not trading or at/below the level itself", () => {
    const s = account();
    expect(nearLimitCheck({ ...s, status: "breached" }, m(9600, s), rules, T0)).toBeNull();
    expect(nearLimitCheck(s, m(9500, s), rules, T0)).toBeNull(); // that is the loss limit, not a warning
    expect(nearLimitCheck(s, m(Number.NaN, s), rules, T0)).toBeNull();
  });
});

describe("close-to-limit warning in the timer step", () => {
  it("writes one warning and one event when equity crosses the distance, and nothing more that day", () => {
    const s = account({ dayLow: { tradingDay: DAY, equity: 9615, at: T0 - 1000 } });
    const step = tick(s, ctx(T0, [q(1.0762, T0)])); // equity 9,620: $120 left
    expect(step.events).toEqual([{ type: "limit_near", warning: expect.objectContaining({ limit: "daily", room: 120, roomPercent: 24 }) }]);
    expect(step.state.nearWarnings).toHaveLength(1);
    expect(step.state.sequence).toBe(s.sequence + 1);
    const again = tick(step.state, ctx(T0 + 1000, [q(1.0761, T0 + 1000)]));
    expect(again.events).toEqual([]);
    expect(again.state.nearWarnings).toHaveLength(1);
  });

  it("does nothing with the warning off, on stale prices, or at a breach", () => {
    const off = account({ notices: {}, dayLow: { tradingDay: DAY, equity: 9600, at: T0 } });
    expect(tick(off, ctx(T0 + 1000, [q(1.0762, T0 + 1000)])).state).toBe(off);
    expect(tick(account(), ctx(T0 + 10_000, [q(1.0762, T0)])).events).toEqual([]);
    const breach = tick(account(), ctx(T0, [q(1.0749, T0)]));
    expect(breach.events.map(e => e.type)).not.toContain("limit_near");
    expect(breach.state.status).toBe("breached");
  });

  it("keeps the newest warnings only", () => {
    const old: NearLimitWarning[] = Array.from({ length: NEAR_WARNINGS_KEPT }, (_, i) => ({ tradingDay: `2026-10-${String(i + 1).padStart(2, "0")}`, limit: "daily", at: i, equity: 9600, floor: 9500, room: 100, allowance: 500, roomPercent: 20, thresholdPercent: 25 }));
    const step = tick(account({ nearWarnings: old }), ctx(T0, [q(1.0762, T0)]));
    expect(step.state.nearWarnings).toHaveLength(NEAR_WARNINGS_KEPT);
    expect(step.state.nearWarnings![0].tradingDay).toBe(DAY);
  });
});

describe("close-to-limit warning: choices, storage and contract", () => {
  it("saves the distance with the notice choices and refuses wrong values", () => {
    const s = newAccount("a", rules, T0);
    const step = setNotices(s, { near: true, nearPercent: 10 });
    expect(step.state.notices?.near).toBe(true);
    expect(step.state.nearLimitPercent).toBe(10);
    expect(step.events[0]).toMatchObject({ type: "notices_changed", nearLimitPercent: 10 });
    expect(setNotices(s, { nearPercent: 50 }).state.nearLimitPercent).toBe(50);
    for (const bad of [4, 91, 12.5, "25"]) expect(() => setNotices(s, { nearPercent: bad as number })).toThrow(/whole percent from 5 to 90/);
    expect(parseNotices({ near: true, nearPercent: 25 })).toEqual({ near: true, nearPercent: 25 });
    expect(() => parseNotices({ nearPercent: 0 })).toThrow(/nearPercent/);
    expect(() => parseNotices({ near: 1 })).toThrow(/true or false/);
  });

  it("round-trips through Firestore and refuses malformed warnings", () => {
    const step = tick(account(), ctx(T0, [q(1.0762, T0)]));
    const stored = { ...step.state, nearLimitPercent: 25 };
    expect(fromFirestoreData("acc1", toFirestoreData(stored))).toEqual(stored);
    expect(() => fromFirestoreData("acc1", toFirestoreData({ ...stored, nearWarnings: [{ limit: "weekly" }] } as never))).toThrow(/malformed/);
    expect(() => fromFirestoreData("acc1", toFirestoreData({ ...stored, nearLimitPercent: 200 }))).toThrow(/malformed/);
  });

  it("changes the distance over the HTTP contract", async () => {
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    await venue.open("acc_1");
    const opts: HostOptions = { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => false, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "t", fetcher);
    const snap = await gw.setNotices("acc_1", { near: true, nearPercent: 10 });
    expect(snap.state).toMatchObject({ notices: { near: true }, nearLimitPercent: 10 });
    await expect(gw.setNotices("acc_1", { nearPercent: 1 })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("close-to-limit warning: the email", () => {
  it("says how much is left, of what, and that nothing was traded", () => {
    const warning: NearLimitWarning = { tradingDay: DAY, limit: "daily", at: T0, equity: 9620, floor: 9500, room: 120, allowance: 500, roomPercent: 24, thresholdPercent: 25 };
    const [n] = noticesFor("acc1", [{ type: "limit_near", warning }], T0);
    expect(n).toMatchObject({ id: `acc1:near:daily:${DAY}`, kind: "near", subject: "Close to your daily loss limit: $120.00 left" });
    expect(n.text).toContain("your equity was $9620.00, which is $120.00 above the daily loss limit level of $9500.00 (24.0% of the $500.00 allowance left; you asked to be warned at 25% or less)");
    expect(n.text).toContain("nothing was opened or closed");
    expect(n.text).toContain("starts again at the next daily reset");
    const [max] = noticesFor("acc1", [{ type: "limit_near", warning: { ...warning, limit: "maximum", floor: 9000, allowance: 1000 } }], T0);
    expect(max.subject).toMatch(/^Close to your maximum loss limit/);
    expect(max.text).toContain("does not reset");
  });

  it("createEngineServer emails it once, with nobody online, only when the trader switched it on", async () => {
    let now = T0;
    const store = new MemoryStore(), feed = new StaticQuoteFeed();
    const sent: Notice[] = [];
    const notifier = new EngineNotifier({ send: async n => { sent.push(n); return "sent"; }, recipient: async () => ({ email: "t@example.com" }), prefsFor: storePrefs(store), clock: () => now });
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, maxQuoteAgeMs: 60_000 }, store, rulesFor: async () => rules, feed,
      accounts: () => ["acc_1"], verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true, notifier, clock: () => now,
      runner: { intervalMs: 1_000_000, schedule: () => 0, cancel: () => {} },
    });
    engine.start();
    feed.push(q(1.08, now));
    await engine.venue.open("acc_1");
    const call = (method: string, path: string, body?: unknown) => engine.handle({ method, path, headers: { authorization: "Bearer x" }, body });
    expect((await call("POST", "/v1/accounts/acc_1/orders", { symbol: "EURUSD", side: "buy", type: "market", lots: 1 })).status).toBe(200);
    // Off by default: a deep dip sends nothing.
    now = T0 + 1000; feed.push(q(1.0763, now));
    await engine.runner.runOnce(); await flush(); await notifier.flush();
    expect(sent).toEqual([]);
    expect((await call("PATCH", "/v1/accounts/acc_1/notices", { near: true, nearPercent: 25 })).status).toBe(200);
    now = T0 + 2000; feed.push(q(1.0762, now));
    await engine.runner.runOnce(); await flush(); await notifier.flush();
    now = T0 + 3000; feed.push(q(1.0758, now));
    await engine.runner.runOnce(); await flush(); await notifier.flush();
    expect(sent.map(n => n.subject)).toEqual([expect.stringMatching(/^Close to your daily loss limit: \$1\d\d\.\d\d left$/)]);
    await engine.stop();
  });
});

describe("terminal: close-to-limit setting and pop-up", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(T0)); mocks.toast.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });
  const acct = {
    accountId: "acc-1234567890", challengeId: "ch-1", orderId: "o1", platform: "FYNX Trade", status: "active", activationStatus: "active",
    currentPhase: 1, startingBalance: 10000, balance: 10000, equity: 10000, tradingEnabled: true, tradingHoldReason: "",
    rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 5 },
  };

  it("helpers: dollars for the chosen distance, today's warnings and pop-ups once", () => {
    const s = account();
    const p = nearPreview(s, metrics(s, ctx(T0, [q(1.079, T0)])), 25)!;
    expect(p).toEqual({ percent: 25, dailyAllowance: 500, warnAtRoom: 125, warnAtEquity: 9625, roomNow: 400 });
    expect(previewSentence(p)).toContain("$125.00 or less above today's daily loss level (equity $9,625.00 or lower, of a $500.00 daily allowance)");
    expect(nearPreview({ dayStartBalance: 9500 }, { equity: 9500, dailyLossFloor: 9500 })).toBeNull();
    const w: NearLimitWarning = { tradingDay: DAY, limit: "daily", at: T0, equity: 9620, floor: 9500, room: 120, allowance: 500, roomPercent: 24, thresholdPercent: 25 };
    expect(todaysWarnings({ tradingDay: DAY, nearWarnings: [w, { ...w, tradingDay: "2026-11-01" }] })).toEqual([w]);
    expect(warningSentence(w, () => "11:00")).toBe("Daily loss limit: $120.00 left (24.0% of $500.00) at 11:00, equity $9,620.00");
    const seen = new Set<string>();
    expect(newlyWarned([w], seen)).toEqual([w]);
    expect(newlyWarned([w], seen)).toEqual([]);
  });

  it("shows the distance in dollars, saves a new one, lists today's warning and pops it up once", async () => {
    mocks.call.mockReset().mockImplementation(async (_n: string, d: { action: string }) => d.action === "list" ? { accounts: [acct] } : acct);
    const venue = new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 });
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    feed.push(q(1.08, Date.now()));
    await venue.open(acct.accountId);
    await venue.setNotices(acct.accountId, { near: true });
    await venue.place(acct.accountId, { symbol: "EURUSD", side: "buy", type: "market", lots: 1 });
    render(<MemoryRouter initialEntries={["/trade"]}><Routes><Route path="/trade" element={<TradeAccess gateway={new LocalGatewayAdapter(venue, { notices: true })} />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: "Alerts" }));
    const box = await screen.findByTestId("notice-settings");
    await waitFor(() => expect(within(box).getByTestId("notice-near")).toBeChecked());
    expect(within(box).getByTestId("near-preview")).toHaveTextContent("With 25%: you are warned once equity is $125.00 or less above today's daily loss level");
    await act(async () => { fireEvent.change(within(box).getByTestId("near-percent"), { target: { value: "10" } }); });
    expect(await within(box).findByTestId("notice-saved")).toHaveTextContent("Close-to-limit warning at 10% of the allowance left.");
    expect((await venue.snapshot(acct.accountId)).state.nearLimitPercent).toBe(10);
    await waitFor(() => expect(within(box).getByTestId("near-preview")).toHaveTextContent("With 10%: you are warned once equity is $50.00 or less"));
    // Price falls to $20 above the daily level (equity $9,520). The next server step writes the warning;
    // the open terminal lists it and pops it up once.
    feed.push(q(1.0753, Date.now()));
    await act(async () => { fireEvent.change(within(box).getByTestId("near-percent"), { target: { value: "25" } }); });
    await waitFor(() => expect(within(box).getByTestId("near-today")).toHaveTextContent("Daily loss limit: $20.00 left (4.0% of $500.00)"));
    expect((await venue.snapshot(acct.accountId)).state.nearWarnings?.[0]).toMatchObject({ limit: "daily", thresholdPercent: 10, room: 20 });
    const popups = mocks.toast.mock.calls.filter(c => String(c[0]).startsWith("Close to your"));
    expect(popups).toEqual([["Close to your daily loss limit", { description: expect.stringContaining("$20.00 left") }]]);
  });
});

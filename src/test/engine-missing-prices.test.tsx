import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { closePosition, dayCloseRecord, metrics, missingPrices, newAccount, placeOrder, tick, type EngineContext } from "@/engine/core";
import { EngineError, type AccountState, type Position, type Quote, type RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter } from "@/engine/gateway";
import { handleEngineRequest } from "@/engine/host";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { liveAccountSummary, metricsGaps } from "@/trade-access/live-account";
import { useEngine } from "@/trade-access/useEngine";
import LiveTradeAccountCard from "@/components/LiveTradeAccountCard";

const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22, consistencyPercent: 40 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 });
const NOW = Date.parse("2026-11-11T10:00:00Z"); // a Wednesday, forex open
const q = (symbol: string, bid: number, spread = 0.0001, time = NOW): Quote => ({ symbol, bid, ask: Math.round((bid + spread) * 1e6) / 1e6, time });
const ctx = (quotes: Quote[], now = NOW): EngineContext => ({ specs, quotes: Object.fromEntries(quotes.map(x => [x.symbol, x])), rules, now, maxQuoteAgeMs: 5000, newId: p => `${p}_new` });
const pos = (over: Partial<Position>): Position => ({ id: "p1", symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, openedAt: NOW - 3_600_000, commission: 0, ...over });
const account = (over: Partial<AccountState> = {}): AccountState => ({ ...newAccount("acc1", rules, NOW - 3_600_000), ...over });

// A big winner on GBP/JPY (bought at 190.00, now 193.00 = +3000 JPY×100k… about +1,900 USD)
// and a loser on EUR/USD (bought 1.0850, now 1.0700 bid = -1,500 USD).
const winner = pos({ id: "gj", symbol: "GBPJPY", entryPrice: 190, lots: 1 });
const loser = pos({ id: "eu", symbol: "EURUSD", entryPrice: 1.085, lots: 1 });
const eurusd = q("EURUSD", 1.07), gbpjpy = q("GBPJPY", 193, 0.02), usdjpy = q("USDJPY", 155, 0.01), gbpusd = q("GBPUSD", 1.25);

describe("account figures while a price is missing (e.g. right after a restart)", () => {
  it("never throws: a trade without its dollar conversion is listed, not guessed", () => {
    const s = account({ positions: [winner, loser] });
    // GBP/JPY has a price but there is no USD/JPY yet to turn yen into dollars, and no GBP/USD for its margin.
    const m = metrics(s, ctx([eurusd, gbpjpy]));
    expect(m.unpriced).toEqual(["GBPJPY"]);
    expect(m.marginUnpriced).toEqual(["GBPJPY"]);
    expect(m.floatingProfit).toBe(-1500); // only the trade that can be valued
    expect(missingPrices(m)).toEqual(["GBPJPY"]);
    // With USD/JPY the result is known; the margin still needs GBP/USD.
    const m2 = metrics(s, ctx([eurusd, gbpjpy, usdjpy]));
    expect(m2.unpriced).toBeUndefined();
    expect(m2.marginUnpriced).toEqual(["GBPJPY"]);
    // Everything priced: no gap fields at all (snapshots stay as before).
    const m3 = metrics(s, ctx([eurusd, gbpjpy, usdjpy, gbpusd]));
    expect(Object.keys(m3)).not.toContain("unpriced");
    expect(Object.keys(m3)).not.toContain("marginUnpriced");
    expect(m3.equity).toBeGreaterThan(10000);
  });

  it("lists a trade whose own pair has no price yet", () => {
    const m = metrics(account({ positions: [winner, loser] }), ctx([eurusd]));
    expect(m.unpriced).toEqual(["GBPJPY"]);
  });

  it("does not close the account on a partial equity figure, and checks the limits once every price is in", () => {
    const s = account({ positions: [winner, loser] });
    // Without the GBP/JPY value equity would look like 8,500, below both limits. It must wait.
    const waiting = tick(s, ctx([eurusd]));
    expect(waiting.state.status).toBe("active");
    expect(waiting.state.positions).toHaveLength(2);
    expect(waiting.events.some(e => e.type === "account_breached")).toBe(false);
    // Same with the pair priced but no conversion: no crash, no breach.
    expect(tick(s, ctx([eurusd, gbpjpy])).state.status).toBe("active");
    // All prices in: the real equity is above the limits, so it stays open.
    const full = tick(s, ctx([eurusd, gbpjpy, usdjpy]));
    expect(full.state.status).toBe("active");
    // And a real breach is still caught on complete prices.
    const crash = tick(s, ctx([eurusd, q("GBPJPY", 188, 0.02), usdjpy]));
    expect(crash.state.status).toBe("breached");
    expect(crash.state.positions).toHaveLength(0);
  });

  it("refuses new orders until free margin can be worked out, then accepts them", () => {
    const s = account({ positions: [pos({ id: "ej", symbol: "EURJPY", entryPrice: 165 })] });
    const req = { symbol: "EURUSD", side: "buy" as const, type: "market" as const, lots: 0.1 };
    const partial = ctx([eurusd, q("EURJPY", 165.5, 0.02)]); // no USD/JPY
    let err: unknown;
    try { placeOrder(s, req, partial); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("no_conversion");
    expect((err as EngineError).message).toContain("EURJPY");
    expect((err as EngineError).message).toContain("Nothing was sent");
    const ok = placeOrder(s, req, ctx([eurusd, q("EURJPY", 165.5, 0.02), usdjpy]));
    expect(ok.state.positions).toHaveLength(2);
  });

  it("still lets the trader close a trade that can be valued", () => {
    const s = account({ positions: [winner, loser] });
    const step = closePosition(s, "eu", undefined, ctx([eurusd]));
    expect(step.state.positions.map(p => p.id)).toEqual(["gj"]);
    expect(step.state.history[0].netProfit).toBe(-1500);
  });

  it("leaves the end-of-day equity blank while a trade is unvalued", () => {
    const rec = dayCloseRecord(account({ positions: [winner] }), ctx([gbpjpy], Date.parse("2026-11-11T22:00:30Z")));
    expect(rec.closingEquity).toBeNull();
    expect(rec.roomAtClose).toBeNull();
  });
});

describe("through the venue and the HTTP contract", () => {
  it("answers snapshots and commands after a restart instead of failing every request", async () => {
    const store = new MemoryStore();
    await store.save(account({ positions: [winner, loser] }), -1);
    const venue = new LocalVenue(specs, store, async () => rules, { maxQuoteAgeMs: 5000 }, () => NOW);
    venue.quotes.EURUSD = eurusd; // only one price in so far
    const snap = await venue.snapshot("acc1");
    expect(snap.metrics.unpriced).toEqual(["GBPJPY"]);
    expect(snap.state.status).toBe("active");
    const closed = await venue.close("acc1", "eu");
    expect(closed.state.positions.map(p => p.id)).toEqual(["gj"]);

    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }, { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) });
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const gw = new HttpGateway("https://api.example.com", async () => "t", fetcher);
    expect((await gw.snapshot("acc1")).metrics.unpriced).toEqual(["GBPJPY"]);
    await expect(gw.placeOrder("acc1", { symbol: "EURUSD", side: "buy", type: "market", lots: 0.1 })).rejects.toMatchObject({ code: "no_conversion" });
  });
});

describe("what the trader sees", () => {
  afterEach(cleanup);

  it("says which trade is waiting for a price, in plain words", () => {
    expect(metricsGaps({}).message).toBe("");
    const g = metricsGaps({ unpriced: ["GBPJPY"], marginUnpriced: ["GBPJPY", "EURJPY"] });
    expect(g).toMatchObject({ equityKnown: false, marginKnown: false, missing: ["EURJPY", "GBPJPY"] });
    expect(g.message).toContain("EURJPY, GBPJPY trades");
    expect(g.message).toContain("room left before the loss limits");
    expect(metricsGaps({ marginUnpriced: ["EURJPY"] }).message).toContain("margin and free margin");
  });

  describe("dashboard live card", () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW)); });
    afterEach(() => { vi.useRealTimers(); });

    function Harness({ venue }: { venue: LocalVenue }) {
      const engine = useEngine("acc1", new LocalGatewayAdapter(venue), { pollMs: 5000 });
      return <MemoryRouter><LiveTradeAccountCard engine={engine} accountId="acc1" startingBalance={10000} /></MemoryRouter>;
    }

    it("shows 'Waiting for prices' instead of a partial equity or room", async () => {
      const store = new MemoryStore();
      await store.save(account({ positions: [winner, loser] }), -1);
      const venue = new LocalVenue(specs, store, async () => rules, { maxQuoteAgeMs: 60_000 }, () => Date.now());
      venue.quotes.EURUSD = { ...eurusd, time: Date.now() };
      const s = liveAccountSummary(await venue.snapshot("acc1"), 10000);
      expect(s.gaps.equityKnown).toBe(false);
      render(<Harness venue={venue} />);
      const card = await screen.findByTestId("live-trade-card");
      await waitFor(() => expect(within(card).getByTestId("live-prices-missing")).toHaveTextContent("GBPJPY"));
      expect(within(card).getByTestId("room-daily-loss-limit")).toHaveTextContent("Waiting for prices");
      expect(within(card).getByTestId("room-daily-loss-limit")).not.toHaveTextContent("left");
      expect(within(within(card).getByTestId("room-daily-loss-limit")).queryByRole("progressbar")).toBeNull();
      expect(card).not.toHaveTextContent("$8,500.00");
    });
  });
});

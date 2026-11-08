import { describe, expect, it, vi } from "vitest";
import type { RuleSet } from "@/engine/types";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { HttpGateway, LocalGatewayAdapter, parseMarkets } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { FOREX_HOURS } from "@/engine/hours";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { closedSentence, pairMarket, untilLabel } from "@/trade-access/market-hours";

const WED = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const holiday = { from: Date.parse("2026-11-04T00:00:00Z"), to: Date.parse("2026-11-05T00:00:00Z"), reason: "Provider holiday" };

function venueAt(now: number) {
  const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, hoursBySymbol: { USDJPY: { ...FOREX_HOURS, closures: [holiday] } } });
  return new LocalVenue(specs, new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => now);
}

describe("market state per symbol", () => {
  it("LocalVenue.markets reports every pair, including a holiday closure on one", () => {
    const m = venueAt(WED).markets();
    expect(Object.keys(m)).toHaveLength(45);
    expect(m.EURUSD).toEqual({ open: true, nextChange: Date.parse("2026-11-06T22:00:00Z"), reason: null });
    expect(m.USDJPY).toEqual({ open: false, nextChange: holiday.to, reason: "Provider holiday" });
    expect(venueAt(WED).markets(["GBPUSD", "XAUUSD"])).toEqual({ GBPUSD: m.GBPUSD }); // unknown symbols are skipped
    const sat = venueAt(Date.parse("2026-11-07T12:00:00Z")).markets();
    expect(sat.EURUSD).toEqual({ open: false, nextChange: Date.parse("2026-11-08T22:00:00Z"), reason: "Outside trading hours" });
  });

  it("/v1/status carries the markets from the host to HttpGateway and the local adapter", async () => {
    const venue = venueAt(WED);
    const feed = new StaticQuoteFeed(); venue.connect(feed); feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: WED });
    const opts: HostOptions = { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => true, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const r = await handleEngineRequest({ method: "GET", path: "/v1/status", headers: { Authorization: "Bearer t" } }, opts);
    expect(r.status).toBe(200);
    expect((r.body as { markets: Record<string, unknown> }).markets.USDJPY).toEqual({ open: false, nextChange: holiday.to, reason: "Provider holiday" });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(r.body), { status: 200 }));
    const s = await new HttpGateway("https://api.example.com", async () => "t", fetcher).status();
    expect(s.markets?.USDJPY.reason).toBe("Provider holiday");
    expect(s.markets?.EURUSD.open).toBe(true);
    expect((await new LocalGatewayAdapter(venue).status()).markets?.USDJPY.open).toBe(false);
  });

  it("drops malformed market entries from a server answer", () => {
    expect(parseMarkets(undefined)).toBeUndefined();
    expect(parseMarkets([])).toBeUndefined();
    expect(parseMarkets({ eurusd: { open: true } })).toBeUndefined();
    const parsed = parseMarkets({
      EURUSD: { open: true, nextChange: 1, reason: "ignored while open" },
      GBPUSD: { open: "yes" },
      USDJPY: { open: false, nextChange: -5 },
      USDCHF: { open: false, nextChange: null, reason: "x".repeat(200) },
      AUDUSD: { open: false },
      NZDUSD: null,
    });
    expect(parsed).toEqual({ EURUSD: { open: true, nextChange: 1, reason: null }, AUDUSD: { open: false, nextChange: null, reason: "Outside trading hours" } });
  });

  it("a server without markets keeps working (older contract)", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ priceFeed: true, execution: false, message: "warming up" }), { status: 200 }));
    expect(await new HttpGateway("https://api.example.com", async () => "t", fetcher).status()).toEqual({ connected: true, priceFeed: true, execution: false, message: "warming up" });
  });
});

describe("terminal market helper", () => {
  it("uses the server's state until it changes, then the forex week", () => {
    const status = { connected: true, priceFeed: true, execution: true, message: "", markets: { USDJPY: { open: false, nextChange: holiday.to, reason: "Provider holiday" } } };
    expect(pairMarket(status, "USDJPY", WED)).toMatchObject({ open: false, reason: "Provider holiday", source: "server" });
    expect(pairMarket(status, "USDJPY", holiday.to + 1)).toMatchObject({ open: true, source: "schedule" });
    expect(pairMarket(status, "EURUSD", WED)).toMatchObject({ open: true, source: "schedule" });
    expect(pairMarket(null, "EURUSD", Date.parse("2026-11-07T12:00:00Z"))).toMatchObject({ open: false, nextChange: Date.parse("2026-11-08T22:00:00Z") });
  });
  it("says why and when in plain words", () => {
    const text = closedSentence("USDJPY", { open: false, nextChange: holiday.to, reason: "Provider holiday" }, WED);
    expect(text).toMatch(/^The USDJPY market is closed \(Provider holiday\)\. It opens .+ your time, in 14h 00m\.$/);
    expect(closedSentence("EURUSD", { open: false, nextChange: null, reason: "Outside trading hours" }, WED)).toBe("The EURUSD market is closed.");
    expect(untilLabel(90_061_000)).toBe("1d 1h 02m");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Quote, RuleSet } from "@/engine/types";
import { applySpread, spreadRuleFor, spreadRuleProblem, spreadRuleText, traderSpreadPips } from "@/engine/spread";
import { buildSpecs, LocalVenue, MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { readEngineConfig } from "@/engine/config";
import { describeSpread, engineChecklist, probeFeed } from "@/engine/preflight";
import { HttpGateway, LocalGatewayAdapter, parseInstruments } from "@/engine/gateway";
import { handleEngineRequest, type HostOptions } from "@/engine/host";
import { FOREX_PAIRS, findPair } from "@/trade-access/instruments";
import ContractSpec, { pricingLabel } from "@/trade-access/ContractSpec";

const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const q = (symbol: string, bid: number, ask: number, time = T0): Quote => ({ symbol, bid, ask, time });
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 1, resetHourUtc: 22 };
const eur = { pipSize: 0.0001, tickSize: 0.00001 };
const jpy = { pipSize: 0.01, tickSize: 0.001 };
const pips = (x: Quote, pip: number) => Math.round(((x.ask - x.bid) / pip) * 10) / 10;
const engineEnv = { FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50", FYNX_ENGINE_ALLOWED_ORIGINS: "https://www.fynxfunded.com" };

afterEach(cleanup);

describe("spread markup: price rule", () => {
  it("adds the markup half to each side around the provider's middle price, never narrower than set", () => {
    const even = applySpread(q("EURUSD", 1.08, 1.0801), { ...eur, spread: { markupPips: 0.2 } });
    expect(even).toEqual(q("EURUSD", 1.07999, 1.08011));
    expect(pips(even, eur.pipSize)).toBe(1.2);
    // 0.15 pip per side is not on the 0.1-pip step: rounded away from the middle (1.4 pips, not 1.2).
    const odd = applySpread(q("EURUSD", 1.08, 1.0801), { ...eur, spread: { markupPips: 0.3 } });
    expect(odd).toEqual(q("EURUSD", 1.07998, 1.08012));
    expect(pips(odd, eur.pipSize)).toBeGreaterThanOrEqual(1.3);
    expect(applySpread(q("USDJPY", 150, 150.01), { ...jpy, spread: { markupPips: 1 } })).toEqual(q("USDJPY", 149.995, 150.015));
    expect(applySpread(q("EURUSD", 1.08, 1.0801), { ...eur, spread: { markupPips: 0.2 } }).time).toBe(T0);
  });

  it("widens to the minimum spread only when the provider's spread is narrower", () => {
    // 0.5 pips widened to 1.0: 0.25 pip per side, rounded away from the middle to the 0.1-pip step.
    expect(applySpread(q("EURUSD", 1.08, 1.08005), { ...eur, spread: { minSpreadPips: 1 } })).toEqual(q("EURUSD", 1.07997, 1.08008));
    const wide = q("EURUSD", 1.08, 1.0802);
    expect(applySpread(wide, { ...eur, spread: { minSpreadPips: 1 } })).toBe(wide);
    // Markup first, then the floor.
    expect(pips(applySpread(q("EURUSD", 1.08, 1.08002), { ...eur, spread: { markupPips: 0.4, minSpreadPips: 1 } }), eur.pipSize)).toBe(1);
    expect(pips(applySpread(q("EURUSD", 1.08, 1.0801), { ...eur, spread: { markupPips: 0.4, minSpreadPips: 1 } }), eur.pipSize)).toBe(1.4);
  });

  it("leaves the provider's price untouched without a rule or with zero values", () => {
    const raw = q("EURUSD", 1.08, 1.0801);
    expect(applySpread(raw, eur)).toBe(raw);
    expect(applySpread(raw, { ...eur, spread: { markupPips: 0, minSpreadPips: 0 } })).toBe(raw);
    expect(traderSpreadPips(1.2, null)).toBe(1.2);
    expect(traderSpreadPips(1.2, { markupPips: 0.3 })).toBe(1.5);
    expect(traderSpreadPips(0.2, { minSpreadPips: 0.8 })).toBe(0.8);
  });

  it("checks the rule and describes it in plain words", () => {
    expect(spreadRuleProblem({ markupPips: 0.3 })).toBeNull();
    expect(spreadRuleProblem({ minSpreadPips: 50 })).toBeNull();
    expect(spreadRuleProblem({})).toContain("needs markupPips");
    expect(spreadRuleProblem({ markupPips: 0.25 })).toContain("steps of 0.1");
    expect(spreadRuleProblem({ markupPips: -1 })).toContain("0 to 20");
    expect(spreadRuleProblem({ markupPips: 21 })).toContain("0 to 20");
    expect(spreadRuleProblem({ minSpreadPips: "1" })).toContain("minSpreadPips");
    expect(spreadRuleProblem({ markup: 1 })).toContain('unknown field "markup"');
    expect(spreadRuleProblem([1])).toContain("must be an object");
    expect(spreadRuleFor({ "*": { markupPips: 0.3 }, USDTRY: { minSpreadPips: 20 } }, "EURUSD")).toEqual({ markupPips: 0.3 });
    expect(spreadRuleFor({ "*": { markupPips: 0.3 }, USDTRY: { minSpreadPips: 20 } }, "USDTRY")).toEqual({ minSpreadPips: 20 });
    expect(spreadRuleFor({ USDTRY: { minSpreadPips: 20 } }, "EURUSD")).toBeNull();
    expect(spreadRuleFor(undefined, "EURUSD")).toBeNull();
    expect(spreadRuleText(null)).toBe("The liquidity provider’s price, no markup");
    expect(spreadRuleText({ markupPips: 0.3, minSpreadPips: 0.5 })).toBe("0.3 pips added to the provider’s spread, never below 0.5 pips");
    expect(spreadRuleText({ minSpreadPips: 2 })).toBe("The provider’s spread, never below 2.0 pips");
  });
});

describe("spread markup: settings", () => {
  it("buildSpecs gives every pair the \"*\" rule and lets a pair's own entry replace it", () => {
    const specs = buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, spread: { "*": { markupPips: 0.3 }, USDTRY: { minSpreadPips: 20 }, EURGBP: { markupPips: 0 } } });
    expect(specs.EURUSD.spread).toEqual({ markupPips: 0.3 });
    expect(specs.USDTRY.spread).toEqual({ minSpreadPips: 20 });
    expect(specs.EURGBP.spread).toBeUndefined();
    expect(buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50 }).EURUSD.spread).toBeUndefined();
    expect(() => buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, spread: { XXXYYY: { markupPips: 1 } } })).toThrow(/XXXYYY, which is not in the catalogue/);
    expect(() => buildSpecs(FOREX_PAIRS, { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, spread: { "*": { markupPips: 99 } } })).toThrow(/all pairs/);
  });

  it("reads FYNX_ENGINE_SPREAD and lists every problem before the host starts", () => {
    expect(readEngineConfig(engineEnv, FOREX_PAIRS).settings.spread).toBeUndefined();
    const c = readEngineConfig({ ...engineEnv, FYNX_ENGINE_SPREAD: '{"*":{"markupPips":0.3},"USDTRY":{"minSpreadPips":20}}' }, FOREX_PAIRS);
    expect(c.settings.spread).toEqual({ "*": { markupPips: 0.3 }, USDTRY: { minSpreadPips: 20 } });
    expect(() => readEngineConfig({ ...engineEnv, FYNX_ENGINE_SPREAD: "0.3" }, FOREX_PAIRS)).toThrow(/FYNX_ENGINE_SPREAD must be an object/);
    expect(() => readEngineConfig({ ...engineEnv, FYNX_ENGINE_SPREAD: "{bad" }, FOREX_PAIRS)).toThrow(/FYNX_ENGINE_SPREAD is not valid JSON/);
    let message = "";
    try { readEngineConfig({ ...engineEnv, FYNX_ENGINE_LEVERAGE: "", FYNX_ENGINE_SPREAD: '{"*":{"markupPips":0.25},"EURUSD":{"min":1}}' }, FOREX_PAIRS); } catch (e) { message = (e as Error).message; }
    expect(message).toContain("FYNX_ENGINE_LEVERAGE is missing.");
    expect(message).toContain('FYNX_ENGINE_SPREAD: "*" (every pair) markupPips must be 0 to 20 pips in steps of 0.1.');
    expect(message).toContain('FYNX_ENGINE_SPREAD: EURUSD has an unknown field "min"');
    expect(() => readEngineConfig({ ...engineEnv, FYNX_ENGINE_SPREAD: '{"ABCDEF":{"markupPips":1}}' }, FOREX_PAIRS)).toThrow(/ABCDEF, which is not in the catalogue/);
  });

  it("the readiness check says how prices are made and what traders get in the feed test", async () => {
    expect(describeSpread(undefined)).toContain("unchanged (no spread markup");
    expect(describeSpread({ "*": { markupPips: 0.3 }, USDTRY: { minSpreadPips: 20 } })).toBe("Prices: every pair: 0.3 pips added to the provider’s spread; own setting for USDTRY (FYNX_ENGINE_SPREAD). Traders see the same price in the terminal and the contract specification.");
    expect(describeSpread({ USDTRY: { minSpreadPips: 20 } })).toContain("pairs without their own setting: no markup");
    const items = engineChecklist({ ...engineEnv, FYNX_ENGINE_SPREAD: '{"*":{"markupPips":0.3}}' }, FOREX_PAIRS);
    expect(items[0].detail.some(d => d.startsWith("Prices: every pair: 0.3 pips"))).toBe(true);
    const real = new StaticQuoteFeed();
    const health = () => ({ connected: true, live: true, lastQuoteAt: T0, accepted: 1, rejected: {} as never, reconnects: 0, lastError: null });
    const probe = await probeFeed({ subscribe: (s, cb) => real.subscribe(s, cb), health }, FOREX_PAIRS.filter(p => p.symbol === "EURUSD"), 3, async () => { real.push(q("EURUSD", 1.1, 1.10012)); }, { "*": { markupPips: 0.3 } });
    expect(probe.received).toEqual([{ symbol: "EURUSD", count: 1, bid: 1.1, ask: 1.10012, spreadPips: 1.2, traderSpreadPips: 1.5 }]);
  });
});

describe("spread markup: through the venue", () => {
  const settings = { leverage: 30, commissionPerLotPerSide: 0, maxLots: 50, spread: { EURUSD: { markupPips: 1 } } };

  it("stores the marked-up price, fills at it and stops out on it", async () => {
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, settings), new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    const feed = new StaticQuoteFeed(); venue.connect(feed);
    const seen: Quote[] = []; venue.onQuote(x => seen.push(x));
    await venue.open("acc");
    feed.push(q("EURUSD", 1.08, 1.0801));
    feed.push(q("GBPUSD", 1.25, 1.2501));
    expect(venue.quotes.EURUSD).toEqual(q("EURUSD", 1.07995, 1.08015));
    expect(venue.quotes.GBPUSD).toEqual(q("GBPUSD", 1.25, 1.2501));
    expect(seen[0]).toEqual(venue.quotes.EURUSD);
    const buy = await venue.place("acc", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: 1.079 });
    expect(buy.state.positions[0].entryPrice).toBe(1.08015);
    const sell = await venue.place("acc", { symbol: "EURUSD", side: "sell", type: "market", lots: 1 });
    expect(sell.state.positions[1].entryPrice).toBe(1.07995);
    // The provider's bid 1.07905 is above the stop; with the markup the traders' bid is 1.079, which hits it.
    feed.push(q("EURUSD", 1.07905, 1.07915, T0 + 1000));
    const after = await venue.snapshot("acc");
    expect(after.state.positions).toHaveLength(1);
    expect(after.state.history[0]).toMatchObject({ reason: "stop_loss", exitPrice: 1.079 });
  });

  it("publishes the pricing in /v1/status, read by HttpGateway; older servers and malformed values are handled", async () => {
    const venue = new LocalVenue(buildSpecs(FOREX_PAIRS, { ...settings, spread: { "*": { markupPips: 0.3 }, USDTRY: { minSpreadPips: 20 } } }), new MemoryStore(), async () => rules, { maxQuoteAgeMs: 60_000 }, () => T0);
    expect(venue.conditions().EURUSD.spread).toEqual({ markupPips: 0.3, minSpreadPips: 0 });
    expect(venue.conditions().USDTRY.spread).toEqual({ markupPips: 0, minSpreadPips: 20 });
    const opts: HostOptions = { venue, verifyToken: async () => "u1", canAccess: async () => true, tradingEnabled: async () => false, status: () => ({ priceFeed: true, execution: true, message: "ok" }) };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const r = await handleEngineRequest({ method: init?.method ?? "GET", path: new URL(url).pathname, headers: (init?.headers ?? {}) as Record<string, string> }, opts);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const status = await new HttpGateway("https://api.example.com", async () => "t", fetcher).status();
    expect(status.instruments?.EURUSD.spread).toEqual({ markupPips: 0.3, minSpreadPips: 0 });
    expect((await new LocalGatewayAdapter(venue).status()).instruments?.USDTRY.spread).toEqual({ markupPips: 0, minSpreadPips: 20 });
    const base = { contractSize: 100000, minLots: 0.01, lotStep: 0.01, maxLots: 20, leverage: 30, commissionPerLotPerSide: 3.5, swap: null };
    const parsed = parseInstruments({ EURUSD: base, GBPUSD: { ...base, spread: null }, USDJPY: { ...base, spread: { markupPips: 0.5, minSpreadPips: 0 } }, AUDUSD: { ...base, spread: { markupPips: "0.5", minSpreadPips: 0 } }, NZDUSD: { ...base, spread: { markupPips: 99, minSpreadPips: 0 } } });
    expect(parsed?.EURUSD).not.toHaveProperty("spread");
    expect(parsed?.GBPUSD.spread).toBeNull();
    expect(parsed?.USDJPY.spread).toEqual({ markupPips: 0.5, minSpreadPips: 0 });
    // A malformed setting is dropped (shown as unknown), never guessed; the rest of the pair's conditions stay.
    expect(parsed?.AUDUSD).toEqual(base);
    expect(parsed?.NZDUSD).toEqual(base);
  });
});

describe("spread markup: contract specification", () => {
  const pair = findPair("EURUSD")!;
  const market = { open: true, reason: null, nextChange: null, source: "server" as const };
  const base = { contractSize: 100000, minLots: 0.01, lotStep: 0.01, maxLots: 20, leverage: 30, commissionPerLotPerSide: 3.5, swap: null };
  const show = (spread?: { markupPips: number; minSpreadPips: number } | null) => render(<ContractSpec pair={pair} market={market} now={T0} open onOpenChange={() => {}} trigger={false}
    status={{ connected: true, priceFeed: true, execution: true, message: "ok", instruments: { EURUSD: { ...base, ...(spread !== undefined ? { spread } : {}) } } }} />);

  it("shows how the server's price is made, and nothing when an older server does not say", () => {
    expect(pricingLabel(null)).toBe("Provider’s price, no markup");
    expect(pricingLabel({ markupPips: 0.3, minSpreadPips: 0 })).toBe("Provider + 0.3 pips");
    expect(pricingLabel({ markupPips: 0, minSpreadPips: 2 })).toBe("Provider’s spread, at least 2.0 pips");
    expect(pricingLabel({ markupPips: 0.5, minSpreadPips: 1 })).toBe("Provider + 0.5 pips, at least 1.0 pips");
    show({ markupPips: 0.3, minSpreadPips: 0 });
    expect(screen.getByTestId("spec-pricing").textContent).toBe("Provider + 0.3 pips");
    cleanup();
    show(null);
    expect(screen.getByTestId("spec-pricing").textContent).toBe("Provider’s price, no markup");
    cleanup();
    show();
    expect(screen.queryByTestId("spec-pricing")).toBeNull();
  });
});

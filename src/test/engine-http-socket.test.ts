/// <reference types="node" />
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RuleSet } from "@/engine/types";
import { MemoryStore, StaticQuoteFeed } from "@/engine/venue";
import { createEngineServer } from "@/engine/server";
import { HttpGateway } from "@/engine/gateway";
import { createHttpHandler } from "@/engine/http-adapter";
import { FOREX_PAIRS } from "@/trade-access/instruments";

const SITE = "https://www.fynxfunded.com";
const T0 = Date.parse("2026-11-04T10:00:00Z");
const rules: RuleSet = { startingBalance: 10000, dailyLossPercent: 5, maxLossPercent: 10, profitTargetPercent: 8, minTradingDays: 3, resetHourUtc: 22 };
let server: Server | null = null;
afterEach(() => new Promise<void>(r => (server ? server.close(() => r()) : r())));

describe("engine on a real node:http server", () => {
  it("answers a browser preflight and the terminal's gateway over a socket", async () => {
    const feed = new StaticQuoteFeed();
    const engine = createEngineServer({
      pairs: FOREX_PAIRS, settings: { leverage: 30, commissionPerLotPerSide: 3.5, maxLots: 50, maxQuoteAgeMs: 60_000 },
      store: new MemoryStore(), rulesFor: async () => rules, feed, accounts: async () => [],
      verifyToken: async t => (t === "good" ? "u1" : null), canAccess: async (u, a) => u === "u1" && a === "acc_1", tradingEnabled: async () => true,
      clock: () => T0,
    });
    engine.start();
    feed.push({ symbol: "EURUSD", bid: 1.08, ask: 1.0801, time: T0 });
    server = createServer(createHttpHandler(engine, { allowedOrigins: [SITE] }));
    await new Promise<void>(r => server!.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const pre = await fetch(`${base}/v1/accounts/acc_1/orders`, { method: "OPTIONS", headers: { Origin: SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(SITE);

    const gw = new HttpGateway(base, async () => "good", (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: SITE } }));
    expect((await gw.snapshot("acc_1")).state.balance).toBe(10000);
    const placed = await gw.placeOrder("acc_1", { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "sock-1" });
    expect(placed.state.positions[0].entryPrice).toBe(1.0801);
    expect((await gw.closePosition("acc_1", placed.state.positions[0].id)).state.positions).toEqual([]);
    await expect(gw.snapshot("acc_2")).rejects.toMatchObject({ code: "forbidden" });
    expect((await (await fetch(`${base}/healthz`)).json())).toEqual({ ok: true, priceFeed: true, execution: true });
    await engine.stop();
  });
});

/// <reference types="node" />
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostStartError, nodeListen, startEngineHost, type HostDeps, type HostFirestore, type RunningHost } from "@/engine/host-main";
import { HttpGateway } from "@/engine/gateway";
import type { SocketLike } from "@/engine/feed-config";
import { FOREX_PAIRS } from "@/trade-access/instruments";

// Test values only: these prices exercise the plumbing and are not market prices.
const T0 = Date.parse("2026-11-04T10:00:00Z"); // Wednesday, market open
const SITE = "https://www.fynxfunded.com";
const KEY = "sk_test_HOSTKEY_42";
const ID = "ft_0123456789abcdef0123456789abcdef_p1";

const ENV = {
  FYNX_ENGINE_LEVERAGE: "30", FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE: "3.5", FYNX_ENGINE_MAX_LOTS: "50",
  FYNX_ENGINE_ALLOWED_ORIGINS: SITE, FYNX_ENGINE_MAX_QUOTE_AGE_MS: "60000",
  FYNX_FEED_URL: "wss://stream.provider.test/fx?apiKey={key}", FYNX_FEED_API_KEY: KEY,
  FYNX_FEED_FIELDS: '{"items":"data","symbol":"pair","bid":"b","ask":"a","time":"t"}', FYNX_FEED_SYMBOL_FORMAT: "{base}/{quote}",
  K_SERVICE: "fynx-engine", PORT: "0",
};

const snapshot = {
  name: "fynx-funded-v1:2-phase:1", starting_balance: "10000", daily_loss_percent: "5", max_loss_percent: "10",
  profit_target_percent: "8", max_loss_type: "static", consistency_percent: "40", min_trading_days: 5,
  reset_hour_utc: 22, breach_on_touch: false, version: 1, daily_basis: "boundary_balance", account_currency: "USD",
};

/** The documents checkout writes for a paid FYNX Trade purchase. */
function purchaseDocs(accountSwitch: boolean): Map<string, Record<string, unknown>> {
  return new Map<string, Record<string, unknown>>([
    [`accounts/${ID}`, { userId: "u1", challengeId: "ch1", orderId: "or1", platform: "FYNX Trade", accessVersion: 1, status: "active", activationStatus: "active", tradingEnabled: accountSwitch, currentPhase: 1, startingBalance: 10000, rules: snapshot }],
    ["challenges/ch1", { userId: "u1", orderId: "or1", status: "active", brokerAccountId: ID, currentPhase: 1 }],
    ["orders/or1", { userId: "u1", challengeId: "ch1", status: "paid" }],
  ]);
}

/** Firestore stand-in covering what the host uses: doc get/create, equality queries, transactions. */
function fakeFirestore(docs: Map<string, Record<string, unknown>>, opts: { hangQueries?: boolean; failTrades?: { on: boolean } } = {}) {
  const ref = (p: string) => ({
    path: p,
    get: async () => ({ exists: docs.has(p), data: () => (docs.has(p) ? structuredClone(docs.get(p)) : undefined) }),
    create: async (data: Record<string, unknown>) => {
      if (opts.failTrades?.on && p.startsWith("trades/")) throw new Error("14 UNAVAILABLE: test outage");
      if (docs.has(p)) throw Object.assign(new Error("already exists"), { code: 6 });
      docs.set(p, structuredClone(data));
    },
  });
  const query = (col: string, filters: [string, unknown][], max: number) => ({
    where: (f: string, _op: string, v: unknown) => query(col, [...filters, [f, v]], max),
    limit: (n: number) => query(col, filters, n),
    get: async () => {
      if (opts.hangQueries) return new Promise<never>(() => {});
      const rows = [...docs].filter(([p, d]) => p.startsWith(`${col}/`) && p.split("/").length === 2 && filters.every(([f, v]) => d[f] === v))
        .slice(0, max).map(([p, d]) => ({ id: p.slice(col.length + 1), data: () => structuredClone(d) }));
      return { docs: rows };
    },
  });
  const db = {
    collection: (col: string) => Object.assign(query(col, [], Infinity), { doc: (id: string) => ref(`${col}/${id}`) }),
    async runTransaction<T>(fn: (tx: { get: (r: { get(): Promise<unknown> }) => Promise<unknown>; set: (r: { path: string }, d: Record<string, unknown>) => void }) => Promise<T>) {
      const pending: [string, Record<string, unknown>][] = [];
      const result = await fn({ get: r => r.get(), set: (r, d) => { pending.push([r.path, d]); } });
      for (const [p, d] of pending) docs.set(p, structuredClone(d));
      return result;
    },
  };
  return db as unknown as HostFirestore;
}

function fakeSockets() {
  const made: (SocketLike & { url: string; sent: string[] })[] = [];
  const factory = (url: string) => {
    const s = { url, sent: [] as string[], onopen: null, onmessage: null, onclose: null, onerror: null, send(d: string) { this.sent.push(d); }, close() {} };
    made.push(s);
    return s;
  };
  return { made, factory };
}

let running: RunningHost | null = null;
afterEach(async () => { await running?.stop(); running = null; });

function deps(over: Partial<HostDeps> & { docs?: Map<string, Record<string, unknown>> } = {}) {
  const lines: string[] = [];
  const sockets = fakeSockets();
  const d: HostDeps = {
    env: ENV, pairs: FOREX_PAIRS, db: fakeFirestore(over.docs ?? purchaseDocs(false)),
    verifyIdToken: async token => { if (token !== "good-token") throw new Error("bad token"); return { uid: "u1" }; },
    getUser: async () => ({ email: "trader@example.test", emailVerified: true }),
    socket: sockets.factory,
    listen: nodeListen(handler => createServer(handler)),
    log: line => lines.push(line),
    healthLogEveryMs: 0,
    clock: () => T0,
    ...over,
  };
  return { d, lines, sockets };
}

const price = (s: ReturnType<typeof fakeSockets>) => {
  s.made[0].onopen?.({});
  s.made[0].onmessage?.({ data: JSON.stringify({ data: [{ pair: "EUR/USD", b: 1.1, a: 1.1001, t: T0 }] }) });
};

const gateway = (port: number) => new HttpGateway(`http://127.0.0.1:${port}`, async () => "good-token",
  (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: SITE } }));

describe("engine host program (startEngineHost)", () => {
  it("refuses to start while settings are missing and lists them; nothing listens", async () => {
    let listened = false;
    const { d, lines } = deps({ env: { PORT: "0" }, listen: async () => { listened = true; throw new Error("must not listen"); } });
    const error = await startEngineHost(d).catch(e => e);
    expect(error).toBeInstanceOf(HostStartError);
    expect(error.message).toBe("Engine not started: Trading settings, Price feed settings incomplete.");
    expect(error.report).toContain("FYNX_ENGINE_LEVERAGE is missing.");
    expect(error.report).toContain("Nothing was started.");
    expect(listened).toBe(false);
    expect(JSON.parse(lines[0])).toMatchObject({ severity: "ERROR", message: "Engine not started: settings missing." });
  });

  it("refuses a malformed PORT", async () => {
    const { d } = deps({ env: { ...ENV, PORT: "80a" } });
    await expect(startEngineHost(d)).rejects.toThrow(/PORT must be a whole number/);
  });

  it("starts on a real port, serves the terminal, keeps trading off by default and never logs the key or token", async () => {
    const { d, lines, sockets } = deps({ docs: purchaseDocs(true) });
    running = await startEngineHost(d);
    expect(running.tradingAllowed).toBe(false);
    expect(running.emailNotices).toBe(false);
    expect(sockets.made[0].url).toBe(`wss://stream.provider.test/fx?apiKey=${KEY}`);

    const started = lines.map(l => JSON.parse(l)).find(l => l.message === "FYNX trading engine started.");
    expect(started).toMatchObject({ severity: "INFO", priceFeed: "wss://stream.provider.test/fx?apiKey=•••", pairs: 45, trading: "off (every order is refused)", emailNotices: "off", allowedOrigins: [SITE] });

    const base = `http://127.0.0.1:${running.port}`;
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: true, priceFeed: false });
    price(sockets);
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: true, priceFeed: true });

    const gw = gateway(running.port);
    const snap = await gw.snapshot(ID); // opens the purchased account on the first visit
    expect(snap.state.balance).toBe(10000);
    expect(snap.report).toMatchObject({ targetProfit: 800, minTradingDays: 5 }); // 8 % target, 5 days from the purchased snapshot
    await expect(gw.placeOrder(ID, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "h-1" })).rejects.toMatchObject({ code: "trading_disabled" });
    await expect(gateway(running.port).snapshot("ft_ffffffffffffffffffffffffffffffff_p1")).rejects.toBeTruthy();
    const anonymous = await fetch(`${base}/v1/accounts/${ID}`, { headers: { Origin: SITE } });
    expect(anonymous.status).toBe(401);

    const status = await (await fetch(`${base}/v1/status`, { headers: { Origin: SITE, Authorization: "Bearer good-token" } })).json();
    expect(status.notices).toBeUndefined();

    await running.stop();
    running = null;
    const all = lines.join("\n");
    expect(all).not.toContain(KEY);
    expect(all).not.toContain("good-token");
    expect(all).not.toContain("trader@example.test");
    expect(all).toContain("FYNX trading engine stopped.");
  });

  it("with both switches on, an order fills and the closed trade reaches the dashboard's trades collection", async () => {
    const docs = purchaseDocs(true);
    const { d, sockets } = deps({ docs, env: { ...ENV, FYNX_ENGINE_ALLOW_TRADING: "true" } });
    running = await startEngineHost(d);
    expect(running.tradingAllowed).toBe(true);
    price(sockets);
    const gw = gateway(running.port);
    await gw.snapshot(ID); // the terminal's first visit opens the account
    const placed = await gw.placeOrder(ID, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "h-2" });
    expect(placed.state.positions).toHaveLength(1);
    expect(placed.state.positions[0].entryPrice).toBe(1.1001);
    await gw.closePosition(ID, placed.state.positions[0].id);
    await running.stop(); // flushes the ledger
    running = null;
    const trades = [...docs].filter(([p]) => p.startsWith("trades/"));
    expect(trades).toHaveLength(1);
    expect(trades[0][1]).toMatchObject({ userId: "u1", challengeId: "ch1", accountId: ID, symbol: "EURUSD" });
    expect([...docs.keys()].some(p => p === `engineAccounts/${ID}`)).toBe(true);
  });

  it("on start, a trade that closed before the last stop but never reached the dashboard is written (once)", async () => {
    const docs = purchaseDocs(true);
    const first = deps({ docs, env: { ...ENV, FYNX_ENGINE_ALLOW_TRADING: "true" } });
    running = await startEngineHost(first.d);
    price(first.sockets);
    const gw = gateway(running.port);
    await gw.snapshot(ID);
    const placed = await gw.placeOrder(ID, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "h-c1" });
    await gw.closePosition(ID, placed.state.positions[0].id);
    await running.stop();
    running = null;
    const [tradeId, record] = [...docs].find(([p]) => p.startsWith("trades/"))!;
    docs.delete(tradeId); // as if the process had stopped before this write

    const second = deps({ docs });
    running = await startEngineHost(second.d);
    const report = await running.ledgerCatchUp;
    expect(report).toMatchObject({ accounts: 1, checked: 1, dealsSent: 1, listError: null });
    expect(docs.get(tradeId)).toMatchObject({ userId: "u1", challengeId: "ch1", accountId: ID, symbol: "EURUSD", netProfit: record.netProfit });
    const line = second.lines.map(l => JSON.parse(l)).find(l => l.message === "Trade catch-up finished.");
    expect(line).toMatchObject({ severity: "INFO", days: 7, accounts: 1, tradesChecked: 1, newlyWritten: 1, alreadyOnDashboard: 0, notWritten: 0 });
    expect(second.lines.map(l => JSON.parse(l)).find(l => l.message === "FYNX trading engine started.")).toMatchObject({ tradeCatchUp: "last 7 day(s)" });
    await running.stop();

    // A third start finds it already there and leaves it untouched.
    const third = deps({ docs });
    running = await startEngineHost(third.d);
    await running.ledgerCatchUp;
    expect([...docs.keys()].filter(p => p.startsWith("trades/"))).toEqual([tradeId]);
    expect(third.lines.map(l => JSON.parse(l)).find(l => l.message === "Trade catch-up finished.")).toMatchObject({ newlyWritten: 0, alreadyOnDashboard: 1 });
  });

  it("trade catch-up can be switched off, and a malformed day count is refused before anything starts", async () => {
    const off = deps({ env: { ...ENV, FYNX_ENGINE_LEDGER_CATCHUP_DAYS: "0" } });
    running = await startEngineHost(off.d);
    expect(await running.ledgerCatchUp).toBeNull();
    expect(off.lines.some(l => l.includes("Trade catch-up finished."))).toBe(false);
    await running.stop();
    running = null;
    let listened = false;
    const bad = deps({ env: { ...ENV, FYNX_ENGINE_LEDGER_CATCHUP_DAYS: "45" }, listen: async () => { listened = true; throw new Error("must not listen"); } });
    const error = await startEngineHost(bad.d).catch(e => e);
    expect(error).toBeInstanceOf(HostStartError);
    expect(error.report).toContain("FYNX_ENGINE_LEDGER_CATCHUP_DAYS must be a whole number of days from 0 to 30");
    expect(listened).toBe(false);
  });

  it("trade records that could not be written are tried again on the health timer", async () => {
    const docs = purchaseDocs(true);
    // A first run leaves one closed trade in the engine account, then its record is lost.
    const first = deps({ docs, env: { ...ENV, FYNX_ENGINE_ALLOW_TRADING: "true" } });
    running = await startEngineHost(first.d);
    price(first.sockets);
    const gw = gateway(running.port);
    await gw.snapshot(ID);
    const placed = await gw.placeOrder(ID, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "h-r1" });
    await gw.closePosition(ID, placed.state.positions[0].id);
    await running.stop();
    running = null;
    const tradeId = [...docs.keys()].find(p => p.startsWith("trades/"))!;
    docs.delete(tradeId);

    // Next start: Firestore refuses trade writes for a while.
    const outage = { on: true };
    const { d, lines } = deps({ docs, healthLogEveryMs: 40, ledgerRetryDelaysMs: [] });
    d.db = fakeFirestore(docs, { failTrades: outage });
    running = await startEngineHost(d);
    await running.ledgerCatchUp;
    expect(docs.has(tradeId)).toBe(false);
    expect(lines.map(l => JSON.parse(l)).find(l => l.message === "Trade catch-up finished.")).toMatchObject({ severity: "WARNING", newlyWritten: 0, notWritten: 1 });
    expect(running.engine.status().ledger?.failed).toHaveLength(1);

    outage.on = false;
    for (let i = 0; i < 50 && !docs.has(tradeId); i++) await new Promise(r => setTimeout(r, 20));
    expect(docs.has(tradeId)).toBe(true);
    expect(lines.some(l => JSON.parse(l).message === "Trying unwritten trade records again.")).toBe(true);
    expect(running.engine.status().ledger?.failed).toHaveLength(0);
  });

  it("the account's own switch still blocks orders when the host allows trading", async () => {
    const { d, sockets } = deps({ docs: purchaseDocs(false), env: { ...ENV, FYNX_ENGINE_ALLOW_TRADING: "true" } });
    running = await startEngineHost(d);
    price(sockets);
    await gateway(running.port).snapshot(ID);
    await expect(gateway(running.port).placeOrder(ID, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, clientId: "h-3" })).rejects.toMatchObject({ code: "trading_disabled" });
  });

  it("email notices are opt-in: /v1/status says notices only with FYNX_ENGINE_EMAIL_NOTICES=true", async () => {
    const { d, lines } = deps({ env: { ...ENV, FYNX_ENGINE_EMAIL_NOTICES: "true" } });
    running = await startEngineHost(d);
    expect(running.emailNotices).toBe(true);
    const status = await (await fetch(`http://127.0.0.1:${running.port}/v1/status`, { headers: { Origin: SITE, Authorization: "Bearer good-token" } })).json();
    expect(status.notices).toBe(true);
    expect(lines.some(l => l.includes('"emailNotices":"on (mail collection)"'))).toBe(true);
  });

  it("stopping never hangs: it gives up after stopTimeoutMs and says so", async () => {
    const { d, lines, sockets } = deps({ stopTimeoutMs: 200 });
    d.db = fakeFirestore(purchaseDocs(true), { hangQueries: true }); // Firestore stops answering
    const host = await startEngineHost(d);
    price(sockets); // prices live → the timer step starts a round that waits on Firestore
    await new Promise(r => setTimeout(r, 50));
    const t = Date.now();
    await host.stop();
    expect(Date.now() - t).toBeLessThan(2000);
    expect(lines.some(l => JSON.parse(l).severity === "WARNING" && JSON.parse(l).message.startsWith("Stopped after"))).toBe(true);
    await host.stop(); // a second call is harmless
  });

  it("logs a health line on a timer", async () => {
    const { d, lines } = deps({ healthLogEveryMs: 30 });
    running = await startEngineHost(d);
    await new Promise(r => setTimeout(r, 80));
    const health = lines.map(l => JSON.parse(l)).filter(l => "watched" in l);
    expect(health.length).toBeGreaterThan(0);
    expect(health[0]).toMatchObject({ severity: "WARNING", priceFeed: false, execution: false });
  });

  it("failed sign-in protection: off by default, on with FYNX_ENGINE_CLIENT_ADDRESS, refuses the address on a real port", async () => {
    const off = deps({ docs: purchaseDocs(true) });
    running = await startEngineHost(off.d);
    expect(running.signInGuard).toBeNull();
    expect(off.lines.map(l => JSON.parse(l)).find(l => l.message === "FYNX trading engine started.")).toMatchObject({ failedSignInProtection: "off (set FYNX_ENGINE_CLIENT_ADDRESS)" });
    await running.stop();
    running = null;

    const { d, lines } = deps({ docs: purchaseDocs(true), env: { ...ENV, FYNX_ENGINE_CLIENT_ADDRESS: "socket", FYNX_ENGINE_SIGNIN_LIMIT: "3/60/120" } });
    running = await startEngineHost(d);
    expect(running.signInGuard).not.toBeNull();
    expect(lines.map(l => JSON.parse(l)).find(l => l.message === "FYNX trading engine started.")).toMatchObject({ failedSignInProtection: "on (connection address)" });
    const base = `http://127.0.0.1:${running.port}`;
    for (let i = 0; i < 3; i++) {
      expect((await fetch(`${base}/v1/accounts/${ID}`, { headers: { Origin: SITE, Authorization: "Bearer stolen" } })).status).toBe(401);
    }
    const refused = await fetch(`${base}/v1/accounts/${ID}`, { headers: { Origin: SITE, Authorization: "Bearer good-token" } });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("120");
    expect((await refused.json()).error.code).toBe("too_many_failed_sign_ins");
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const warning = lines.map(l => JSON.parse(l)).find(l => l.message === "Too many failed sign-ins: address refused for a while.");
    expect(warning).toMatchObject({ severity: "WARNING", address: "127.0.0.1", seconds: 120 });
    expect(lines.join("\n")).not.toContain("stolen");
  });
});

describe("npm run engine:build", () => {
  it("builds a folder Cloud Run can run: one server file, package.json with the start script and firebase-admin", () => {
    const root = path.resolve(__dirname, "../..");
    const out = mkdtempSync(path.join(tmpdir(), "fynx-engine-build-"));
    try {
      const said = execFileSync(process.execPath, [path.join(root, "scripts/engine-build.mjs"), "--out", out], { cwd: root, encoding: "utf8", env: { ...process.env, TMPDIR: tmpdir() } });
      expect(said).toContain("Nothing was deployed.");
      const pkg = JSON.parse(readFileSync(path.join(out, "package.json"), "utf8"));
      const functionsAdmin = JSON.parse(readFileSync(path.join(root, "functions/package.json"), "utf8")).dependencies["firebase-admin"];
      expect(pkg).toMatchObject({ type: "module", engines: { node: ">=22" }, scripts: { start: "node server.mjs" }, dependencies: { "firebase-admin": functionsAdmin } });
      const server = readFileSync(path.join(out, "server.mjs"), "utf8");
      expect(server).toContain('from "firebase-admin/firestore"'); // loaded at run time, not bundled
      expect(server).toContain("startEngineHost");
      expect(server).not.toMatch(/from "react"|react-dom/);
      expect(readFileSync(path.join(out, "README.txt"), "utf8")).toContain("Trading stays OFF");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30_000);
});

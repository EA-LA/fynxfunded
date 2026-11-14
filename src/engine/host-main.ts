import type { PairLike } from "./venue";
import { readEngineConfig } from "./config";
import { createFeedFromEnv, type SocketFactory } from "./feed-config";
import { FirestoreAccountStore, type FirestoreLike } from "./firestore-store";
import { FirestoreAccountDirectory, type DirectoryFirestore, type DirectoryUser } from "./firestore-directory";
import { catchUpLedger, EngineLedger, firestoreTradeWriter, type CatchUpReport, type FirestoreCreateLike } from "./ledger";
import { EngineNotifier, firestoreMailSender, storePrefs } from "./notifier";
import { createEngineServer, type EngineServer } from "./server";
import { SignInGuard } from "./sign-in-guard";
import { PAUSE_CONTROL_DOC, PAUSE_ENV, readPauseSetting, TradingPause } from "./trading-pause";
import { NEWS_CONTROL_DOC, NewsCalendar } from "./news";
import { createHttpHandler, type NodeLikeRequest, type NodeLikeResponse } from "./http-adapter";
import { engineChecklist, formatReport } from "./preflight";

/**
 * The engine host program, ready to run ("the car"): everything the host file
 * in docs/ENGINE-READINESS.md does, as one tested function. The only parts
 * passed in are the ones that need Google Cloud — Firestore, Firebase Auth —
 * plus a WebSocket and a way to listen on a port, so the same code runs on
 * Cloud Run, a VM or in tests with stand-ins.
 *
 * `engine-host/server.mjs` is the real entry: it connects firebase-admin and
 * calls `startEngineHost`. `npm run engine:build` turns it into a folder that
 * can be uploaded to Cloud Run as it is. The website never imports this file,
 * nothing is deployed by the repository, and trading stays off until the owner
 * sets FYNX_ENGINE_ALLOW_TRADING=true AND switches an account on.
 *
 * On start it prints the readiness list (`npm run engine:check`) and refuses
 * to start while a required setting is missing, so a half-configured server
 * never answers traders. Logs are one JSON line each (Cloud Logging reads the
 * `severity`), never with tokens, API keys or email addresses.
 */

type Env = Record<string, string | undefined>;

/** Firestore as the Admin SDK provides it (only the calls the engine uses). */
export type HostFirestore = FirestoreLike & DirectoryFirestore & FirestoreCreateLike;

export type HostListener = (request: NodeLikeRequest, response: NodeLikeResponse) => void | Promise<void>;
export interface ListeningServer { port: number; close(): Promise<void> }

export interface HostDeps {
  env: Env;
  pairs: PairLike[];
  db: HostFirestore;
  /** Firebase Auth `verifyIdToken`; a rejection means "not signed in". */
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  /** Firebase Auth `getUser`, for notice emails (verified addresses only). */
  getUser?: (uid: string) => Promise<DirectoryUser | null>;
  /** WebSocket for the price feed (Node 22+ has one built in). */
  socket: SocketFactory;
  /** Opens the port with the request handler, e.g. `nodeListen(http.createServer)`. */
  listen: (handler: HostListener, port: number) => Promise<ListeningServer>;
  /** One line per call (default console.log). */
  log?: (line: string) => void;
  /** Longest wait for the current round and pending writes when stopping (default 8 s). */
  stopTimeoutMs?: number;
  /** Waits between trade-record write attempts (default 1 s, 5 s, 30 s); unwritten records are tried again on each health line. */
  ledgerRetryDelaysMs?: number[];
  /** How often a health line is logged, and unwritten trade records tried again (default 5 minutes, 0 = never). */
  healthLogEveryMs?: number;
  /** How often the pause switch document (engineControl/trading) is read (default 10 s). */
  pauseEveryMs?: number;
  /** How often the news calendar document (engineControl/news) is read (default 60 s). */
  newsEveryMs?: number;
  clock?: () => number;
}

export interface RunningHost {
  engine: EngineServer;
  port: number;
  tradingAllowed: boolean;
  emailNotices: boolean;
  /**
   * The start-up catch-up of the trade ledger (trades closed in the last
   * FYNX_ENGINE_LEDGER_CATCHUP_DAYS days re-sent to the dashboard); resolves
   * with its report once the records are written, or null when it is off.
   */
  ledgerCatchUp: Promise<CatchUpReport | null>;
  /** Failed sign-in protection (null when FYNX_ENGINE_CLIENT_ADDRESS is not set or the limit is off). */
  signInGuard: SignInGuard | null;
  /** The "pause new trading" switch (FYNX_ENGINE_PAUSE and the engineControl/trading document). */
  pause: TradingPause;
  /** The restricted news windows (engineControl/news document). */
  news: NewsCalendar;
  /** Stops taking requests, then stops the feed and timer and waits for trades/notices to be written. */
  stop(): Promise<void>;
}

export const HOST_ENV = {
  allowTrading: "FYNX_ENGINE_ALLOW_TRADING",
  emailNotices: "FYNX_ENGINE_EMAIL_NOTICES",
  ledgerCatchUpDays: "FYNX_ENGINE_LEDGER_CATCHUP_DAYS",
  pause: PAUSE_ENV,
  port: "PORT",
} as const;

export class HostStartError extends Error {
  constructor(message: string, readonly report: string) { super(message); this.name = "HostStartError"; }
}

type Severity = "INFO" | "WARNING" | "ERROR";
const errorText = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300);

function readPort(env: Env): number {
  const raw = env[HOST_ENV.port]?.trim();
  if (!raw) return 8080;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > 65535) throw new HostStartError(`PORT must be a whole number from 0 to 65535 (got "${raw}"; 0 = any free port).`, "");
  return n;
}

/** Days of closed trades re-sent to the dashboard on start (default 7, 0 = off, at most 30). */
export function readCatchUpDays(env: Env): number {
  const raw = env[HOST_ENV.ledgerCatchUpDays]?.trim();
  if (!raw) return 7;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > 30) throw new HostStartError(`${HOST_ENV.ledgerCatchUpDays} must be a whole number of days from 0 to 30 (got "${raw}"; 0 = off).`, "");
  return n;
}

/** Starts the engine host. Throws HostStartError (with the readiness report) when a setting is missing. */
export async function startEngineHost(d: HostDeps): Promise<RunningHost> {
  const print = d.log ?? (line => console.log(line));
  const log = (severity: Severity, message: string, extra: Record<string, unknown> = {}) =>
    print(JSON.stringify({ severity, message, ...extra }));

  const checklist = engineChecklist(d.env, d.pairs);
  const report = formatReport(checklist);
  const missing = checklist.filter(i => i.status === "missing");
  if (missing.length) {
    log("ERROR", "Engine not started: settings missing.", { report });
    throw new HostStartError(`Engine not started: ${missing.map(i => i.name).join(", ")} incomplete.`, report);
  }
  const port = readPort(d.env);
  const catchUpDays = readCatchUpDays(d.env);
  log("INFO", "Readiness check passed.", { report });

  const config = readEngineConfig(d.env, d.pairs);
  const tradingAllowed = d.env[HOST_ENV.allowTrading]?.trim() === "true";
  const emailNotices = d.env[HOST_ENV.emailNotices]?.trim() === "true";
  const pipSize = (symbol: string) => d.pairs.find(p => p.symbol === symbol)?.pipSize;

  const store = new FirestoreAccountStore(d.db, { collection: "engineAccounts" });
  const { feed, config: feedConfig } = createFeedFromEnv(d.env, d.pairs, { socket: d.socket, ...(d.clock ? { clock: d.clock } : {}) });
  const directory = new FirestoreAccountDirectory(d.db, {
    allowTrading: tradingAllowed,
    lookupUser: d.getUser,
    clock: d.clock,
  });
  const ledger = new EngineLedger({
    writer: firestoreTradeWriter(d.db), owner: directory.owner, pipSize, clock: d.clock,
    ...(d.ledgerRetryDelaysMs ? { retryDelaysMs: d.ledgerRetryDelaysMs } : {}),
    onError: (e, info) => log("WARNING", "Trade record not written yet; retrying.", { account: info.engineAccountId, deal: info.dealId, attempt: info.attempt, error: errorText(e) }),
  });
  const now0 = (d.clock ?? Date.now)();
  const pause = new TradingPause({
    initial: readPauseSetting(d.env[HOST_ENV.pause], now0),
    control: d.db.collection(PAUSE_CONTROL_DOC.collection).doc(PAUSE_CONTROL_DOC.id),
    ...(d.pauseEveryMs ? { everyMs: d.pauseEveryMs } : {}),
    clock: d.clock,
    onChange: state => state
      ? log("WARNING", state.holdPending ? "New trading paused for every account; waiting pending orders are held too (closing and cancelling still work)." : "New trading paused for every account (closing and cancelling still work; waiting pending orders can still fill).", { reason: state.reason, source: state.source, ...(state.holdPending ? { holdPending: true } : {}), ...(state.until ? { until: new Date(state.until).toISOString() } : {}) })
      : log("INFO", "New trading resumed."),
    onError: (e, n) => { if (n === 1 || n % 30 === 0) log("WARNING", "Could not read the pause switch (engineControl/trading); keeping the last known state.", { failuresInARow: n, error: errorText(e) }); },
  });
  // Read the switch before the first request, so a paused server never accepts an order on start.
  await pause.refresh();
  const news = new NewsCalendar({
    control: d.db.collection(NEWS_CONTROL_DOC.collection).doc(NEWS_CONTROL_DOC.id),
    ...(d.newsEveryMs ? { everyMs: d.newsEveryMs } : {}),
    clock: d.clock,
    onChange: (state, problems) => log(problems.length ? "WARNING" : "INFO", state.enforce
      ? (state.holdPending ? "News calendar read: new orders are refused and waiting pending orders are held inside the restricted windows." : "News calendar read: new orders are refused inside the restricted windows (waiting pending orders can still fill).")
      : "News calendar read: windows shown to traders as information only (enforce is off).", {
      windows: state.windows.length,
      ...(state.windows[0] ? { next: `${state.windows[0].title} at ${new Date(state.windows[0].at).toISOString()}` } : {}),
      ...(problems.length ? { problems: problems.slice(0, 10) } : {}),
    }),
    onError: (e, n) => { if (n === 1 || n % 30 === 0) log("WARNING", "Could not read the news calendar (engineControl/news); keeping the last known windows.", { failuresInARow: n, error: errorText(e) }); },
  });
  // Read the calendar before the first request, so an enforced window applies from the start.
  await news.refresh();
  const engine = createEngineServer({
    pairs: d.pairs, settings: config.settings, feed, store, rateLimits: config.rateLimits, pause, news,
    ...directory.engineOptions(),
    verifyToken: async token => {
      try { return (await d.verifyIdToken(token)).uid || null; } catch { return null; }
    },
    ledger,
    ...(emailNotices ? {
      notifier: new EngineNotifier({
        send: firestoreMailSender(d.db), recipient: directory.recipient, prefsFor: storePrefs(store), clock: d.clock,
        onError: (e, info) => log("WARNING", "Notice not queued yet; retrying.", { notice: info.noticeId, attempt: info.attempt, error: errorText(e) }),
      }),
    } : {}),
    runner: {
      onError: (accountId, e) => log("WARNING", accountId ? "Account check failed; will retry." : "Could not list accounts to watch; will retry.", { ...(accountId ? { account: accountId } : {}), error: errorText(e) }),
    },
    clock: d.clock,
  });

  const signInGuard = config.signInGuard ? new SignInGuard(config.signInGuard.limits, d.clock) : null;
  const handler = createHttpHandler(engine, {
    ...config.http, clock: d.clock,
    ...(signInGuard && config.signInGuard ? {
      signInGuard: {
        guard: signInGuard, address: config.signInGuard.address,
        onBlock: address => log("WARNING", "Too many failed sign-ins: address refused for a while.", { address, seconds: config.signInGuard!.limits.blockSeconds }),
      },
    } : {}),
    log: entry => { if (entry.status >= 500 && entry.code !== "trading_paused") log("ERROR", "Request failed.", { ...entry }); },
  });
  const server = await d.listen(handler, port);
  engine.start();

  log("INFO", "FYNX trading engine started.", {
    port: server.port,
    priceFeed: feedConfig.safeUrl,
    pairs: d.pairs.length,
    trading: tradingAllowed ? "allowed for accounts switched on" : "off (every order is refused)",
    emailNotices: emailNotices ? "on (mail collection)" : "off",
    tradeCatchUp: catchUpDays ? `last ${catchUpDays} day(s)` : "off",
    allowedOrigins: config.http.allowedOrigins,
    requestLimits: config.rateLimits ? "on" : "off",
    newTrading: pause.current() ? `paused (${pause.current()!.reason})` : "not paused (switch: engineControl/trading document or FYNX_ENGINE_PAUSE)",
    newsWindows: news.current().enforce ? `enforced (${news.current().windows.length} coming)` : `information only (${news.current().windows.length} coming; calendar: engineControl/news document)`,
    failedSignInProtection: config.signInGuard ? (config.signInGuard.address.from === "socket" ? "on (connection address)" : `on (X-Forwarded-For, ${config.signInGuard.address.trustedHops} hop(s))`) : "off (set FYNX_ENGINE_CLIENT_ADDRESS)",
  });

  // Catch-up: trades closed just before the last stop (or whose write failed) still reach the dashboard.
  let stopRequested = false;
  const now = d.clock ?? Date.now;
  const ledgerCatchUp: Promise<CatchUpReport | null> = catchUpDays === 0 ? Promise.resolve(null) : (async () => {
    try {
      const before = ledger.health();
      const result = await catchUpLedger({
        ledger, accounts: directory.accounts, load: id => store.load(id),
        since: now() - catchUpDays * 86_400_000, cancelled: () => stopRequested,
      });
      if (result.listError) {
        log("WARNING", "Trade catch-up skipped: the account list could not be read.", { error: result.listError });
        return result;
      }
      await ledger.flush();
      const after = ledger.health();
      log(result.unreadable.length || result.capped || after.failed.length ? "WARNING" : "INFO", "Trade catch-up finished.", {
        days: catchUpDays, accounts: result.accounts, accountsRead: result.checked, tradesChecked: result.dealsSent,
        newlyWritten: after.written - before.written, alreadyOnDashboard: after.alreadyRecorded - before.alreadyRecorded,
        notWritten: after.failed.length, ...(result.capped ? { capped: true } : {}), ...(result.cancelled ? { cancelled: true } : {}),
        ...(result.unreadable.length ? { unreadableAccounts: result.unreadable.slice(0, 20) } : {}),
      });
      return result;
    } catch (e) {
      log("WARNING", "Trade catch-up failed; trades closed from now on are still written.", { error: errorText(e) });
      return null;
    }
  })();

  const every = d.healthLogEveryMs ?? 300_000;
  const timer = every > 0 ? setInterval(() => {
    // Records that could not be written (Firestore outage, owner not found yet) get another try each health tick.
    const retried = ledger.health().failed.length ? ledger.retryFailed() : 0;
    if (retried) log("INFO", "Trying unwritten trade records again.", { trades: retried });
    const s = engine.status();
    log(s.execution ? "INFO" : "WARNING", s.message || (s.execution ? "Engine healthy." : "Engine not executing."), {
      priceFeed: s.priceFeed, execution: s.execution, watched: s.runner.watched,
      ...(s.ledger ? { tradesPending: s.ledger.pending, tradesFailed: s.ledger.failed.length } : {}),
      ...(s.notifier ? { noticesFailed: s.notifier.failed.length } : {}),
      ...(s.limits ? { requestsRefused: s.limits.refused.trade + s.limits.refused.reduce + s.limits.refused.read } : {}),
      ...(pause.current() ? { newTradingPaused: true } : {}),
      ...(news.health().activeNow && news.health().enforce ? { newsWindowsNow: news.health().activeNow } : {}),
      ...(signInGuard ? { signInRefused: signInGuard.health().refused, addressesBlocked: signInGuard.health().blockedNow } : {}),
    });
  }, every) : null;
  (timer as { unref?: () => void } | null)?.unref?.();

  let stopping: Promise<void> | null = null;
  return {
    engine, port: server.port, tradingAllowed, emailNotices, ledgerCatchUp, signInGuard, pause, news,
    stop() {
      stopRequested = true;
      stopping ??= (async () => {
        if (timer) clearInterval(timer);
        log("INFO", "Stopping: no new requests; finishing the current round and writing trades.");
        // Cloud Run allows 10 s after SIGTERM: give up waiting after `stopTimeoutMs` and say what was left.
        const limit = d.stopTimeoutMs ?? 8_000;
        let timedOut = false;
        let cancel: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>(resolve => { cancel = setTimeout(() => { timedOut = true; resolve(); }, limit); });
        await Promise.race([Promise.allSettled([server.close(), engine.stop()]).then(() => undefined), timeout]);
        clearTimeout(cancel);
        if (timedOut) {
          const s = engine.status();
          log("WARNING", `Stopped after ${Math.round(limit / 1000)} s with work still running; trade records or notices counted here were not written.`, {
            ...(s.ledger ? { tradesPending: s.ledger.pending } : {}), ...(s.notifier ? { noticesPending: s.notifier.pending } : {}),
          });
        } else log("INFO", "FYNX trading engine stopped.");
      })();
      return stopping;
    },
  };
}

/** The parts of node:http's Server that `nodeListen` uses. */
export interface NodeServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  address(): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  closeIdleConnections?(): void;
}

/** `listen` for HostDeps on Node: `nodeListen(http.createServer)`. */
export function nodeListen(createServer: (handler: HostListener) => NodeServerLike): HostDeps["listen"] {
  return (handler, port) => new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.on("error", reject);
    server.listen(port, () => {
      const address = server.address() as { port?: number } | null;
      resolve({
        port: address?.port ?? port,
        close: () => new Promise<void>((done, fail) => {
          server.close(e => (e ? fail(e) : done()));
          server.closeIdleConnections?.(); // keep-alive sockets would otherwise hold the close open
        }),
      });
    });
  });
}

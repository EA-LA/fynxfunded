import { buildSpecs, LocalVenue, type AccountStore, type PairLike, type QuoteFeed, type SpecOptions, type VenueSettings } from "./venue";
import { handleEngineRequest, type HostRequest, type HostResponse } from "./host";
import { EngineRunner, executionMessage, type RunnerHealth, type RunnerOptions } from "./runner";
import type { EngineEvent, RuleSet } from "./types";
import type { EngineLedger, LedgerHealth } from "./ledger";
import type { EngineNotifier, NotifierHealth } from "./notifier";
import type { PauseHealth, TradingPause } from "./trading-pause";
import type { NewsCalendar, NewsHealth } from "./news";
import { DEFAULT_RATE_LIMITS, RequestLimiter, type LimiterHealth, type RateLimits } from "./rate-limit";

/**
 * Everything a trading server needs, wired in one call ("add gas and it runs").
 *
 * A host (the FYNX API, a Cloud Function, any Node server) passes the parts
 * only it can provide — the licensed price feed, the account store, the
 * accounts' rules, sign-in checks and the owner's trading switch — and gets
 * back `handle(request)` for the HTTP contract plus `start()` / `stop()`.
 * Behind it:
 *  - a LocalVenue with the instrument specs from `pairs` and `settings`;
 *  - the price feed connected to the venue;
 *  - the EngineRunner (timer step) checking watched accounts every
 *    `runner.intervalMs` and right after new prices, so pending orders, stops
 *    and loss limits work while nobody has the terminal open;
 *  - GET /v1/status built from the real feed and runner health (`priceFeed`,
 *    `execution`, a plain `message`, per-pair `markets`).
 *
 * Safety is the host skeleton's: sign-in, account ownership and the
 * `tradingEnabled` switch for opening or changing orders. Nothing here starts
 * until `start()` is called, and the website never imports this file.
 */

export interface EngineServerOptions {
  /** The instrument catalogue, e.g. FOREX_PAIRS from src/trade-access/instruments. */
  pairs: PairLike[];
  /** Venue settings and trading hours/swap per symbol (see buildSpecs). */
  settings: VenueSettings & SpecOptions;
  /** Where accounts live, e.g. new FirestoreAccountStore(getFirestore(), { collection: "engineAccounts" }). */
  store: AccountStore;
  /** Each account's rules, e.g. rulesFromPurchase(startingBalance, purchase.rules, { funded }). */
  rulesFor: (accountId: string) => Promise<RuleSet>;
  /** The licensed price feed (StreamingQuoteFeed). Its `health().live` becomes `priceFeed` when it has one. */
  feed: QuoteFeed & { health?: () => { live: boolean } };
  /** The accounts the timer step should watch, e.g. accounts whose evaluation is running. */
  accounts: RunnerOptions["accounts"];
  verifyToken: (token: string) => Promise<string | null>;
  canAccess: (userId: string, accountId: string) => Promise<boolean>;
  tradingEnabled: (accountId: string) => Promise<boolean>;
  /** Open an account on its owner's first visit (default true; see HostOptions.openOnFirstVisit). */
  openOnFirstVisit?: boolean;
  /** Fills, stop-outs, locks, targets…: e.g. write an audit log or send an email. */
  onEvents?: (accountId: string, events: EngineEvent[]) => void;
  /** Writes every closed deal to the FYNX Funded `trades` collection (src/engine/ledger.ts), so it shows on the dashboard. */
  ledger?: EngineLedger;
  /**
   * Sends trader notices (price alert fired, order filled, stop/target hit,
   * loss limit, target reached, order expired) by email or another channel,
   * honouring each trader's choices (src/engine/notifier.ts). With it,
   * GET /v1/status says `notices: true` and the terminal lets traders choose.
   */
  notifier?: EngineNotifier;
  /**
   * Request limits per signed-in user (src/engine/rate-limit.ts). Default
   * DEFAULT_RATE_LIMITS; `false` turns them off (not recommended in production).
   */
  rateLimits?: RateLimits | false;
  /**
   * The owner's "pause new trading" switch (src/engine/trading-pause.ts):
   * while paused, opening or changing orders is refused for every account
   * (closing, cancelling, alerts and the timer step keep working) and
   * GET /v1/status says why. `start()` begins reading its control document.
   */
  pause?: TradingPause;
  /**
   * The owner's restricted news windows (src/engine/news.ts): listed in
   * GET /v1/status `news`; with `enforce: true` new orders on an affected pair
   * are refused inside a window. `start()` begins reading its document.
   */
  news?: NewsCalendar;
  /** Timer step tuning and error reporting (intervalMs, idleEveryMs, onError…). */
  runner?: Omit<RunnerOptions, "venue" | "accounts" | "ready" | "clock">;
  clock?: () => number;
  ids?: (prefix: string) => string;
}

export interface EngineServerStatus {
  priceFeed: boolean;
  execution: boolean;
  message: string;
  runner: RunnerHealth;
  /** Trade ledger health when a ledger is connected (pending, written, failed…). */
  ledger?: LedgerHealth;
  /** Notice sender health when a notifier is connected (sent, switched off, failed…). */
  notifier?: NotifierHealth;
  /** Requests refused for being too many (absent when limits are off). */
  limits?: LimiterHealth;
  /** The pause switch (absent when none is connected). */
  pause?: PauseHealth;
  /** The news calendar (absent when none is connected). */
  news?: NewsHealth;
}

export interface EngineServer {
  venue: LocalVenue;
  runner: EngineRunner;
  /** Answers one request of the HTTP contract (docs/ENGINE-READINESS.md). */
  handle(request: HostRequest): Promise<HostResponse>;
  /** Feed and timer-step health; the first three fields are what GET /v1/status returns. */
  status(): EngineServerStatus;
  /** Connects the price feed and starts the timer step. */
  start(): void;
  /** Disconnects the price feed and stops the timer step (waits for a running round). */
  stop(): Promise<void>;
}

const ACCOUNT_ACTION = /^\/v1\/accounts\/([^/?]+)\/(orders|positions|alerts)(?:[/?]|$)/;

export function createEngineServer(o: EngineServerOptions): EngineServer {
  const clock = o.clock ?? Date.now;
  const venue = new LocalVenue(buildSpecs(o.pairs, o.settings), o.store, o.rulesFor, { maxQuoteAgeMs: o.settings.maxQuoteAgeMs }, clock, o.ids);
  let lastQuoteAt: number | null = null;
  const priceFeedLive = () => (o.feed.health ? o.feed.health().live : lastQuoteAt !== null && clock() - lastQuoteAt <= o.settings.maxQuoteAgeMs);
  const runner = new EngineRunner({ ...o.runner, venue, accounts: o.accounts, ready: priceFeedLive, clock });
  if (o.news) venue.useNews(() => o.news!.current());
  if (o.onEvents) venue.onEvents(o.onEvents);
  if (o.ledger) venue.onEvents(o.ledger.listener);
  if (o.notifier) venue.onEvents(o.notifier.listener);
  const limiter = o.rateLimits === false ? null : new RequestLimiter(o.rateLimits ?? DEFAULT_RATE_LIMITS, clock);
  let disconnect: (() => void) | null = null, offQuote: (() => void) | null = null;

  const status = (): EngineServerStatus => {
    const priceFeed = priceFeedLive();
    const health = runner.health();
    const base = { priceFeed, execution: priceFeed && health.healthy, message: executionMessage(priceFeed, health), runner: health };
    return { ...base, ...(o.ledger ? { ledger: o.ledger.health() } : {}), ...(o.notifier ? { notifier: o.notifier.health() } : {}), ...(limiter ? { limits: limiter.health() } : {}), ...(o.pause ? { pause: o.pause.health() } : {}), ...(o.news ? { news: o.news.health() } : {}) };
  };

  return {
    venue, runner, status,
    async handle(request) {
      const response = await handleEngineRequest(request, {
        venue, verifyToken: o.verifyToken, canAccess: o.canAccess, tradingEnabled: o.tradingEnabled, openOnFirstVisit: o.openOnFirstVisit,
        ...(limiter ? { limiter } : {}),
        ...(o.pause ? { pause: () => o.pause!.current() } : {}),
        status: () => { const s = status(); return { priceFeed: s.priceFeed, execution: s.execution, message: s.message, ...(o.notifier ? { notices: true } : {}) }; },
      });
      // An account that just placed or changed something (or set a price alert) is checked every round from now on.
      const m = ACCOUNT_ACTION.exec(request.path.split("?")[0]);
      if (m && response.status === 200) runner.watch(decodeURIComponent(m[1]));
      return response;
    },
    start() {
      if (disconnect) return;
      offQuote = venue.onQuote(q => { lastQuoteAt = clock(); runner.nudge(); });
      disconnect = venue.connect(o.feed);
      runner.start();
      void o.pause?.start();
      void o.news?.start();
    },
    async stop() {
      disconnect?.(); offQuote?.();
      o.pause?.stop();
      o.news?.stop();
      disconnect = offQuote = null;
      await runner.stop();
      // Trades closed in the last round still reach the dashboard before the process exits.
      await o.ledger?.flush();
      await o.notifier?.flush();
    },
  };
}

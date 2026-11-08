import { buildSpecs, LocalVenue, type AccountStore, type PairLike, type QuoteFeed, type SpecOptions, type VenueSettings } from "./venue";
import { handleEngineRequest, type HostRequest, type HostResponse } from "./host";
import { EngineRunner, executionMessage, type RunnerHealth, type RunnerOptions } from "./runner";
import type { EngineEvent, RuleSet } from "./types";

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
  /** Fills, stop-outs, locks, targets…: e.g. write an audit log or send an email. */
  onEvents?: (accountId: string, events: EngineEvent[]) => void;
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

const ACCOUNT_ACTION = /^\/v1\/accounts\/([^/?]+)\/(orders|positions)(?:[/?]|$)/;

export function createEngineServer(o: EngineServerOptions): EngineServer {
  const clock = o.clock ?? Date.now;
  const venue = new LocalVenue(buildSpecs(o.pairs, o.settings), o.store, o.rulesFor, { maxQuoteAgeMs: o.settings.maxQuoteAgeMs }, clock, o.ids);
  let lastQuoteAt: number | null = null;
  const priceFeedLive = () => (o.feed.health ? o.feed.health().live : lastQuoteAt !== null && clock() - lastQuoteAt <= o.settings.maxQuoteAgeMs);
  const runner = new EngineRunner({ ...o.runner, venue, accounts: o.accounts, ready: priceFeedLive, clock });
  if (o.onEvents) venue.onEvents(o.onEvents);
  let disconnect: (() => void) | null = null, offQuote: (() => void) | null = null;

  const status = (): EngineServerStatus => {
    const priceFeed = priceFeedLive();
    const health = runner.health();
    return { priceFeed, execution: priceFeed && health.healthy, message: executionMessage(priceFeed, health), runner: health };
  };

  return {
    venue, runner, status,
    async handle(request) {
      const response = await handleEngineRequest(request, {
        venue, verifyToken: o.verifyToken, canAccess: o.canAccess, tradingEnabled: o.tradingEnabled,
        status: () => { const s = status(); return { priceFeed: s.priceFeed, execution: s.execution, message: s.message }; },
      });
      // An account that just placed or changed something is checked every round from now on.
      const m = ACCOUNT_ACTION.exec(request.path.split("?")[0]);
      if (m && response.status === 200) runner.watch(decodeURIComponent(m[1]));
      return response;
    },
    start() {
      if (disconnect) return;
      offQuote = venue.onQuote(q => { lastQuoteAt = clock(); runner.nudge(); });
      disconnect = venue.connect(o.feed);
      runner.start();
    },
    async stop() {
      disconnect?.(); offQuote?.();
      disconnect = offQuote = null;
      await runner.stop();
    },
  };
}

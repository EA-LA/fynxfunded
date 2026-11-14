import type { Snapshot } from "./venue";
import { EngineError } from "./types";

/**
 * The engine's timer step ("step 3" in docs/ENGINE-READINESS.md).
 *
 * Pending orders, stop losses, take profits and the loss limits are only
 * checked when the engine looks at an account. Requests from the terminal do
 * that, but nobody is clicking when a stop is hit at 3 a.m. EngineRunner looks
 * at every watched account on a fixed interval and right after new prices
 * arrive (`nudge`), so fills and stop-outs happen on time without a client.
 *
 * It is careful about cost and failure:
 *  - rounds never overlap; a nudge during a round runs one more round after it;
 *  - accounts with nothing open (no position, no pending order) are only
 *    checked every `idleEveryMs` (default 60 s), because there is nothing to
 *    fill or stop out; they are checked every round again once they hold
 *    something (e.g. after a terminal order, via `watch`); an account added
 *    with `watch` stays watched until it holds nothing, even when the
 *    `accounts()` list leaves it out;
 *  - while `ready()` is false (e.g. the price feed is not live) rounds are
 *    skipped rather than reading every account for nothing;
 *  - an account that fails is retried with backoff (1 s, 5 s, 30 s, 60 s) and
 *    never stops the others; a `conflict` (another server or a request saved
 *    first) is simply retried on the next round.
 *
 * `health()` is what a host reports as `execution` in GET /v1/status.
 * Nothing here runs until a host calls `start()`; the website never imports it.
 */

export interface RunnerOptions {
  /** The venue (only `snapshot` is used: it runs the timer step for one account). */
  venue: { snapshot(accountId: string): Promise<Snapshot> };
  /**
   * The accounts to watch, read at the start of every round, e.g. a Firestore
   * query of accounts whose evaluation is running. Duplicates are ignored.
   */
  accounts: () => Promise<string[]> | string[];
  /** Time between rounds. Default 1 000 ms. */
  intervalMs?: number;
  /** Accounts with nothing open are checked at most this often. Default 60 000 ms. */
  idleEveryMs?: number;
  /** Rounds are skipped while this returns false (e.g. `() => feed.health().live`). */
  ready?: () => boolean;
  /** Nudges closer together than this (from the start of the last round) wait for the gap. Default 200 ms. */
  minGapMs?: number;
  /** Retry delays for an account that keeps failing; the last one repeats. Default 1 s, 5 s, 30 s, 60 s. */
  failureBackoffMs?: number[];
  /** Health counts the runner as healthy while the last finished round is at most this old. Default 3 × interval (min 5 000 ms). */
  staleAfterMs?: number;
  /** Called for every account error other than `conflict` (log it, alert on repeated failures). */
  onError?: (accountId: string | null, error: unknown) => void;
  /** Called after every round. */
  onRound?: (round: RoundSummary) => void;
  clock?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface RoundSummary {
  startedAt: number;
  durationMs: number;
  /** Accounts the engine looked at. */
  checked: number;
  /** Accounts with nothing open, skipped until their idle check is due. */
  idleSkipped: number;
  /** Accounts waiting out a failure backoff. */
  backoffSkipped: number;
  failed: number;
  conflicts: number;
  /**
   * Listed accounts the engine has not opened yet (the trader has not loaded
   * them in the terminal): skipped quietly like idle accounts, not failures.
   */
  notOpened: number;
  /** True when the whole round was skipped because `ready()` was false. */
  waitingForPrices: boolean;
  /** The account list itself could not be read. */
  listFailed: boolean;
}

export interface RunnerHealth {
  running: boolean;
  /** Running, ready, and a round finished within `staleAfterMs`. Report this as `execution`. */
  healthy: boolean;
  rounds: number;
  lastRoundAt: number | null;
  lastRound: RoundSummary | null;
  /** Rounds asked for while one was still running (they run once afterwards, never in parallel). */
  queuedWhileBusy: number;
  watched: number;
  /** Accounts that failed on their last check, with how many times in a row. */
  failing: { accountId: string; failures: number; retryAt: number; lastError: string }[];
  lastError: string | null;
}

interface Watch { idle: boolean; checkedAt: number | null; failures: number; retryAt: number; lastError: string }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Plain sentence for GET /v1/status `message` from the feed and runner health. */
export function executionMessage(priceFeedLive: boolean, runner: RunnerHealth): string {
  if (!priceFeedLive) return "Waiting for prices from the price feed; orders are not checked until prices arrive.";
  if (!runner.running) return "Order checks are stopped on the server.";
  if (!runner.healthy) return "Order checks are delayed on the server; pending orders and stops may fill late.";
  return "Trading engine live: pending orders, stops and loss limits are checked every second.";
}

export class EngineRunner {
  private readonly o: Required<Omit<RunnerOptions, "ready" | "onError" | "onRound" | "staleAfterMs">> & Pick<RunnerOptions, "ready" | "onError" | "onRound"> & { staleAfterMs: number };
  private watches = new Map<string, Watch>();
  private running = false;
  private busy: Promise<RoundSummary> | null = null;
  private again = false;
  private looping = false;
  private timer: unknown = null;
  private timerAt = 0;
  private lastStartedAt: number | null = null;
  private stats = { rounds: 0, lastRoundAt: null as number | null, lastRound: null as RoundSummary | null, queuedWhileBusy: 0, lastError: null as string | null };

  constructor(opts: RunnerOptions) {
    const intervalMs = opts.intervalMs ?? 1_000;
    if (!(intervalMs > 0)) throw new EngineError("bad_settings", "intervalMs must be above 0.");
    this.o = {
      venue: opts.venue, accounts: opts.accounts, intervalMs,
      idleEveryMs: opts.idleEveryMs ?? 60_000,
      minGapMs: opts.minGapMs ?? 200,
      failureBackoffMs: opts.failureBackoffMs?.length ? opts.failureBackoffMs : [1_000, 5_000, 30_000, 60_000],
      staleAfterMs: opts.staleAfterMs ?? Math.max(5_000, intervalMs * 3),
      ready: opts.ready, onError: opts.onError, onRound: opts.onRound,
      clock: opts.clock ?? Date.now,
      schedule: opts.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
      cancel: opts.cancel ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
  }

  /** Starts the rounds (the first one runs immediately). Calling it twice does nothing. */
  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  /** Stops scheduling rounds. A round already running finishes. Returns when it has. */
  async stop() {
    this.running = false;
    if (this.timer !== null) { this.o.cancel(this.timer); this.timer = null; }
    if (this.busy) await this.busy.catch(() => undefined);
  }

  /**
   * New prices arrived (call it from the quote feed, e.g. `venue.onQuote`):
   * runs a round now, or once more right after the current one.
   */
  nudge() {
    if (!this.running) return;
    if (this.busy || this.looping) { if (!this.again) this.stats.queuedWhileBusy++; this.again = true; return; }
    const now = this.o.clock();
    const at = this.lastStartedAt === null ? now : Math.max(now, this.lastStartedAt + this.o.minGapMs);
    if (this.timer !== null && this.timerAt <= at) return; // already due sooner
    if (this.timer !== null) { this.o.cancel(this.timer); this.timer = null; }
    if (at <= now) { void this.loop(); return; }
    this.later(at - now);
  }

  private later(ms: number) {
    this.timerAt = this.o.clock() + ms;
    this.timer = this.o.schedule(() => { this.timer = null; void this.loop(); }, ms);
  }

  /** Check this account every round from now on (e.g. right after it placed an order). */
  watch(accountId: string) {
    const w = this.watches.get(accountId);
    if (w) w.idle = false;
    else this.watches.set(accountId, { idle: false, checkedAt: null, failures: 0, retryAt: 0, lastError: "" });
  }

  /** Runs one round now (for tests and for hosts that drive their own timer). Waits for a running round first. */
  async runOnce(): Promise<RoundSummary> {
    while (this.busy) await this.busy.catch(() => undefined);
    return this.round();
  }

  health(): RunnerHealth {
    const now = this.o.clock();
    const ready = this.o.ready ? this.o.ready() : true;
    const healthy = this.running && ready && this.stats.lastRoundAt !== null && now - this.stats.lastRoundAt <= this.o.staleAfterMs && !this.stats.lastRound?.waitingForPrices && !this.stats.lastRound?.listFailed;
    const failing = [...this.watches.entries()].filter(([, w]) => w.failures > 0).map(([accountId, w]) => ({ accountId, failures: w.failures, retryAt: w.retryAt, lastError: w.lastError }));
    return { running: this.running, healthy, rounds: this.stats.rounds, lastRoundAt: this.stats.lastRoundAt, lastRound: this.stats.lastRound, queuedWhileBusy: this.stats.queuedWhileBusy, watched: this.watches.size, failing, lastError: this.stats.lastError };
  }

  private async loop() {
    if (!this.running || this.looping) return;
    this.looping = true;
    let startedAt = 0;
    try {
      // A round started by runOnce() may still be running; never run two at once.
      while (this.busy) await this.busy.catch(() => undefined);
      if (!this.running) return;
      startedAt = this.o.clock();
      this.lastStartedAt = startedAt;
      await this.round().catch(() => undefined);
    } finally { this.looping = false; }
    if (!this.running) return;
    if (this.again) { this.again = false; void this.loop(); return; }
    this.later(Math.max(0, this.o.intervalMs - (this.o.clock() - startedAt)));
  }

  private round(): Promise<RoundSummary> {
    const job = this.doRound();
    this.busy = job;
    const clear = () => { if (this.busy === job) this.busy = null; };
    job.then(clear, clear);
    return job;
  }

  private async doRound(): Promise<RoundSummary> {
    const startedAt = this.o.clock();
    const summary: RoundSummary = { startedAt, durationMs: 0, checked: 0, idleSkipped: 0, backoffSkipped: 0, failed: 0, conflicts: 0, notOpened: 0, waitingForPrices: false, listFailed: false };
    const finish = () => {
      summary.durationMs = this.o.clock() - startedAt;
      this.stats.rounds++; this.stats.lastRoundAt = this.o.clock(); this.stats.lastRound = summary;
      this.o.onRound?.(summary);
      return summary;
    };
    if (this.o.ready && !this.o.ready()) { summary.waitingForPrices = true; return finish(); }

    let ids: string[];
    try { ids = [...new Set(await this.o.accounts())].filter(id => typeof id === "string" && id.length > 0); }
    catch (e) { summary.listFailed = true; this.stats.lastError = message(e); this.o.onError?.(null, e); return finish(); }

    // Accounts no longer listed stop being watched once they hold nothing;
    // one with an open position or order (e.g. added by watch()) is kept.
    const listed = new Set(ids);
    for (const [id, w] of [...this.watches.entries()]) {
      if (listed.has(id)) continue;
      if (w.idle && w.checkedAt !== null) this.watches.delete(id);
      else ids.push(id);
    }

    for (const id of ids) {
      let w = this.watches.get(id);
      if (!w) { w = { idle: false, checkedAt: null, failures: 0, retryAt: 0, lastError: "" }; this.watches.set(id, w); }
      const now = this.o.clock();
      if (w.failures > 0 && now < w.retryAt) { summary.backoffSkipped++; continue; }
      if (w.idle && w.checkedAt !== null && now - w.checkedAt < this.o.idleEveryMs) { summary.idleSkipped++; continue; }
      try {
        const snap = await this.o.venue.snapshot(id);
        summary.checked++;
        w.checkedAt = this.o.clock();
        w.idle = snap.state.positions.length === 0 && snap.state.orders.length === 0 && !snap.state.alerts?.length;
        w.failures = 0; w.retryAt = 0; w.lastError = "";
      } catch (e) {
        if (e instanceof EngineError && e.code === "conflict") { summary.conflicts++; continue; }
        if (e instanceof EngineError && e.code === "no_account") {
          summary.notOpened++;
          w.idle = true; w.checkedAt = this.o.clock(); w.failures = 0; w.retryAt = 0; w.lastError = "";
          continue;
        }
        summary.failed++;
        w.failures++;
        const delays = this.o.failureBackoffMs;
        w.retryAt = this.o.clock() + delays[Math.min(w.failures - 1, delays.length - 1)];
        w.lastError = message(e);
        this.stats.lastError = `${id}: ${w.lastError}`;
        this.o.onError?.(id, e);
      }
    }
    return finish();
  }
}

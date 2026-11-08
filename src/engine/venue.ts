import { archiveHistory, cancelOrder, closePosition, metrics, modifyOrder, modifyPosition, newAccount, placeOrder, targetReport, tick, type EngineContext, type OrderChange, type Step } from "./core";
import type { AccountMetrics, AccountState, ArchiveChunk, EngineEvent, HistoryPage, InstrumentSpec, OrderRequest, Quote, QuoteBook, RuleSet, SwapRates, TargetReport } from "./types";
import { FOREX_HOURS, marketState, type MarketState, type TradingHours } from "./hours";
import { EngineError } from "./types";

/**
 * Plug-in points ("ports") for running the engine. A host provides:
 *  - a QuoteFeed: the licensed price feed (the "gas");
 *  - an AccountStore: where account state lives (Firestore, Postgres…);
 *  - venue settings: leverage, commission and volume limits per symbol.
 * LocalVenue then executes simulated accounts entirely on FYNX's side, which
 * is how evaluation accounts work. A broker-backed account would implement the
 * same TradingGateway against the broker instead.
 */

export interface QuoteFeed {
  /** Calls onQuote for every new price of the given symbols. Returns an unsubscribe function. */
  subscribe(symbols: string[], onQuote: (q: Quote) => void): () => void;
}

export interface AccountStore {
  load(accountId: string): Promise<AccountState | null>;
  /** Saves only if the stored sequence still equals expectedSequence (optimistic locking). */
  save(state: AccountState, expectedSequence: number): Promise<void>;
  /**
   * Optional: one chunk of deals the store moved out of the account (oldest
   * chunk is 0), or null when it does not exist. Stores that archive old
   * history (FirestoreAccountStore) implement it so the terminal can page
   * through old trades with `GET /v1/accounts/{id}/history?chunk=n`.
   */
  archivedDeals?(accountId: string, index: number): Promise<ArchiveChunk | null>;
}

export interface AccountRecord {
  rules: RuleSet;
}

export interface VenueSettings {
  leverage: number;
  commissionPerLotPerSide: number;
  maxLots: number;
  maxQuoteAgeMs: number;
}

export interface PairLike { symbol: string; base: string; quote: string; pipSize: number; digits: number }

export interface SpecOptions {
  /**
   * Trading hours for every pair (default FOREX_HOURS: Sunday 17:00 to Friday
   * 17:00 New York). Pass the provider's published hours, or null for no limit
   * (tests only). `hoursBySymbol` overrides single pairs.
   */
  hours?: TradingHours | null;
  hoursBySymbol?: Record<string, TradingHours | null>;
  /** Swap rates per symbol from the broker/provider (USD per lot per night). Pairs left out charge no swap. */
  swap?: Record<string, SwapRates>;
}

/** Builds engine instrument specs from the forex catalogue and venue settings. */
export function buildSpecs(pairs: PairLike[], settings: Pick<VenueSettings, "leverage" | "commissionPerLotPerSide" | "maxLots"> & SpecOptions): Record<string, InstrumentSpec> {
  const base = settings.hours === undefined ? FOREX_HOURS : settings.hours;
  for (const [symbol, r] of Object.entries(settings.swap ?? {})) {
    if (!pairs.some(p => p.symbol === symbol)) throw new EngineError("bad_settings", `Swap rates given for ${symbol}, which is not in the catalogue.`);
    if (!Number.isFinite(r.longPerLot) || !Number.isFinite(r.shortPerLot) || (r.tripleWeekday !== undefined && !(Number.isInteger(r.tripleWeekday) && r.tripleWeekday >= 0 && r.tripleWeekday <= 6))) throw new EngineError("bad_settings", `Swap rates for ${symbol} must be numbers (triple weekday 0–6).`);
  }
  return Object.fromEntries(pairs.map(p => {
    const hours = settings.hoursBySymbol && p.symbol in settings.hoursBySymbol ? settings.hoursBySymbol[p.symbol] : base;
    const swap = settings.swap?.[p.symbol];
    return [p.symbol, {
      symbol: p.symbol, base: p.base, quote: p.quote, pipSize: p.pipSize, tickSize: Number((p.pipSize / 10).toFixed(6)), digits: p.digits,
      contractSize: 100_000, minLots: 0.01, lotStep: 0.01, maxLots: settings.maxLots, leverage: settings.leverage, commissionPerLotPerSide: settings.commissionPerLotPerSide,
      ...(hours ? { hours } : {}), ...(swap ? { swap } : {}),
    } satisfies InstrumentSpec];
  }));
}

/** Open/closed and next change for one symbol of a venue's specs (for /v1/status or the terminal). */
export function symbolMarketState(specs: Record<string, InstrumentSpec | undefined>, symbol: string, now: number): MarketState {
  const s = specs[symbol];
  if (!s) throw new EngineError("unknown_symbol", `${symbol} is not available on this account.`);
  return marketState(s.hours, now);
}

/** Purchased rules as stored with an order (percent fields may be strings like "8" or "8%"). */
export interface PurchasedRules {
  starting_balance?: number | string;
  profit_target_percent: number | string | null;
  daily_loss_percent: number | string;
  max_loss_percent: number | string;
  min_trading_days: number | string;
  consistency_percent?: number | string | null;
  reset_hour_utc?: number | string;
}

const percentField = (v: unknown, name: string, optional = false): number | null => {
  if ((v === null || v === undefined || v === "") && optional) return null;
  const n = Number.parseFloat(String(v ?? "").replace("%", ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new EngineError("bad_rules", `${name} must be a percent between 0 and 100.`);
  return n;
};

/**
 * Turns an account's purchased rules into an engine RuleSet, for a host's
 * `rulesFor`. Funded accounts pass `funded: true` (no profit target). Refuses
 * anything malformed rather than guessing.
 */
export function rulesFromPurchase(startingBalance: number, r: PurchasedRules, opts: { funded?: boolean } = {}): RuleSet {
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) throw new EngineError("bad_rules", "Starting balance must be a positive number.");
  const days = Number(r.min_trading_days), reset = r.reset_hour_utc === undefined ? 22 : Number(r.reset_hour_utc);
  if (!Number.isInteger(days) || days < 0) throw new EngineError("bad_rules", "Minimum trading days must be a whole number.");
  if (!Number.isInteger(reset) || reset < 0 || reset > 23) throw new EngineError("bad_rules", "Reset hour must be 0–23 (UTC).");
  return {
    startingBalance,
    dailyLossPercent: percentField(r.daily_loss_percent, "Daily loss")!,
    maxLossPercent: percentField(r.max_loss_percent, "Maximum loss")!,
    profitTargetPercent: opts.funded ? null : percentField(r.profit_target_percent, "Profit target")!,
    minTradingDays: days,
    resetHourUtc: reset,
    consistencyPercent: percentField(r.consistency_percent, "Consistency", true),
  };
}

export interface MemoryArchiveOptions {
  /** Archive when the account holds more than this many deals. */
  aboveDeals: number;
  /** Newest deals kept in the account. */
  keepRecentDeals: number;
  chunkSize?: number;
  resetHourUtc: number;
}

/**
 * In-memory AccountStore for tests and demos. With `archive` it moves old
 * deals into chunks the same way FirestoreAccountStore does (by deal count
 * instead of document size), so archive paging can be tested end to end.
 */
export class MemoryStore implements AccountStore {
  private data = new Map<string, AccountState>();
  private chunks = new Map<string, ArchiveChunk>();
  constructor(private opts: { archive?: MemoryArchiveOptions } = {}) {}
  async load(id: string) { return this.data.get(id) ?? null; }
  async save(state: AccountState, expected: number) {
    const current = this.data.get(state.accountId);
    if (current && current.sequence !== expected) throw new EngineError("conflict", "The account changed; retry.");
    const a = this.opts.archive;
    if (a && state.history.length > a.aboveDeals && state.history.length > a.keepRecentDeals) {
      const moved = archiveHistory(state, { keep: a.keepRecentDeals, resetHourUtc: a.resetHourUtc, chunkSize: a.chunkSize });
      for (const c of moved.chunks) this.chunks.set(`${state.accountId}/${c.index}`, { accountId: state.accountId, index: c.index, firstClosedAt: c.deals[0].closedAt, lastClosedAt: c.deals[c.deals.length - 1].closedAt, deals: c.deals });
      state = moved.state;
    }
    this.data.set(state.accountId, state);
  }
  async archivedDeals(accountId: string, index: number) { return this.chunks.get(`${accountId}/${index}`) ?? null; }
}

export interface Snapshot {
  state: AccountState;
  metrics: AccountMetrics;
  quotes: QuoteBook;
  /** Target, minimum days and consistency progress. Optional in the HTTP contract; LocalVenue always sends it. */
  report?: TargetReport;
}

export class LocalVenue {
  readonly quotes: QuoteBook = {};
  private listeners = new Set<(accountId: string, events: EngineEvent[]) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private specs: Record<string, InstrumentSpec>,
    private store: AccountStore,
    private rulesFor: (accountId: string) => Promise<RuleSet>,
    private settings: Pick<VenueSettings, "maxQuoteAgeMs">,
    private clock: () => number = Date.now,
    private ids: (prefix: string) => string = prefix => `${prefix}_${Math.random().toString(36).slice(2, 12)}`,
  ) {}

  /** Connects a price feed. Every quote is stored and open accounts can be ticked by the host. */
  connect(feed: QuoteFeed): () => void {
    return feed.subscribe(Object.keys(this.specs), q => { if (this.specs[q.symbol]) this.quotes[q.symbol] = q; });
  }

  /** Open/closed, reason and next change for every symbol (or the given ones), for `/v1/status`. */
  markets(symbols: string[] = Object.keys(this.specs)): Record<string, MarketState> {
    const now = this.clock();
    return Object.fromEntries(symbols.filter(s => this.specs[s]).map(s => [s, marketState(this.specs[s].hours, now)]));
  }

  onEvents(listener: (accountId: string, events: EngineEvent[]) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private async context(accountId: string): Promise<EngineContext> {
    return { specs: this.specs, quotes: this.quotes, rules: await this.rulesFor(accountId), now: this.clock(), maxQuoteAgeMs: this.settings.maxQuoteAgeMs, newId: this.ids };
  }

  /** Serialises commands so two requests never race on one account. */
  private run(accountId: string, fn: (state: AccountState, ctx: EngineContext) => Step): Promise<Snapshot> {
    const job = this.queue.then(async () => {
      const ctx = await this.context(accountId);
      const state = await this.store.load(accountId);
      if (!state) throw new EngineError("no_account", "Account not found.");
      const ticked = tick(state, ctx);
      const step = fn(ticked.state, ctx);
      const events = [...ticked.events, ...step.events];
      if (step.state !== state) await this.store.save(step.state, state.sequence);
      if (events.length) this.listeners.forEach(l => l(accountId, events));
      return { state: step.state, metrics: metrics(step.state, ctx), quotes: { ...this.quotes }, report: targetReport(step.state, ctx.rules) };
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  async open(accountId: string): Promise<Snapshot> {
    if (!(await this.store.load(accountId))) await this.store.save(newAccount(accountId, await this.rulesFor(accountId), this.clock()), -1);
    return this.snapshot(accountId);
  }
  /** Runs the engine timer step (fills, stops, limits) without a command. */
  snapshot(accountId: string) { return this.run(accountId, s => ({ state: s, events: [] })); }
  place(accountId: string, req: OrderRequest) { return this.run(accountId, (s, c) => placeOrder(s, req, c)); }
  close(accountId: string, positionId: string, lots?: number) { return this.run(accountId, (s, c) => closePosition(s, positionId, lots, c)); }
  modify(accountId: string, positionId: string, p: { stopLoss?: number | null; takeProfit?: number | null }) { return this.run(accountId, (s, c) => modifyPosition(s, positionId, p, c)); }
  modifyOrder(accountId: string, orderId: string, change: OrderChange) { return this.run(accountId, (s, c) => modifyOrder(s, orderId, change, c)); }
  cancel(accountId: string, orderId: string) { return this.run(accountId, s => cancelOrder(s, orderId)); }

  /**
   * One page of archived (older) deals: chunk `index`, 0 being the oldest.
   * Read-only; it never ticks or saves the account.
   */
  async history(accountId: string, index: number): Promise<HistoryPage> {
    if (!Number.isInteger(index) || index < 0) throw new EngineError("bad_request", "chunk must be a whole number from 0.");
    const state = await this.store.load(accountId);
    if (!state) throw new EngineError("no_account", "Account not found.");
    const chunks = state.archived?.chunks ?? 0;
    if (index >= chunks) throw new EngineError("no_chunk", chunks ? `This account has ${chunks} archive page${chunks === 1 ? "" : "s"} (0 to ${chunks - 1}).` : "This account has no archived trades.");
    if (!this.store.archivedDeals) throw new EngineError("no_archive", "This server cannot read archived trades yet.");
    const chunk = await this.store.archivedDeals(accountId, index);
    if (!chunk) throw new EngineError("no_chunk", "That archive page could not be found.");
    if (chunk.accountId !== accountId || chunk.index !== index) throw new EngineError("bad_state", "The archive page belongs to another account.");
    return { ...chunk, chunks };
  }
}

/** Fixed prices, for tests and demos. Never use for real accounts. */
export class StaticQuoteFeed implements QuoteFeed {
  private subs = new Set<{ symbols: string[]; cb: (q: Quote) => void }>();
  subscribe(symbols: string[], cb: (q: Quote) => void) { const s = { symbols, cb }; this.subs.add(s); return () => { this.subs.delete(s); }; }
  push(q: Quote) { this.subs.forEach(s => { if (s.symbols.includes(q.symbol)) s.cb(q); }); }
}

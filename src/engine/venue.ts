import { addAlert, archiveHistory, setNotices, cancelOrder, removeAlert, closePosition, metrics, modifyOrder, modifyPosition, newAccount, placeOrder, targetReport, tick, type EngineContext, type OrderChange, type PositionChange, type Step } from "./core";
import type { AccountMetrics, AccountState, AlertRequest, ArchiveChunk, EngineEvent, HistoryPage, NoticeChange, InstrumentSpec, OrderRequest, Quote, QuoteBook, RuleSet, SwapRates, TargetReport } from "./types";
import { newsStatus, type NewsState } from "./news";
import { FOREX_HOURS, marketState, scheduleBetween, type MarketState, type Schedule, type TradingHours } from "./hours";
import { EngineError } from "./types";
import { exposureLimits, OPEN_LOTS_MAX, OPEN_LOTS_MIN, OPEN_TRADES_MAX, OPEN_TRADES_MIN, validOpenLots, validOpenTrades, type ExposureLimits } from "./exposure";
import { STOP_OUT_MAX_PERCENT, STOP_OUT_MIN_PERCENT, validStopOut } from "./stop-out";
import { RISK_MAX_PERCENT, RISK_MIN_PERCENT, tradeRiskRule, validRiskPercent, type TradeRiskRule } from "./trade-risk";
import { DEFAULT_WEEKEND_CLOSE_MINUTES, WEEKEND_CLOSE_MAX_MINUTES, WEEKEND_CLOSE_MIN_MINUTES, validWeekendMinutes } from "./weekend";

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

/**
 * Trading conditions for one symbol, as `GET /v1/status` publishes them in
 * `instruments`: what the terminal needs to show the margin, commission and
 * swap of an order before it is sent. Values come from the venue settings
 * (FYNX_ENGINE_LEVERAGE, commission, max lots, swap); nothing is invented.
 */
export interface TradingConditions {
  /** Units of the base currency in 1.00 lot. */
  contractSize: number;
  minLots: number;
  lotStep: number;
  maxLots: number;
  /** e.g. 30 for 1:30. Margin = lots × contract size × base currency in USD ÷ leverage. */
  leverage: number;
  /** USD per lot per side (charged on opening and again on closing). */
  commissionPerLotPerSide: number;
  /** USD per lot per night; null when no swap is charged. */
  swap: { longPerLot: number; shortPerLot: number; tripleWeekday: number } | null;
}

/** The published trading conditions of one instrument spec. */
export function tradingConditions(s: InstrumentSpec): TradingConditions {
  return {
    contractSize: s.contractSize, minLots: s.minLots, lotStep: s.lotStep, maxLots: s.maxLots, leverage: s.leverage,
    commissionPerLotPerSide: s.commissionPerLotPerSide,
    swap: s.swap ? { longPerLot: s.swap.longPerLot, shortPerLot: s.swap.shortPerLot, tripleWeekday: s.swap.tripleWeekday ?? 3 } : null,
  };
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
  /** false = trades may not be held over the weekend (closed before the weekend close). Missing/true = allowed. */
  weekend_holding?: boolean | string;
  /** With weekend_holding false: minutes before the weekend close (1–240, default 15). */
  weekend_close_minutes?: number | string;
  /** Most lots open at once (open trades + waiting orders), 0.01–10000. Missing/null/"" = no limit. */
  max_open_lots?: number | string | null;
  /** Most trades open at once (open trades + waiting orders), whole 1–500. Missing/null/"" = no limit. */
  max_open_trades?: number | string | null;
  /** Margin stop-out level in percent (10–100, e.g. 50 or "50%"). Missing/null/"" = no stop out. */
  stop_out_level?: number | string | null;
  /** true = every order needs a stop loss (can be moved, not removed). Missing/false = optional. */
  stop_loss_required?: boolean | string;
  /** Most a trade may lose at its stop loss, % of the balance (0.1–10, e.g. 1 or "1%"). Implies stop_loss_required. Missing/null/"" = no cap. */
  max_risk_per_trade_percent?: number | string | null;
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
  const weekendCloseMinutes = weekendField(r);
  const maxOpenLots = limitField(r.max_open_lots, validOpenLots, `Maximum open lots must be a number of lots from ${OPEN_LOTS_MIN} to ${OPEN_LOTS_MAX} in steps of 0.01.`);
  const maxOpenTrades = limitField(r.max_open_trades, validOpenTrades, `Maximum open trades must be a whole number from ${OPEN_TRADES_MIN} to ${OPEN_TRADES_MAX}.`);
  const stopOutPercent = stopOutField(r.stop_out_level);
  const stopLossRequired = stopLossField(r.stop_loss_required);
  const maxRiskPercent = riskField(r.max_risk_per_trade_percent);
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
    // Only present when the agreement forbids weekend holding.
    ...(weekendCloseMinutes !== null ? { weekendCloseMinutes } : {}),
    // Only present when the agreement caps open exposure.
    ...(maxOpenLots !== null ? { maxOpenLots } : {}),
    ...(maxOpenTrades !== null ? { maxOpenTrades } : {}),
    // Only present when the agreement sets a margin stop out.
    ...(stopOutPercent !== null ? { stopOutPercent } : {}),
    // Only present when the agreement requires a stop loss or caps the risk per trade (a cap implies a stop loss).
    ...(stopLossRequired || maxRiskPercent !== null ? { stopLossRequired: true } : {}),
    ...(maxRiskPercent !== null ? { maxRiskPercent } : {}),
  };
}

/** "Stop loss required" from the purchase: false when missing; unclear values are refused (the account goes to review). */
function stopLossField(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === "" || raw === false || raw === "false") return false;
  if (raw === true || raw === "true") return true;
  throw new EngineError("bad_rules", "Stop loss required must be true or false.");
}

/** The maximum risk per trade from the purchase: null when missing; unclear values are refused (the account goes to review). */
function riskField(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw.trim().replace(/%$/, "").trim()) : raw;
  if (!validRiskPercent(n)) throw new EngineError("bad_rules", `Maximum risk per trade must be a percent from ${RISK_MIN_PERCENT} to ${RISK_MAX_PERCENT} (at most two decimals).`);
  return n;
}

/** The margin stop-out level from the purchase: null when missing; unclear values are refused (the account goes to review). */
function stopOutField(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw.trim().replace(/%$/, "").trim()) : raw;
  if (!validStopOut(n)) throw new EngineError("bad_rules", STOP_OUT_MESSAGE);
  return n;
}
const STOP_OUT_MESSAGE = `Stop-out level must be a percent from ${STOP_OUT_MIN_PERCENT} to ${STOP_OUT_MAX_PERCENT} (at most one decimal).`;

/** An optional numeric limit from the purchase: null when missing; unclear values are refused (the account goes to review). */
function limitField(raw: unknown, valid: (v: unknown) => v is number, message: string): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (!valid(n)) throw new EngineError("bad_rules", message);
  return n;
}

/** The weekend rule from the purchase: null when holding is allowed; unclear values are refused (the account goes to review). */
function weekendField(r: PurchasedRules): number | null {
  const h = r.weekend_holding;
  if (h === undefined || h === null || h === true || h === "true") return null;
  if (h !== false && h !== "false") throw new EngineError("bad_rules", "Weekend holding must be true or false.");
  const raw = r.weekend_close_minutes;
  const minutes = raw === undefined || raw === null || raw === "" ? DEFAULT_WEEKEND_CLOSE_MINUTES : Number(raw);
  if (!validWeekendMinutes(minutes)) throw new EngineError("bad_rules", `Weekend close must be a whole number of minutes from ${WEEKEND_CLOSE_MIN_MINUTES} to ${WEEKEND_CLOSE_MAX_MINUTES}.`);
  return minutes;
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
  /**
   * Present only when the account may not hold trades over the weekend:
   * open trades are closed this many minutes before the weekend close (see
   * src/engine/weekend.ts). Optional in the HTTP contract.
   */
  weekendClose?: { minutesBefore: number };
  /**
   * Present only when the account's agreement caps open exposure (see
   * src/engine/exposure.ts): most lots and/or most trades open at once.
   * Optional in the HTTP contract.
   */
  exposure?: ExposureLimits;
  /**
   * Present only when the account's agreement sets a margin stop out (see
   * src/engine/stop-out.ts): the margin level in percent at which trades are
   * closed, largest loss first. Optional in the HTTP contract.
   */
  stopOut?: { level: number };
  /**
   * Present only when the account's agreement requires a stop loss on every
   * order and/or caps the loss at the stop loss per trade (see
   * src/engine/trade-risk.ts). Optional in the HTTP contract.
   */
  tradeRisk?: TradeRiskRule;
}

export class LocalVenue {
  readonly quotes: QuoteBook = {};
  private listeners = new Set<(accountId: string, events: EngineEvent[]) => void>();
  private quoteListeners = new Set<(q: Quote) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private newsSource: (() => NewsState | null) | null = null;
  private pauseSource: (() => { holdPending?: boolean } | null) | null = null;
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
    return feed.subscribe(Object.keys(this.specs), q => {
      if (!this.specs[q.symbol]) return;
      this.quotes[q.symbol] = q;
      this.quoteListeners.forEach(l => l(q));
    });
  }

  /** Called after every stored quote, e.g. to nudge the EngineRunner (runner.ts) so stops are checked on new prices. */
  onQuote(listener: (q: Quote) => void) { this.quoteListeners.add(listener); return () => this.quoteListeners.delete(listener); }

  /** Open/closed, reason and next change for every symbol (or the given ones), for `/v1/status`. */
  markets(symbols: string[] = Object.keys(this.specs)): Record<string, MarketState> {
    const now = this.clock();
    return Object.fromEntries(symbols.filter(s => this.specs[s]).map(s => [s, marketState(this.specs[s].hours, now)]));
  }

  /**
   * Each symbol's open stretches and closures for the next `days` days (default
   * 7, at most 14) from the venue clock, for `/v1/status` `schedule`: the
   * terminal's contract specification shows them as "trading hours this week".
   */
  schedule(days = 7, symbols: string[] = Object.keys(this.specs)): Record<string, Schedule> {
    const now = this.clock(), span = Math.min(14, Math.max(1, Math.floor(days))) * 86_400_000;
    return Object.fromEntries(symbols.filter(s => this.specs[s]).map(s => [s, scheduleBetween(this.specs[s].hours, now, now + span)]));
  }

  /** Leverage, lot limits, commission and swap per symbol (or the given ones), for `/v1/status`. */
  conditions(symbols: string[] = Object.keys(this.specs)): Record<string, TradingConditions> {
    return Object.fromEntries(symbols.filter(s => this.specs[s]).map(s => [s, tradingConditions(this.specs[s])]));
  }

  /**
   * Connects the owner's restricted news windows (src/engine/news.ts, e.g.
   * `() => calendar.current()`). Every command then sees them; with
   * `enforce: true` new orders inside a window on an affected pair are refused.
   */
  useNews(source: (() => NewsState | null) | null) { this.newsSource = source; }

  /**
   * Connects the owner's "pause new trading" switch (src/engine/trading-pause.ts,
   * e.g. `() => pause.current()`) to the timer step: while the pause says
   * `holdPending: true`, pending orders already waiting do not fill. Refusing
   * new orders during a pause is the host's job (host.ts), not the venue's.
   */
  usePause(source: (() => { holdPending?: boolean } | null) | null) { this.pauseSource = source; }

  /** The news rule and the windows for the next 7 days for `/v1/status`, or undefined without a calendar. */
  newsStatus(): NewsState | undefined {
    const s = this.newsSource?.();
    return s ? newsStatus(s, this.clock()) : undefined;
  }

  onEvents(listener: (accountId: string, events: EngineEvent[]) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private async context(accountId: string): Promise<EngineContext> {
    const news = this.newsSource?.() ?? null;
    const hold = !!this.pauseSource?.()?.holdPending;
    return { ...(hold ? { holdPendingFills: true } : {}), specs: this.specs, quotes: this.quotes, rules: await this.rulesFor(accountId), now: this.clock(), maxQuoteAgeMs: this.settings.maxQuoteAgeMs, newId: this.ids, ...(news ? { news } : {}) };
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
      const weekend = ctx.rules.weekendCloseMinutes, exposure = exposureLimits(ctx.rules), tradeRisk = tradeRiskRule(ctx.rules);
      return { state: step.state, metrics: metrics(step.state, ctx), quotes: { ...this.quotes }, report: targetReport(step.state, ctx.rules), ...(validWeekendMinutes(weekend) ? { weekendClose: { minutesBefore: weekend } } : {}), ...(exposure ? { exposure } : {}), ...(validStopOut(ctx.rules.stopOutPercent) ? { stopOut: { level: ctx.rules.stopOutPercent } } : {}), ...(tradeRisk ? { tradeRisk } : {}) };
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
  modify(accountId: string, positionId: string, p: PositionChange) { return this.run(accountId, (s, c) => modifyPosition(s, positionId, p, c)); }
  modifyOrder(accountId: string, orderId: string, change: OrderChange) { return this.run(accountId, (s, c) => modifyOrder(s, orderId, change, c)); }
  cancel(accountId: string, orderId: string) { return this.run(accountId, s => cancelOrder(s, orderId)); }
  /** Sets a price alert (checked by the timer step on every fresh bid; it never trades). */
  addAlert(accountId: string, alert: AlertRequest) { return this.run(accountId, (s, c) => addAlert(s, alert, c)); }
  removeAlert(accountId: string, alertId: string) { return this.run(accountId, s => removeAlert(s, alertId)); }
  /** Changes which notices (email etc.) the trader receives; it never trades. */
  setNotices(accountId: string, change: NoticeChange) { return this.run(accountId, s => setNotices(s, change)); }

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

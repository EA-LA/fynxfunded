import { cancelOrder, closePosition, metrics, modifyPosition, newAccount, placeOrder, tick, type EngineContext, type Step } from "./core";
import type { AccountMetrics, AccountState, EngineEvent, InstrumentSpec, OrderRequest, Quote, QuoteBook, RuleSet } from "./types";
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

/** Builds engine instrument specs from the forex catalogue and venue settings. */
export function buildSpecs(pairs: PairLike[], settings: Pick<VenueSettings, "leverage" | "commissionPerLotPerSide" | "maxLots">): Record<string, InstrumentSpec> {
  return Object.fromEntries(pairs.map(p => [p.symbol, {
    symbol: p.symbol, base: p.base, quote: p.quote, pipSize: p.pipSize, tickSize: Number((p.pipSize / 10).toFixed(6)), digits: p.digits,
    contractSize: 100_000, minLots: 0.01, lotStep: 0.01, maxLots: settings.maxLots, leverage: settings.leverage, commissionPerLotPerSide: settings.commissionPerLotPerSide,
  } satisfies InstrumentSpec]));
}

export class MemoryStore implements AccountStore {
  private data = new Map<string, AccountState>();
  async load(id: string) { return this.data.get(id) ?? null; }
  async save(state: AccountState, expected: number) {
    const current = this.data.get(state.accountId);
    if (current && current.sequence !== expected) throw new EngineError("conflict", "The account changed; retry.");
    this.data.set(state.accountId, state);
  }
}

export interface Snapshot { state: AccountState; metrics: AccountMetrics; quotes: QuoteBook }

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
      return { state: step.state, metrics: metrics(step.state, ctx), quotes: { ...this.quotes } };
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
  cancel(accountId: string, orderId: string) { return this.run(accountId, s => cancelOrder(s, orderId)); }
}

/** Fixed prices, for tests and demos. Never use for real accounts. */
export class StaticQuoteFeed implements QuoteFeed {
  private subs = new Set<{ symbols: string[]; cb: (q: Quote) => void }>();
  subscribe(symbols: string[], cb: (q: Quote) => void) { const s = { symbols, cb }; this.subs.add(s); return () => { this.subs.delete(s); }; }
  push(q: Quote) { this.subs.forEach(s => { if (s.symbols.includes(q.symbol)) s.cb(q); }); }
}

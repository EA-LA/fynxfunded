import type { Deal, EngineEvent } from "./types";

/**
 * Trade ledger: closed engine deals → the `trades` records FYNX Funded reads.
 *
 * The dashboard (Trades, Analytics, the account workspace) lists the documents
 * in the Firestore `trades` collection whose `userId` is the signed-in trader
 * (see `useTradingData` and `mapClosedTrade` in src/lib/tradingData.ts). This
 * file turns every closed deal of the FYNX Trade engine into exactly such a
 * record and writes it, so a trade closed on /trade/access shows up on
 * /dashboard/trades and in the analytics with no more building.
 *
 * Safe to retry: each record's id is fixed by the engine account and deal id
 * (`tradeRecordId`), and the writer only CREATES documents, so a retry, a
 * restart or a full `sync` never writes a deal twice and never overwrites a
 * record. The ledger never throws into the engine: write problems are retried
 * with back-off, then kept in `health().failed` for `retryFailed()`.
 *
 * Wiring in a host (createEngineServer does the listening when given `ledger`):
 *
 *   const ledger = new EngineLedger({
 *     writer: firestoreTradeWriter(getFirestore()),          // collection "trades"
 *     owner: async engineAccountId => ({ userId, challengeId, accountId }),
 *     pipSize: s => FOREX_PAIRS.find(p => p.symbol === s)?.pipSize,
 *   });
 *   createEngineServer({ …, ledger });
 *
 * Note for the owner: the server function `evaluateAutomaticProgressionOnTrade`
 * runs on every `trades` write. Today it stops ("fail closed") before changing
 * anything, so these records only fill the dashboard; they do not decide a phase.
 */

/** Who a trade belongs to on FYNX Funded. */
export interface TradeOwner {
  /** Firebase uid of the trader (the dashboard lists trades by this). */
  userId: string;
  /** The challenge document id, when the engine account belongs to one. */
  challengeId?: string;
  /** The dashboard account id (accounts doc id, brokerAccountId or login); defaults to the engine account id. */
  accountId?: string;
}

/** The `trades` document written for one closed deal. Every field is defined (Firestore refuses undefined). */
export interface TradeRecord {
  userId: string;
  accountId: string;
  challengeId: string;
  engineAccountId: string;
  engineDealId: string;
  positionId: string;
  symbol: string;
  side: "buy" | "sell";
  type: "Buy" | "Sell";
  lots: number;
  entryPrice: number;
  exitPrice: number;
  openTime: string;
  closeTime: string;
  pips: number;
  grossProfit: number;
  commission: number;
  swap: number;
  netProfit: number;
  pnlBasis: "net";
  closeReason: Deal["reason"];
  /**
   * Risk fields, only on trades that opened with a stop loss (left out
   * otherwise, never written as 0): the entry stop loss, the dollars it put at
   * risk for these lots, that as % of the balance the trade opened on, the
   * planned reward:risk when a take profit was set at entry, and the result in
   * R (net profit ÷ dollars at risk).
   */
  stopLossAtEntry?: number;
  riskAmount?: number;
  riskPercent?: number;
  rr?: number;
  rMultiple?: number;
  status: "closed";
  source: "fynx-trade-engine";
  recordedAt: string;
}

// Engine ids look like "acc_1" and "pos_ab12cd:1"; "/" would make a sub-path, so it is refused.
const ID_PART = /^[A-Za-z0-9_:.-]{1,200}$/;

/** Fixed document id for a deal, so writing it again finds the same document. */
export function tradeRecordId(engineAccountId: string, dealId: string): string {
  if (!ID_PART.test(engineAccountId) || !ID_PART.test(dealId)) throw new Error(`Invalid account or deal id for a trade record: ${engineAccountId}/${dealId}`);
  return `fynxtrade_${engineAccountId}_${dealId}`;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Pips gained (+) or lost (−) between entry and exit, to one decimal. */
export function dealPips(deal: Pick<Deal, "side" | "entryPrice" | "exitPrice">, pipSize: number): number {
  if (!(pipSize > 0)) throw new Error("pipSize must be a positive number");
  const move = deal.side === "buy" ? deal.exitPrice - deal.entryPrice : deal.entryPrice - deal.exitPrice;
  return Math.round((move / pipSize) * 10) / 10;
}

const hundredths = (n: number) => Math.round(n * 100) / 100;

/**
 * Risk % of balance, planned reward:risk and the result in R for a deal that
 * opened with a stop loss; {} without entry risk (old deals, no stop loss).
 */
export function dealRiskFields(deal: Pick<Deal, "side" | "entryPrice" | "netProfit" | "entryRisk">): Pick<TradeRecord, "stopLossAtEntry" | "riskAmount" | "riskPercent" | "rr" | "rMultiple"> {
  const r = deal.entryRisk;
  if (!r || !(r.amount > 0) || !(r.balance > 0) || !Number.isFinite(r.stopLoss)) return {};
  const stopDistance = Math.abs(deal.entryPrice - r.stopLoss);
  const targetOk = r.takeProfit !== undefined && stopDistance > 0 && (deal.side === "buy" ? r.takeProfit > deal.entryPrice : r.takeProfit < deal.entryPrice);
  return {
    stopLossAtEntry: r.stopLoss,
    riskAmount: cents(r.amount),
    riskPercent: hundredths((r.amount / r.balance) * 100),
    ...(targetOk ? { rr: hundredths(Math.abs(r.takeProfit! - deal.entryPrice) / stopDistance) } : {}),
    rMultiple: hundredths(deal.netProfit / r.amount),
  };
}

/** Turns one closed engine deal into the record the FYNX Funded dashboard reads. */
export function dealToTradeRecord(engineAccountId: string, deal: Deal, owner: TradeOwner, pipSize: number, recordedAt: number): TradeRecord {
  if (!owner.userId) throw new Error("A trade record needs the trader's userId");
  if (!Number.isFinite(deal.openedAt) || !Number.isFinite(deal.closedAt) || deal.closedAt < deal.openedAt) throw new Error(`Deal ${deal.id} has invalid open/close times`);
  if (![deal.lots, deal.entryPrice, deal.exitPrice, deal.grossProfit, deal.commission, deal.netProfit].every(Number.isFinite)) throw new Error(`Deal ${deal.id} has a missing number`);
  return {
    userId: owner.userId,
    accountId: owner.accountId || engineAccountId,
    challengeId: owner.challengeId ?? "",
    engineAccountId,
    engineDealId: deal.id,
    positionId: deal.positionId,
    symbol: deal.symbol,
    side: deal.side,
    type: deal.side === "buy" ? "Buy" : "Sell",
    lots: deal.lots,
    entryPrice: deal.entryPrice,
    exitPrice: deal.exitPrice,
    openTime: new Date(deal.openedAt).toISOString(),
    closeTime: new Date(deal.closedAt).toISOString(),
    pips: dealPips(deal, pipSize),
    grossProfit: cents(deal.grossProfit),
    commission: cents(deal.commission),
    swap: cents(deal.swap ?? 0),
    // netProfit already includes commission and swap (engine core), so the dashboard uses it as is.
    netProfit: cents(deal.netProfit),
    pnlBasis: "net",
    closeReason: deal.reason,
    ...dealRiskFields(deal),
    status: "closed",
    source: "fynx-trade-engine",
    recordedAt: new Date(recordedAt).toISOString(),
  };
}

/** Creates a record; "exists" when a document with that id is already there (never overwrites). */
export interface TradeWriter {
  create(id: string, record: TradeRecord): Promise<"created" | "exists">;
}

/** The part of the Firebase Admin SDK the writer uses (DocumentReference.create fails with ALREADY_EXISTS). */
export interface FirestoreCreateLike {
  collection(path: string): { doc(id: string): { create(data: Record<string, unknown>): Promise<unknown> } };
}

const alreadyExists = (error: unknown) => {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === 6 || e?.code === "already-exists" || e?.code === "ALREADY_EXISTS" || /already exists/i.test(String(e?.message ?? ""));
};

/** Writer for the Firestore `trades` collection (Admin SDK on the engine host). */
export function firestoreTradeWriter(db: FirestoreCreateLike, collection = "trades"): TradeWriter {
  return {
    async create(id, record) {
      try {
        await db.collection(collection).doc(id).create({ ...record });
        return "created";
      } catch (error) {
        if (alreadyExists(error)) return "exists";
        throw error;
      }
    },
  };
}

export interface LedgerFailure { id: string; engineAccountId: string; dealId: string; reason: string; at: number }

export interface LedgerHealth {
  /** Deals waiting to be written (including the one being written). */
  pending: number;
  written: number;
  /** Deals whose record was already there (a retry or a sync after a restart). */
  alreadyRecorded: number;
  /** Deals that could not be written after every retry; `retryFailed()` tries them again. */
  failed: LedgerFailure[];
  lastWrittenAt: number | null;
  lastError: string | null;
}

export interface LedgerOptions {
  writer: TradeWriter;
  /** Who the engine account belongs to; null when unknown (the deal waits in `failed` with reason no_owner). */
  owner: (engineAccountId: string) => Promise<TradeOwner | null>;
  pipSize: (symbol: string) => number | undefined;
  /** Waits between attempts (default 1 s, 5 s, 30 s); after the last one the deal goes to `failed`. */
  retryDelaysMs?: number[];
  /** Called for each failed attempt (log it). Never called with secrets. */
  onError?: (error: Error, info: { engineAccountId: string; dealId: string; attempt: number }) => void;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How many written ids to remember to skip repeats without a write (default 5000). */
  rememberIds?: number;
  /** Most failures kept in health (default 500, oldest dropped). */
  maxFailures?: number;
}

interface Job { id: string; engineAccountId: string; deal: Deal }

export class EngineLedger {
  private queue: Job[] = [];
  private queued = new Set<string>();
  private done = new Set<string>();
  private failures = new Map<string, LedgerFailure & { job: Job }>();
  private running: Promise<void> | null = null;
  private stats = { written: 0, alreadyRecorded: 0, lastWrittenAt: null as number | null, lastError: null as string | null };
  private readonly delays: number[];
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private o: LedgerOptions) {
    this.delays = o.retryDelaysMs ?? [1000, 5000, 30000];
    this.clock = o.clock ?? Date.now;
    this.sleep = o.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** Pass to `venue.onEvents` (createEngineServer does this when given `ledger`). */
  readonly listener = (engineAccountId: string, events: EngineEvent[]) => {
    for (const event of events) if (event.type === "position_closed") this.record(engineAccountId, event.deal);
  };

  /** Queues one closed deal. Returns false when it is already written, queued or waiting in `failed`. */
  record(engineAccountId: string, deal: Deal): boolean {
    let id: string;
    try { id = tradeRecordId(engineAccountId, deal.id); } catch (error) {
      this.fail({ id: `${engineAccountId}/${deal.id}`, engineAccountId, deal }, "bad_id", error);
      return false;
    }
    if (this.done.has(id) || this.queued.has(id) || this.failures.has(id)) return false;
    this.queued.add(id);
    this.queue.push({ id, engineAccountId, deal });
    this.kick();
    return true;
  }

  /**
   * Queues every deal of an account (e.g. `state.history` after a restart or an outage).
   * Records that already exist are left untouched, so this is safe to run at any time.
   */
  sync(engineAccountId: string, deals: Deal[]): number {
    return deals.filter(deal => this.record(engineAccountId, deal)).length;
  }

  /** Puts every failed deal back in the queue. Returns how many. */
  retryFailed(): number {
    const jobs = [...this.failures.values()].map(f => f.job);
    this.failures.clear();
    for (const job of jobs) { this.queued.add(job.id); this.queue.push(job); }
    if (jobs.length) this.kick();
    return jobs.length;
  }

  /** Resolves when everything queued so far has been written or has failed (use before shutdown). */
  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  health(): LedgerHealth {
    return {
      pending: this.queue.length,
      written: this.stats.written,
      alreadyRecorded: this.stats.alreadyRecorded,
      failed: [...this.failures.values()].map(({ job: _job, ...f }) => f),
      lastWrittenAt: this.stats.lastWrittenAt,
      lastError: this.stats.lastError,
    };
  }

  private kick() {
    if (this.running) return;
    this.running = this.drain().finally(() => { this.running = null; if (this.queue.length) this.kick(); });
  }

  private async drain() {
    while (this.queue.length) {
      const job = this.queue[0];
      await this.write(job);
      this.queue.shift();
      this.queued.delete(job.id);
    }
  }

  private async write(job: Job) {
    const pipSize = this.o.pipSize(job.deal.symbol);
    if (!(typeof pipSize === "number" && pipSize > 0)) return this.fail(job, "unknown_symbol", new Error(`No pip size for ${job.deal.symbol}`));
    for (let attempt = 1; ; attempt++) {
      try {
        const owner = await this.o.owner(job.engineAccountId);
        if (!owner?.userId) return this.fail(job, "no_owner", new Error(`No FYNX Funded owner found for engine account ${job.engineAccountId}`));
        const record = dealToTradeRecord(job.engineAccountId, job.deal, owner, pipSize, this.clock());
        const result = await this.o.writer.create(job.id, record);
        if (result === "created") { this.stats.written++; this.stats.lastWrittenAt = this.clock(); }
        else this.stats.alreadyRecorded++;
        this.remember(job.id);
        return;
      } catch (raw) {
        const error = raw instanceof Error ? raw : new Error(String(raw));
        this.stats.lastError = error.message;
        this.o.onError?.(error, { engineAccountId: job.engineAccountId, dealId: job.deal.id, attempt });
        if (attempt > this.delays.length) return this.fail(job, "write_failed", error);
        await this.sleep(this.delays[attempt - 1]);
      }
    }
  }

  private fail(job: Job, reason: string, error: unknown) {
    this.stats.lastError = error instanceof Error ? error.message : String(error);
    if (reason === "bad_id") return; // cannot be retried: nothing to keep
    this.failures.set(job.id, { id: job.id, engineAccountId: job.engineAccountId, dealId: job.deal.id, reason, at: this.clock(), job });
    const max = this.o.maxFailures ?? 500;
    while (this.failures.size > max) this.failures.delete(this.failures.keys().next().value as string);
  }

  private remember(id: string) {
    this.done.add(id);
    const max = this.o.rememberIds ?? 5000;
    while (this.done.size > max) this.done.delete(this.done.values().next().value as string);
  }
}

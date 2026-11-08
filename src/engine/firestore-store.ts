import type { AccountStore } from "./venue";
import type { AccountState, ArchivedHistory, Deal } from "./types";
import { EngineError } from "./types";
import { archiveHistory } from "./core";

/**
 * Firestore AccountStore adapter for a server host (Cloud Function / FYNX API).
 *
 * It only needs the small part of the Firebase Admin SDK described by
 * `FirestoreLike`, so this file imports no Firebase SDK and is not part of the website
 * bundle. In a host:
 *
 *   import { getFirestore } from "firebase-admin/firestore";
 *   const store = new FirestoreAccountStore(getFirestore(), { collection: "engineAccounts" });
 *   const venue = new LocalVenue(specs, store, rulesFor, settings);
 *
 * Each account is one document (id = accountId) holding the engine state plus
 * `sequence`, which is the lock: `save` runs in a transaction and refuses with
 * `conflict` when the stored sequence is not the one the engine loaded.
 * Firestore security rules should deny all client access to this collection;
 * only the host's Admin SDK writes it.
 *
 * Long-lived accounts: when a document would grow past `archive.aboveBytes`
 * (default 600 000), the oldest deals are moved to numbered chunk documents in
 * the subcollection `{collection}/{accountId}/history/{000000…}` in the SAME
 * transaction, keeping the newest `archive.keepRecentDeals` (default 300) in
 * the account. The account keeps an `archived` summary (count, net profit,
 * daily results, recent client ids) so the best-day rule, retries and deal
 * numbering still work. Read old deals with `archivedDeals(accountId, index)`.
 */

export interface DocSnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
export interface DocRefLike { get(): Promise<DocSnapshotLike> }
export interface TransactionLike {
  get(ref: DocRefLike): Promise<DocSnapshotLike>;
  set(ref: DocRefLike, data: Record<string, unknown>): unknown;
}
export interface FirestoreLike {
  collection(path: string): { doc(id: string): DocRefLike };
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>;
}

export interface FirestoreStoreOptions {
  /** Collection that holds one document per engine account. Default "engineAccounts". */
  collection?: string;
  /** Refuse to write documents bigger than this many bytes (Firestore's hard limit is 1 MiB). Default 900 000. */
  maxDocumentBytes?: number;
  /** Clock for the `updatedAt` field (milliseconds). */
  clock?: () => number;
  /** Move old deals to the history subcollection when the document gets big; `false` turns it off. */
  archive?: false | {
    /** Archive when the document would be bigger than this many bytes. Default 600 000. */
    aboveBytes?: number;
    /** Newest deals kept in the account document. Default 300. */
    keepRecentDeals?: number;
    /** Deals per archive document. Default 250. */
    chunkSize?: number;
    /** The accounts' daily reset hour (UTC); must match the rules. Default 22 (FYNX Funded). */
    resetHourUtc?: number;
  };
}

/** Archive document id for a chunk index: zero-padded so ids sort in order. */
export const archiveChunkId = (index: number) => String(index).padStart(6, "0");

export interface ArchiveChunk { accountId: string; index: number; firstClosedAt: number; lastClosedAt: number; deals: Deal[] }

/** Firestore refuses `undefined` values; drop them (and copy) before writing. */
export function toFirestoreData(state: AccountState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

const STATUSES = new Set(["active", "passed", "breached", "disabled"]);
const isArr = Array.isArray;

/** Checks a stored document really is an engine account before the engine uses it. */
export function fromFirestoreData(accountId: string, data: Record<string, unknown> | undefined): AccountState {
  const d = data ?? {};
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const ok = d.accountId === accountId && d.currency === "USD" && typeof d.status === "string" && STATUSES.has(d.status)
    && fin(d.balance) && fin(d.dayStartBalance) && typeof d.tradingDay === "string" && Number.isInteger(d.sequence)
    && isArr(d.tradingDays) && isArr(d.positions) && isArr(d.orders) && isArr(d.history);
  if (!ok || (d.archived !== undefined && !validArchive(d.archived))) throw new EngineError("bad_state", `Stored engine account ${accountId} is malformed; it was not loaded.`);
  const { updatedAt: _ignored, ...state } = d;
  return state as unknown as AccountState;
}

function validArchive(a: unknown): a is ArchivedHistory {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  const int = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return int(x.deals) && int(x.chunks) && fin(x.netProfit) && int(x.resetHourUtc) && (x.resetHourUtc as number) < 24
    && fin(x.firstClosedAt) && fin(x.lastClosedAt) && Array.isArray(x.clientIds) && x.clientIds.every(c => typeof c === "string")
    && !!x.dailyResults && typeof x.dailyResults === "object" && !Array.isArray(x.dailyResults) && Object.values(x.dailyResults).every(fin);
}

const bytesOf = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).length;

export class FirestoreAccountStore implements AccountStore {
  private readonly collection: string;
  private readonly maxBytes: number;
  private readonly clock: () => number;
  private readonly archive: { aboveBytes: number; keep: number; chunkSize: number; resetHourUtc: number } | null;
  constructor(private db: FirestoreLike, opts: FirestoreStoreOptions = {}) {
    this.collection = opts.collection ?? "engineAccounts";
    this.maxBytes = opts.maxDocumentBytes ?? 900_000;
    this.clock = opts.clock ?? Date.now;
    const a = opts.archive === false ? null : opts.archive ?? {};
    this.archive = a && { aboveBytes: a.aboveBytes ?? 600_000, keep: a.keepRecentDeals ?? 300, chunkSize: a.chunkSize ?? 250, resetHourUtc: a.resetHourUtc ?? 22 };
  }

  private chunkRef(accountId: string, index: number) {
    this.ref(accountId);
    return this.db.collection(`${this.collection}/${accountId}/history`).doc(archiveChunkId(index));
  }

  /** One archived chunk of old deals (oldest first), or null if that chunk does not exist. */
  async archivedDeals(accountId: string, index: number): Promise<ArchiveChunk | null> {
    if (!Number.isInteger(index) || index < 0) throw new EngineError("bad_request", "Archive chunk index must be a whole number from 0.");
    const snap = await this.chunkRef(accountId, index).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    if (d.accountId !== accountId || d.index !== index || !Array.isArray(d.deals)) throw new EngineError("bad_state", `Archive chunk ${index} of ${accountId} is malformed.`);
    return d as unknown as ArchiveChunk;
  }

  private ref(accountId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new EngineError("bad_request", "Account id has characters that are not allowed.");
    return this.db.collection(this.collection).doc(accountId);
  }

  async load(accountId: string): Promise<AccountState | null> {
    const snap = await this.ref(accountId).get();
    return snap.exists ? fromFirestoreData(accountId, snap.data()) : null;
  }

  /** `expectedSequence` -1 means "create": refused if the document already exists. */
  async save(state: AccountState, expectedSequence: number): Promise<void> {
    const ref = this.ref(state.accountId);
    let data = { ...toFirestoreData(state), updatedAt: this.clock() };
    let chunks: { index: number; deals: Deal[] }[] = [];
    if (this.archive && bytesOf(data) > this.archive.aboveBytes && state.history.length > this.archive.keep) {
      const moved = archiveHistory(state, { keep: this.archive.keep, resetHourUtc: this.archive.resetHourUtc, chunkSize: this.archive.chunkSize });
      data = { ...toFirestoreData(moved.state), updatedAt: data.updatedAt };
      chunks = moved.chunks;
    }
    const bytes = bytesOf(data);
    if (bytes > this.maxBytes) throw new EngineError("state_too_large", `Account ${state.accountId} state is ${bytes} bytes; move old history out before saving.`);
    const writes = chunks.map(c => {
      const doc = JSON.parse(JSON.stringify({ accountId: state.accountId, index: c.index, firstClosedAt: c.deals[0].closedAt, lastClosedAt: c.deals[c.deals.length - 1].closedAt, deals: c.deals })) as Record<string, unknown>;
      if (bytesOf(doc) > this.maxBytes) throw new EngineError("state_too_large", `Archive chunk ${c.index} of ${state.accountId} is too big; use a smaller chunkSize.`);
      return [this.chunkRef(state.accountId, c.index), doc] as const;
    });
    await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const stored = snap.exists ? (snap.data()?.sequence as number | undefined) : undefined;
      if (expectedSequence === -1 ? snap.exists : stored !== expectedSequence) throw new EngineError("conflict", "The account changed; retry.");
      for (const [r, d] of writes) tx.set(r, d);
      tx.set(ref, data);
    });
  }
}

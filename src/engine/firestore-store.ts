import type { AccountStore } from "./venue";
import type { AccountState } from "./types";
import { EngineError } from "./types";

/**
 * Firestore AccountStore adapter for a server host (Cloud Function / FYNX API).
 *
 * It only needs the small part of the Firebase Admin SDK described by
 * `FirestoreLike`, so this file imports nothing and is not part of the website
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
}

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
  if (!ok) throw new EngineError("bad_state", `Stored engine account ${accountId} is malformed; it was not loaded.`);
  const { updatedAt: _ignored, ...state } = d;
  return state as unknown as AccountState;
}

export class FirestoreAccountStore implements AccountStore {
  private readonly collection: string;
  private readonly maxBytes: number;
  private readonly clock: () => number;
  constructor(private db: FirestoreLike, opts: FirestoreStoreOptions = {}) {
    this.collection = opts.collection ?? "engineAccounts";
    this.maxBytes = opts.maxDocumentBytes ?? 900_000;
    this.clock = opts.clock ?? Date.now;
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
    const data = { ...toFirestoreData(state), updatedAt: this.clock() };
    const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
    if (bytes > this.maxBytes) throw new EngineError("state_too_large", `Account ${state.accountId} state is ${bytes} bytes; move old history out before saving.`);
    await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const stored = snap.exists ? (snap.data()?.sequence as number | undefined) : undefined;
      if (expectedSequence === -1 ? snap.exists : stored !== expectedSequence) throw new EngineError("conflict", "The account changed; retry.");
      tx.set(ref, data);
    });
  }
}

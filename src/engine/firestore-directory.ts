import { rulesFromPurchase, type PurchasedRules } from "./venue";
import type { RuleSet } from "./types";
import { EngineError } from "./types";
import type { TradeOwner } from "./ledger";
import type { NoticeRecipient } from "./notifier";

/**
 * Account directory for the engine host: answers the six questions the engine
 * server asks about an account (`rulesFor`, `accounts`, `canAccess`,
 * `tradingEnabled`, ledger `owner`, notifier `recipient`) straight from the
 * documents FYNX Funded already writes at checkout:
 *
 *   accounts/{id}    platform "FYNX Trade", accessVersion 1, userId, challengeId,
 *                    orderId, status, activationStatus, startingBalance,
 *                    rules (the purchased rule snapshot), tradingEnabled
 *   challenges/{id}  userId, orderId, status (active | passed | funded | …),
 *                    brokerAccountId (the account of the CURRENT phase)
 *   orders/{id}      userId, challengeId, status ("paid")
 *
 * The engine account id is the `accounts` document id (`ft_…_p1`), the same id
 * the terminal sends. With it the host file needs no hand-written lookups:
 *
 *   const directory = new FirestoreAccountDirectory(db, { lookupUser: uid => getAuth().getUser(uid) });
 *   createEngineServer({ ...directory.engineOptions(), ledger: new EngineLedger({ owner: directory.owner, … }),
 *     notifier: new EngineNotifier({ recipient: directory.recipient, … }), … });
 *
 * Safety (trading stays off until the owner switches it on, twice):
 *  - `tradingEnabled` is true only when the host was started with
 *    `allowTrading: true` (the owner's master switch, default false) AND the
 *    account document says `tradingEnabled: true` AND the purchase still binds
 *    (paid order, challenge active or funded, account active and the
 *    challenge's current account). A passed phase waits for review: no trading.
 *  - Only `platform: "FYNX Trade"`, `accessVersion: 1` accounts exist for the
 *    engine; anything else is `no_account`.
 *  - Rules come only from the purchased snapshot on the account (never from
 *    today's public pages); a snapshot that does not match the account's
 *    starting balance, or a trailing maximum loss the engine does not apply,
 *    is refused with `bad_rules` so it goes to review instead of trading.
 *  - Read-only: it never writes to Firestore.
 *
 * Reads are cached (`cacheMs`, default 15 s) because the engine asks for the
 * rules on every timer step; switching trading off reaches the engine within
 * that time (or at once with `invalidate(id)`). The runnable-account list is
 * re-read every `listEveryMs` (default 30 s).
 */

export interface DirectoryDocSnapshot { exists: boolean; data(): Record<string, unknown> | undefined }
export interface DirectoryQuerySnapshot { docs: { id: string; data(): Record<string, unknown> | undefined }[] }
export interface DirectoryQuery {
  where(field: string, op: "==", value: unknown): DirectoryQuery;
  limit(n: number): DirectoryQuery;
  get(): Promise<DirectoryQuerySnapshot>;
}
/** The small part of the Firebase Admin Firestore API this file uses. */
export interface DirectoryFirestore {
  collection(path: string): DirectoryQuery & { doc(id: string): { get(): Promise<DirectoryDocSnapshot> } };
}

/** What Firebase Auth's `getUser(uid)` returns (only these fields are read). */
export interface DirectoryUser { email?: string | null; emailVerified?: boolean; displayName?: string | null; disabled?: boolean }

export interface DirectoryOptions {
  /**
   * The owner's master switch for this host. Default false: `tradingEnabled`
   * is then false for every account whatever the documents say.
   */
  allowTrading?: boolean;
  /** Reads a user for notice emails, e.g. `uid => getAuth().getUser(uid)`. Without it `recipient` is always null. */
  lookupUser?: (userId: string) => Promise<DirectoryUser | null>;
  /** How long account lookups are reused (default 15 000 ms, 0 = no cache). */
  cacheMs?: number;
  /** How often the runnable-account list is re-read (default 30 000 ms). */
  listEveryMs?: number;
  /** Most accounts the timer step watches; more is reported as an error (default 5000). */
  maxAccounts?: number;
  clock?: () => number;
}

export type AccountStage = "evaluation" | "funded";

export interface DirectoryEntry {
  accountId: string;
  userId: string;
  challengeId: string;
  orderId: string;
  stage: AccountStage;
  phase: number | null;
  /** The purchase still binds and the challenge is running on this account. */
  runnable: boolean;
  /** Why the account is view-only, in plain words (empty when runnable). */
  holdReason: string;
  /** The account document's own switch (`tradingEnabled: true`). */
  accountSwitch: boolean;
  /** Rules from the purchased snapshot, or the refusal when they cannot be used. */
  rules: RuleSet | EngineError;
}

const RUNNING = ["active", "funded"];
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : "");
const isId = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);

/** Pure: turns the three documents into a directory entry (exported for tests and for a host that reads them itself). */
export function directoryEntry(accountId: string, account: Record<string, unknown> | undefined, challenge: Record<string, unknown> | undefined, order: Record<string, unknown> | undefined): DirectoryEntry {
  if (!account || account.platform !== "FYNX Trade" || account.accessVersion !== 1) throw new EngineError("no_account", "Account not found.");
  const userId = str(account.userId), challengeId = str(account.challengeId), orderId = str(account.orderId);
  if (!userId || !challengeId || !orderId) throw new EngineError("no_account", "Account not found.");
  const funded = challenge?.status === "funded";
  const phase = Number.isInteger(account.currentPhase) ? (account.currentPhase as number) : null;

  let holdReason = "";
  if (!challenge || !order || challenge.userId !== userId || order.userId !== userId || order.challengeId !== challengeId || challenge.orderId !== orderId) holdReason = "The purchase linked to this account needs a review by support.";
  else if (order.status !== "paid") holdReason = "The order for this account is not paid.";
  else if (challenge.status === "passed") holdReason = "This phase was passed and is waiting for review.";
  else if (!RUNNING.includes(String(challenge.status))) holdReason = "This challenge has ended; the account is kept for history.";
  else if (account.status !== "active") holdReason = "This account is no longer active; it is kept for history.";
  else if (challenge.brokerAccountId !== accountId) holdReason = "A newer account replaced this one for the next phase; this one is kept for history.";

  let rules: RuleSet | EngineError;
  try {
    const snap = account.rules as (PurchasedRules & { max_loss_type?: unknown }) | undefined;
    if (!snap || typeof snap !== "object") throw new EngineError("bad_rules", "This account has no purchased rules on record; it needs a review.");
    if (snap.max_loss_type !== undefined && snap.max_loss_type !== "static") throw new EngineError("bad_rules", "This account's maximum loss is not a static limit, which the engine does not apply; it needs a review.");
    const balance = Number(account.startingBalance);
    if (snap.starting_balance !== undefined && Number(snap.starting_balance) !== balance) throw new EngineError("bad_rules", "The purchased rules do not match this account's starting balance; it needs a review.");
    rules = rulesFromPurchase(balance, snap, { funded });
  } catch (e) {
    rules = e instanceof EngineError ? e : new EngineError("bad_rules", "This account's rules could not be read; it needs a review.");
  }

  return {
    accountId, userId, challengeId, orderId, stage: funded ? "funded" : "evaluation", phase,
    runnable: holdReason === "", holdReason, accountSwitch: account.tradingEnabled === true, rules,
  };
}

export class FirestoreAccountDirectory {
  private cache = new Map<string, { at: number; entry: Promise<DirectoryEntry> }>();
  private list: { at: number; ids: Promise<string[]> } | null = null;
  private readonly clock: () => number;

  constructor(private db: DirectoryFirestore, private opts: DirectoryOptions = {}) {
    this.clock = opts.clock ?? Date.now;
  }

  /** The account's entry; `no_account` when it is not a FYNX Trade account. */
  entry(accountId: string): Promise<DirectoryEntry> {
    if (!isId(accountId)) return Promise.reject(new EngineError("no_account", "Account not found."));
    const ttl = this.opts.cacheMs ?? 15_000, now = this.clock();
    const hit = this.cache.get(accountId);
    if (hit && ttl > 0 && now - hit.at < ttl) return hit.entry;
    const entry = this.read(accountId);
    this.cache.set(accountId, { at: now, entry });
    entry.catch(() => { if (this.cache.get(accountId)?.entry === entry) this.cache.delete(accountId); }); // never keep a failed read
    if (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value as string);
    return entry;
  }

  private async read(accountId: string): Promise<DirectoryEntry> {
    const account = (await this.db.collection("accounts").doc(accountId).get()).data();
    const challengeId = str(account?.challengeId), orderId = str(account?.orderId);
    const [c, o] = await Promise.all([
      challengeId && isId(challengeId) ? this.db.collection("challenges").doc(challengeId).get() : null,
      orderId && isId(orderId) ? this.db.collection("orders").doc(orderId).get() : null,
    ]);
    return directoryEntry(accountId, account, c?.data(), o?.data());
  }

  /** Forgets cached lookups (one account, or all), e.g. right after the owner flips a switch. */
  invalidate(accountId?: string) {
    if (accountId === undefined) { this.cache.clear(); this.list = null; } else this.cache.delete(accountId);
  }

  /** For createEngineServer / LocalVenue: the purchased rules of the account. */
  rulesFor = async (accountId: string): Promise<RuleSet> => {
    const { rules } = await this.entry(accountId);
    if (rules instanceof EngineError) throw rules;
    return rules;
  };

  /** For createEngineServer: true only for the account's own trader. Any lookup failure answers false. */
  canAccess = async (userId: string, accountId: string): Promise<boolean> => {
    if (!userId) return false;
    try { return (await this.entry(accountId)).userId === userId; } catch { return false; }
  };

  /** For createEngineServer: master switch AND account switch AND a running, correctly bound purchase AND usable rules. */
  tradingEnabled = async (accountId: string): Promise<boolean> => {
    if (this.opts.allowTrading !== true) return false;
    try {
      const e = await this.entry(accountId);
      return e.runnable && e.accountSwitch && !(e.rules instanceof EngineError);
    } catch { return false; }
  };

  /** For createEngineServer's timer step: activated FYNX Trade accounts whose challenge is running on them. */
  accounts = (): Promise<string[]> => {
    const now = this.clock();
    if (this.list && now - this.list.at < (this.opts.listEveryMs ?? 30_000)) return this.list.ids;
    const ids = this.readList();
    this.list = { at: now, ids };
    ids.catch(() => { if (this.list?.ids === ids) this.list = null; });
    return ids;
  };

  private async readList(): Promise<string[]> {
    const max = this.opts.maxAccounts ?? 5000;
    const snap = await this.db.collection("accounts")
      .where("platform", "==", "FYNX Trade").where("status", "==", "active").where("activationStatus", "==", "active")
      .limit(max + 1).get();
    if (snap.docs.length > max) throw new Error(`More than ${max} active FYNX Trade accounts; raise maxAccounts or run more hosts.`);
    const candidates = snap.docs.filter(d => isId(d.id) && d.data()?.accessVersion === 1).map(d => d.id);
    const ids: string[] = [];
    for (let i = 0; i < candidates.length; i += 50) {
      const batch = candidates.slice(i, i + 50);
      const runnable = await Promise.all(batch.map(id => this.entry(id).then(e => e.runnable, () => false)));
      batch.forEach((id, k) => { if (runnable[k]) ids.push(id); });
    }
    return ids;
  }

  /** For EngineLedger: who the account's closed trades belong to on the dashboard. */
  owner = async (accountId: string): Promise<TradeOwner | null> => {
    try {
      const e = await this.entry(accountId);
      return { userId: e.userId, challengeId: e.challengeId, accountId: e.accountId };
    } catch { return null; }
  };

  /** For EngineNotifier: the trader's verified email (null without lookupUser, unverified, disabled or missing). */
  recipient = async (accountId: string): Promise<NoticeRecipient | null> => {
    if (!this.opts.lookupUser) return null;
    try {
      const e = await this.entry(accountId);
      const user = await this.opts.lookupUser(e.userId);
      const email = str(user?.email).trim();
      if (!user || user.disabled || user.emailVerified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
      const name = str(user.displayName).trim().slice(0, 80);
      return name ? { email, name } : { email };
    } catch { return null; }
  };

  /** The four options createEngineServer takes from a directory. */
  engineOptions() {
    return { rulesFor: this.rulesFor, accounts: this.accounts, canAccess: this.canAccess, tradingEnabled: this.tradingEnabled };
  }
}

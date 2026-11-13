import { noticePrefs } from "./core";
import type { AccountStore } from "./venue";
import type { CloseReason, EngineEvent, NoticeKind, NoticePrefs, Position } from "./types";

/**
 * Trader notices: tells a trader by email (or any channel the host connects)
 * when something happens on the trading server while the terminal may be
 * closed — a price alert fires, a pending order fills, a stop loss or take
 * profit closes a trade, a loss limit is reached, equity comes close to a loss
 * limit (the trader's chosen distance), the target is reached, or a pending
 * order expires.
 *
 * The engine only decides WHAT to say (`noticesFor`, pure and tested) and the
 * trader's choices (`setNotices` in core, PATCH /v1/accounts/{id}/notices).
 * The host decides HOW it is sent by passing `send`. Nothing is sent until the
 * owner connects a sender; the terminal shows "notices start once the sender
 * is connected" until `/v1/status` says `notices: true`.
 *
 * Wiring in a host (createEngineServer adds the listener and the status flag):
 *
 *   const notifier = new EngineNotifier({
 *     send: firestoreMailSender(getFirestore()),              // "mail" collection, Firebase Trigger Email format
 *     recipient: async engineAccountId => ({ email }),        // the trader's verified email, or null
 *   });
 *   createEngineServer({ …, notifier });
 *
 * Safety: notices never trade; recipient addresses are never logged, kept in
 * health or put in an error; each notice has a fixed id so a retry or a
 * restart never sends the same notice twice through `firestoreMailSender`;
 * at most `maxPerHour` notices per account (default 30), the rest are counted
 * and dropped so a noisy market cannot flood an inbox.
 */

export interface Notice {
  /** Fixed per event (e.g. "acc_1:alert:alr_3"), safe as a document id after `noticeDocId`. */
  id: string;
  accountId: string;
  kind: NoticeKind;
  subject: string;
  text: string;
  at: number;
}

export interface NoticeRecipient { email: string; name?: string }

export interface NoticeContext {
  /** Decimals for a symbol's prices (default 3 for JPY pairs, 5 otherwise). */
  digits?: (symbol: string) => number;
  /** Where the trader opens the terminal (default https://www.fynxfunded.com/trade/access). */
  terminalUrl?: string;
}

const TERMINAL = "https://www.fynxfunded.com/trade/access";
const defaultDigits = (s: string) => (s.endsWith("JPY") ? 3 : 5);
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${money(v)}`;
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const LIMIT_NAME: Partial<Record<CloseReason, string>> = { daily_loss_limit: "daily loss limit", maximum_loss_limit: "maximum loss limit" };

/**
 * Turns one batch of engine events into the notices worth sending, before the
 * trader's choices are applied (the notifier does that). Pure: same input,
 * same notices, same ids.
 */
export function noticesFor(accountId: string, events: EngineEvent[], at: number, ctx: NoticeContext = {}): Notice[] {
  const digits = ctx.digits ?? defaultDigits, link = ctx.terminalUrl ?? TERMINAL;
  const px = (symbol: string, v: number) => v.toFixed(digits(symbol));
  const footer = `\n\nOpen FYNX Trade: ${link}\nYou can choose which notices you get in the terminal's Alerts tab.`;
  const out: Notice[] = [];
  // "One cancels the other": the linked order the fill cancelled, said in the fill notice.
  const ocoNote = (filledId: string) => {
    const c = events.find((x): x is Extract<EngineEvent, { type: "order_cancelled" }> => x.type === "order_cancelled" && x.reason === "oco" && x.order?.ocoWith === filledId)?.order;
    return c ? `\nYour linked order (${c.side} ${c.type} ${c.lots.toFixed(2)} ${c.symbol} at ${px(c.symbol, c.price)}) was cancelled, as you asked: one cancels the other.` : "";
  };
  const add = (kind: NoticeKind, key: string, subject: string, body: string) => out.push({ id: `${accountId}:${kind}:${key}`, accountId, kind, subject, text: body + footer, at });
  const opened = new Map<string, Position>();
  for (const e of events) if (e.type === "position_opened") opened.set(e.position.id, e.position);

  for (const e of events) {
    switch (e.type) {
      case "alert_triggered": {
        const a = e.alert, dir = a.condition === "above" ? "above" : "below";
        add("alert", a.id, `Price alert: ${a.symbol} bid went ${dir} ${px(a.symbol, a.price)}`,
          `Your price alert on ${a.symbol} fired at ${utc(a.triggeredAt)}.\nThe bid reached ${px(a.symbol, a.triggerPrice)} (your level: ${dir} ${px(a.symbol, a.price)}).${a.note ? `\nYour note: ${a.note}` : ""}\n\nAn alert only tells you: nothing was opened or closed.`);
        break;
      }
      case "order_triggered": {
        const p = opened.get(e.positionId);
        if (!p) break;
        add("fill", e.orderId, `Order filled: ${p.side === "buy" ? "Buy" : "Sell"} ${p.lots.toFixed(2)} ${p.symbol} at ${px(p.symbol, p.entryPrice)}`,
          `Your pending order on ${p.symbol} was filled at ${utc(p.openedAt)}: ${p.side} ${p.lots.toFixed(2)} lots at ${px(p.symbol, p.entryPrice)}.\nStop loss: ${p.stopLoss !== undefined ? px(p.symbol, p.stopLoss) : "none"} · Take profit: ${p.takeProfit !== undefined ? px(p.symbol, p.takeProfit) : "none"}.${ocoNote(e.orderId)}`);
        break;
      }
      case "position_closed": {
        const d = e.deal;
        if (d.reason !== "stop_loss" && d.reason !== "take_profit") break;
        const what = d.reason === "stop_loss" ? "Stop loss" : "Take profit";
        add("stop", d.id, `${what} hit: ${d.symbol} ${signed(d.netProfit)}`,
          `${what} closed your ${d.side} ${d.lots.toFixed(2)} lots ${d.symbol} at ${px(d.symbol, d.exitPrice)} (${utc(d.closedAt)}).\nOpened at ${px(d.symbol, d.entryPrice)}. Result after commission and swap: ${signed(d.netProfit)}.`);
        break;
      }
      case "account_breached": {
        const name = LIMIT_NAME[e.reason] ?? "loss limit";
        const closed = events.filter((x): x is Extract<EngineEvent, { type: "position_closed" }> => x.type === "position_closed" && x.deal.reason === e.reason);
        const net = closed.reduce((s, x) => s + x.deal.netProfit, 0);
        add("limit", `${e.reason}:${at}`, `The ${name} was reached on your FYNX Trade account`,
          `The ${name} was reached at ${utc(at)}.${closed.length ? ` The trading server closed ${closed.length} open trade${closed.length === 1 ? "" : "s"} (result ${signed(net)}) and` : " The trading server"} cancelled any pending orders. The account takes no new trades.\nFYNX confirms the official result of your account; you will hear from us.`);
        break;
      }
      case "target_reached":
        add("target", "first", "Profit target reached on your FYNX Trade account",
          `Your account reached its profit target with the minimum trading days and the best-day rule met (${utc(at)}).\nThis is not yet the official result: FYNX reviews the account before the next step.`);
        break;
      case "limit_near": {
        const w = e.warning, name = w.limit === "daily" ? "daily loss limit" : "maximum loss limit";
        add("near", `${w.limit}:${w.tradingDay}`, `Close to your ${name}: ${money(w.room)} left`,
          `At ${utc(w.at)} your equity was ${money(w.equity)}, which is ${money(w.room)} above the ${name} level of ${money(w.floor)} (${w.roomPercent.toFixed(1)}% of the ${money(w.allowance)} allowance left; you asked to be warned at ${w.thresholdPercent}% or less).\nIf equity reaches ${money(w.floor)}, the trading server closes all open trades and the account takes no new trades.${w.limit === "daily" ? "\nThe daily loss limit starts again at the next daily reset." : "\nThe maximum loss limit does not reset."}\n\nThis is only a warning: nothing was opened or closed. You get it at most once per limit per trading day.`);
        break;
      }
      case "order_expired": {
        const o = e.order;
        add("expiry", o.id, `Order expired: ${o.side} ${o.type} ${o.symbol} at ${px(o.symbol, o.price)}`,
          `Your pending ${o.side} ${o.type} order on ${o.symbol} (${o.lots.toFixed(2)} lots at ${px(o.symbol, o.price)}) reached its expiry time and was cancelled at ${utc(o.expiredAt)}. Nothing was opened.`);
        break;
      }
      default: break;
    }
  }
  // "No weekend holding": one notice for all trades the rule closed in this batch.
  const weekend = events.filter((x): x is Extract<EngineEvent, { type: "position_closed" }> => x.type === "position_closed" && x.deal.reason === "weekend_close").map(x => x.deal);
  if (weekend.length) {
    const net = weekend.reduce((s, d) => s + d.netProfit, 0);
    const lines = weekend.map(d => `- ${d.side} ${d.lots.toFixed(2)} lots ${d.symbol}: opened at ${px(d.symbol, d.entryPrice)}, closed at ${px(d.symbol, d.exitPrice)}, ${signed(d.netProfit)}`).join("\n");
    add("limit", `weekend:${weekend[0].id}`, `${weekend.length} trade${weekend.length === 1 ? "" : "s"} closed before the weekend: ${signed(net)}`,
      `Your account may not hold trades over the weekend, so the trading server closed ${weekend.length === 1 ? "this trade" : "these trades"} at ${utc(weekend[0].closedAt)}, shortly before the market close:\n${lines}\nResult after commission and swap: ${signed(net)}.\n\nThe account stays open. Pending orders keep waiting and can fill after the market reopens.`);
  }
  // Margin stop out: one notice for all trades it closed in this batch.
  const stopped = events.filter((x): x is Extract<EngineEvent, { type: "position_closed" }> => x.type === "position_closed" && x.deal.reason === "stop_out").map(x => x.deal);
  if (stopped.length) {
    const net = stopped.reduce((s, d) => s + d.netProfit, 0);
    const lines = stopped.map(d => `- ${d.side} ${d.lots.toFixed(2)} lots ${d.symbol}: opened at ${px(d.symbol, d.entryPrice)}, closed at ${px(d.symbol, d.exitPrice)}, ${signed(d.netProfit)}`).join("\n");
    add("limit", `stop_out:${stopped[0].id}`, `Margin stop out: ${stopped.length} trade${stopped.length === 1 ? "" : "s"} closed, ${signed(net)}`,
      `The margin level on your account fell to the stop-out level, so the trading server closed ${stopped.length === 1 ? "this trade" : "these trades"} at ${utc(stopped[0].closedAt)}, the largest loss first, until the margin level was above the level again:\n${lines}\nResult after commission and swap: ${signed(net)}.\n\nThe account stays open. Your other trades and pending orders are unchanged.`);
  }
  return out;
}

/** A Firestore-safe document id for a notice (no slashes, at most 200 characters). */
export function noticeDocId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 200);
}

export type NoticeSend = (notice: Notice, to: NoticeRecipient) => Promise<"sent" | "exists">;

/** The part of the Firebase Admin SDK the mail sender uses (DocumentReference.create fails with ALREADY_EXISTS). */
export interface FirestoreCreateLike {
  collection(path: string): { doc(id: string): { create(data: Record<string, unknown>): Promise<unknown> } };
}

const alreadyExists = (error: unknown) => {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === 6 || e?.code === "already-exists" || e?.code === "ALREADY_EXISTS" || /already exists/i.test(String(e?.message ?? ""));
};

/**
 * Sends notices by writing one document per notice in the format of the
 * Firebase "Trigger Email" extension ({ to, message: { subject, text } }).
 * The owner installs the extension (or any mail worker reading this
 * collection) with the email provider of their choice. Create-only with the
 * notice's fixed id, so a repeat is "exists", never a second email.
 */
export function firestoreMailSender(db: FirestoreCreateLike, collection = "mail"): NoticeSend {
  return async (notice, to) => {
    try {
      await db.collection(collection).doc(noticeDocId(notice.id)).create({
        to: to.email,
        message: { subject: notice.subject, text: notice.text },
        engineNotice: { accountId: notice.accountId, kind: notice.kind, at: notice.at },
      });
      return "sent";
    } catch (error) {
      if (alreadyExists(error)) return "exists";
      throw error;
    }
  };
}

export interface NotifierOptions {
  send: NoticeSend;
  /** The trader's address for an engine account; null when unknown (the notice is counted under `noRecipient`). */
  recipient: (accountId: string) => Promise<NoticeRecipient | null>;
  /** The trader's choices. createEngineServer reads them from the account store; default: all defaults. */
  prefsFor?: (accountId: string) => Promise<NoticePrefs>;
  context?: NoticeContext;
  /** Notices per account per rolling hour (default 30). */
  maxPerHour?: number;
  /** Waits between attempts (default 2 s, 10 s, 60 s); after the last one the notice goes to `failed`. */
  retryDelaysMs?: number[];
  /** Called for each failed attempt (log it). Never called with the address. */
  onError?: (error: Error, info: { noticeId: string; attempt: number }) => void;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How many sent ids to remember to skip repeats (default 5000). */
  rememberIds?: number;
  /** Most failures kept (default 200, oldest dropped). */
  maxFailures?: number;
}

export interface NotifierFailure { id: string; accountId: string; kind: NoticeKind; reason: string; at: number }

export interface NotifierHealth {
  pending: number;
  sent: number;
  /** Already sent before (a retry or restart): nothing sent twice. */
  alreadySent: number;
  /** Not sent because the trader switched that notice off. */
  switchedOff: number;
  /** Not sent because the account has no known address. */
  noRecipient: number;
  /** Dropped by the per-account hourly cap. */
  rateLimited: number;
  failed: NotifierFailure[];
  lastSentAt: number | null;
  lastError: string | null;
}

/** Reads the trader's choices from an AccountStore (defaults when the account is missing). */
export function storePrefs(store: AccountStore): (accountId: string) => Promise<NoticePrefs> {
  return async accountId => noticePrefs((await store.load(accountId)) ?? {});
}

export class EngineNotifier {
  private queue: Notice[] = [];
  private queued = new Set<string>();
  private done = new Set<string>();
  private failures = new Map<string, NotifierFailure & { notice: Notice }>();
  private sentAt = new Map<string, number[]>();
  private running: Promise<void> | null = null;
  private stats = { sent: 0, alreadySent: 0, switchedOff: 0, noRecipient: 0, rateLimited: 0, lastSentAt: null as number | null, lastError: null as string | null };
  private readonly delays: number[];
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private o: NotifierOptions) {
    this.delays = o.retryDelaysMs ?? [2000, 10000, 60000];
    this.clock = o.clock ?? Date.now;
    this.sleep = o.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** Pass to `venue.onEvents` (createEngineServer does this when given `notifier`). */
  readonly listener = (accountId: string, events: EngineEvent[]) => {
    for (const n of noticesFor(accountId, events, this.clock(), this.o.context)) this.enqueue(n);
  };

  /** Queues one notice. False when it was already sent, is queued or is waiting in `failed`. */
  enqueue(notice: Notice): boolean {
    if (this.done.has(notice.id) || this.queued.has(notice.id) || this.failures.has(notice.id)) return false;
    this.queued.add(notice.id);
    this.queue.push(notice);
    this.kick();
    return true;
  }

  /** Puts every failed notice back in the queue. Returns how many. */
  retryFailed(): number {
    const list = [...this.failures.values()].map(f => f.notice);
    this.failures.clear();
    for (const n of list) { this.queued.add(n.id); this.queue.push(n); }
    if (list.length) this.kick();
    return list.length;
  }

  /** Resolves when everything queued so far is sent, skipped or failed (use before shutdown). */
  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  health(): NotifierHealth {
    return { pending: this.queue.length, ...this.stats, failed: [...this.failures.values()].map(({ notice: _n, ...f }) => f) };
  }

  private kick() {
    if (this.running) return;
    this.running = this.drain().finally(() => { this.running = null; if (this.queue.length) this.kick(); });
  }

  private async drain() {
    while (this.queue.length) {
      const n = this.queue[0];
      await this.deliver(n);
      this.queue.shift();
      this.queued.delete(n.id);
    }
  }

  private underCap(accountId: string): boolean {
    const now = this.clock(), max = this.o.maxPerHour ?? 30;
    const recent = (this.sentAt.get(accountId) ?? []).filter(t => now - t < 3_600_000);
    this.sentAt.set(accountId, recent);
    return recent.length < max;
  }

  private async deliver(n: Notice) {
    for (let attempt = 1; ; attempt++) {
      try {
        const prefs = this.o.prefsFor ? await this.o.prefsFor(n.accountId) : noticePrefs({});
        if (!prefs[n.kind]) { this.stats.switchedOff++; return this.remember(n.id); }
        const to = await this.o.recipient(n.accountId);
        if (!to || typeof to.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.email)) { this.stats.noRecipient++; return this.remember(n.id); }
        if (!this.underCap(n.accountId)) { this.stats.rateLimited++; return this.remember(n.id); }
        const result = await this.o.send(n, to);
        if (result === "exists") this.stats.alreadySent++;
        else { this.stats.sent++; this.stats.lastSentAt = this.clock(); this.sentAt.get(n.accountId)!.push(this.clock()); }
        return this.remember(n.id);
      } catch (raw) {
        // The address is never part of the message we keep: only the error text of the sender.
        const error = raw instanceof Error ? raw : new Error(String(raw));
        this.stats.lastError = error.message;
        this.o.onError?.(error, { noticeId: n.id, attempt });
        if (attempt > this.delays.length) {
          this.failures.set(n.id, { id: n.id, accountId: n.accountId, kind: n.kind, reason: "send_failed", at: this.clock(), notice: n });
          const max = this.o.maxFailures ?? 200;
          while (this.failures.size > max) this.failures.delete(this.failures.keys().next().value as string);
          return;
        }
        await this.sleep(this.delays[attempt - 1]);
      }
    }
  }

  private remember(id: string) {
    this.done.add(id);
    const max = this.o.rememberIds ?? 5000;
    while (this.done.size > max) this.done.delete(this.done.values().next().value as string);
  }
}

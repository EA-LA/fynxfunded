import type { AccountState, CloseReason, Deal, EngineEvent, OrderRequest, PendingOrder, Position, PriceAlert } from "./types";

/**
 * Account journal: a plain-language record of everything the engine did on an
 * account, newest first, stored in the account itself (`state.journal`) in the
 * same save as the change it describes, so it can never disagree with the
 * account. Like MT5's "Journal" tab, it answers support questions such as
 * "why was my order refused?" or "what closed my trade at 3 am?":
 *  - orders placed, changed, cancelled, expired or cancelled by their OCO partner;
 *  - fills, closes (with the reason and the result), partial closes, swaps;
 *  - stop loss / take profit changes and trailing-stop moves;
 *  - loss-limit locks, close-to-limit warnings, profit target, day resets;
 *  - price alerts and notice choices;
 *  - orders and changes the engine REFUSED, with its reason (nothing else
 *    about the account changes when that is recorded).
 *
 * Pure functions only; the LocalVenue appends entries (venue.ts) and the
 * terminal shows them (Journal tab). At most JOURNAL_KEPT entries are kept.
 */

export type JournalKind = "order" | "trade" | "change" | "cancel" | "refused" | "rule" | "alert" | "account";

export interface JournalEntry {
  /** Milliseconds (engine clock). */
  at: number;
  kind: JournalKind;
  /** One plain sentence (at most JOURNAL_TEXT_MAX characters). */
  text: string;
  symbol?: string;
  /** Engine error code, for refusals. */
  code?: string;
  /** The order or position the entry is about. */
  ref?: string;
}

export const JOURNAL_KEPT = 150;
export const JOURNAL_TEXT_MAX = 300;
export const JOURNAL_KINDS: readonly JournalKind[] = ["order", "trade", "change", "cancel", "refused", "rule", "alert", "account"];

/** Commands the engine can refuse; refusals of these are journaled. */
export type JournalCommand =
  | { type: "place"; order: OrderRequest }
  | { type: "close"; positionId: string; lots?: number }
  | { type: "reverse"; positionId: string }
  | { type: "modify"; positionId: string }
  | { type: "modifyOrder"; orderId: string }
  | { type: "cancel"; orderId: string };

/** Error codes that say nothing about the trader's request (missing account, storage race): never journaled. */
const NOT_JOURNALED = new Set(["no_account", "conflict", "bad_state", "state_too_large"]);

type Digits = (symbol: string) => number;
const defaultDigits: Digits = s => (s.endsWith("JPY") ? 3 : 5);

const cap = (t: string) => (t.length > JOURNAL_TEXT_MAX ? `${t.slice(0, JOURNAL_TEXT_MAX - 1)}…` : t);
const lots = (n: number) => n.toFixed(2);
export const journalMoney = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plainMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const REASONS: Record<CloseReason, string> = {
  manual: "closed by you",
  stop_loss: "stop loss hit",
  take_profit: "take profit hit",
  daily_loss_limit: "daily loss limit reached",
  maximum_loss_limit: "maximum loss limit reached",
  target_reached: "profit target reached",
  weekend_close: "closed before the market's weekend close (account rule)",
  stop_out: "margin stop out",
};
export const closeReasonText = (r: CloseReason) => REASONS[r] ?? r;

function levels(o: { stopLoss?: number; takeProfit?: number; trailingPips?: number; expiresAt?: number; ocoWith?: string }, symbol: string, d: Digits, withNone = false): string {
  const p = (n: number) => n.toFixed(d(symbol));
  const parts: string[] = [];
  if (o.stopLoss !== undefined) parts.push(`SL ${p(o.stopLoss)}`); else if (withNone) parts.push("no SL");
  if (o.takeProfit !== undefined) parts.push(`TP ${p(o.takeProfit)}`); else if (withNone) parts.push("no TP");
  if (o.trailingPips !== undefined) parts.push(`trailing ${o.trailingPips} pips`);
  if (o.expiresAt !== undefined) parts.push(`expires ${utc(o.expiresAt)}`);
  if (o.ocoWith) parts.push(`linked (OCO) with #${o.ocoWith}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}
const orderName = (o: Pick<PendingOrder, "side" | "type" | "lots" | "symbol" | "price">, d: Digits) => `${o.side} ${o.type} ${lots(o.lots)} ${o.symbol} at ${o.price.toFixed(d(o.symbol))}`;
const positionName = (p: Pick<Position, "side" | "lots" | "symbol">) => `${p.side} ${lots(p.lots)} ${p.symbol}`;
const alertName = (a: PriceAlert, d: Digits) => `${a.symbol} bid ${a.condition === "above" ? "at or above" : "at or below"} ${a.price.toFixed(d(a.symbol))}`;
const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Journal entries for the events of one engine step. `before` and `after` are
 * the account around the step (used to name orders/positions that events
 * only refer to by id); `at` is the engine clock.
 */
export function journalFor(events: EngineEvent[], before: AccountState, after: AccountState, at: number, digits: Digits = defaultDigits): JournalEntry[] {
  const out: JournalEntry[] = [];
  const findOrder = (id: string) => before.orders.find(o => o.id === id) ?? after.orders.find(o => o.id === id);
  const findPosition = (id: string) => after.positions.find(p => p.id === id) ?? before.positions.find(p => p.id === id);
  const triggered = new Map<string, string>();
  for (const e of events) if (e.type === "order_triggered") triggered.set(e.positionId, e.orderId);
  const push = (kind: JournalKind, text: string, symbol?: string, ref?: string) => out.push({ at, kind, text: cap(text), ...(symbol ? { symbol } : {}), ...(ref ? { ref } : {}) });

  for (const e of events) {
    switch (e.type) {
      case "position_opened": {
        const p = e.position, from = triggered.get(p.id), order = from ? findOrder(from) : undefined;
        const lead = from ? `${upper(order ? `${order.side} ${order.type}` : "pending order")} #${from} filled: opened` : "Opened";
        push("trade", `${lead} ${positionName(p)} at ${p.entryPrice.toFixed(digits(p.symbol))}${levels(p, p.symbol, digits)}, position #${p.id}.`, p.symbol, p.id);
        break;
      }
      case "order_triggered": break; // described with the position it opened
      case "order_placed":
        push("order", `Placed ${orderName(e.order, digits)}${levels(e.order, e.order.symbol, digits)}, order #${e.order.id}.`, e.order.symbol, e.order.id);
        break;
      case "order_modified":
        push("change", `Changed order #${e.order.id}: ${orderName(e.order, digits)}${levels(e.order, e.order.symbol, digits, true)}.`, e.order.symbol, e.order.id);
        break;
      case "order_cancelled": {
        const id = e.orderId, oco = e.reason === "oco", o = e.order ?? findOrder(id);
        const name = o ? orderName(o, digits) : `order #${id}`;
        push("cancel", oco ? `${upper(name)} (#${id}) cancelled: its linked (OCO) order filled.` : `Cancelled ${name} (#${id}).`, o?.symbol, id);
        break;
      }
      case "order_expired":
        push("cancel", `${upper(orderName(e.order, digits))} (#${e.order.id}) expired at ${utc(e.order.expiresAt)} without filling.`, e.order.symbol, e.order.id);
        break;
      case "position_modified": {
        const p = findPosition(e.positionId);
        push("change", p ? `Changed position #${p.id} ${positionName(p)}${levels(p, p.symbol, digits, true)}.` : `Changed position #${e.positionId}.`, p?.symbol, e.positionId);
        break;
      }
      case "stop_trailed": {
        const p = findPosition(e.positionId);
        const text = `Trailing stop moved the stop loss of #${e.positionId}${p ? ` ${positionName(p)}` : ""} to ${e.stopLoss.toFixed(digits(p?.symbol ?? ""))}.`;
        push("change", text, p?.symbol, e.positionId);
        break;
      }
      case "position_closed": {
        const d: Deal = e.deal, left = after.positions.find(p => p.id === d.positionId);
        const what = left ? `Closed ${lots(d.lots)} of ${lots(d.lots + left.lots)} lots of #${d.positionId} ${d.side} ${d.symbol}` : `Closed #${d.positionId} ${d.side} ${lots(d.lots)} ${d.symbol}`;
        push("trade", `${what} at ${d.exitPrice.toFixed(digits(d.symbol))} (opened at ${d.entryPrice.toFixed(digits(d.symbol))}): ${journalMoney(d.netProfit)} net, ${closeReasonText(d.reason)}.`, d.symbol, d.positionId);
        break;
      }
      case "account_breached":
        push("rule", `Account locked: ${closeReasonText(e.reason)}. Open trades were closed and pending orders removed; no new trades on this account.`);
        break;
      case "target_reached":
        push("account", "Profit target reached with the minimum trading days. This is not the official result: FYNX Funded reviews it.");
        break;
      case "day_reset":
        push("account", `New trading day ${e.tradingDay}: the daily loss limit restarts from a balance of ${plainMoney(e.dayStartBalance)}.`);
        break;
      case "alert_added":
        push("alert", `Price alert set: ${alertName(e.alert, digits)}.`, e.alert.symbol, e.alert.id);
        break;
      case "alert_removed": {
        const a = before.alerts?.find(x => x.id === e.alertId);
        push("alert", a ? `Price alert removed: ${alertName(a, digits)}.` : `Price alert #${e.alertId} removed.`, a?.symbol, e.alertId);
        break;
      }
      case "alert_triggered":
        push("alert", `Price alert fired: ${e.alert.symbol} bid ${e.alert.triggerPrice.toFixed(digits(e.alert.symbol))} (${alertName(e.alert, digits)}). Alerts never trade.`, e.alert.symbol, e.alert.id);
        break;
      case "notices_changed": {
        const on = Object.entries(e.notices).filter(([, v]) => v).map(([k]) => k);
        push("account", `Notice choices changed: ${on.length ? `on for ${on.join(", ")}` : "all off"}${e.nearLimitPercent !== undefined ? `; close-to-limit warning at ${e.nearLimitPercent}% left` : ""}.`);
        break;
      }
      case "limit_near":
        push("rule", `Close to the ${e.warning.limit} loss limit: ${plainMoney(e.warning.room)} left (${e.warning.roomPercent}% of the allowance), equity ${plainMoney(e.warning.equity)}, limit level ${plainMoney(e.warning.floor)}.`);
        break;
      case "swap_applied": {
        const p = findPosition(e.positionId);
        push("trade", `Swap ${journalMoney(e.amount)} for ${e.nights} night${e.nights === 1 ? "" : "s"} on #${e.positionId}${p ? ` ${positionName(p)}` : ""}.`, p?.symbol, e.positionId);
        break;
      }
    }
  }
  return out;
}

/** The journal entry for a command the engine refused, or null for errors that are not about the request. */
export function refusalEntry(command: JournalCommand, error: { code: string; message: string }, state: AccountState, at: number, digits: Digits = defaultDigits): JournalEntry | null {
  if (NOT_JOURNALED.has(error.code)) return null;
  let what: string, symbol: string | undefined, ref: string | undefined;
  if (command.type === "place") {
    const o = command.order;
    const sym = typeof o.symbol === "string" ? o.symbol : "?";
    const price = o.type !== "market" && typeof o.price === "number" && Number.isFinite(o.price) ? ` at ${o.price.toFixed(digits(sym))}` : "";
    what = `${o.side} ${o.type} ${typeof o.lots === "number" && Number.isFinite(o.lots) ? lots(o.lots) : "?"} ${sym}${price}`;
    symbol = /^[A-Z]{6}$/.test(sym) ? sym : undefined;
  } else if (command.type === "close" || command.type === "modify" || command.type === "reverse") {
    const p = state.positions.find(x => x.id === command.positionId);
    what = `${command.type === "close" ? (command.lots !== undefined ? `closing ${lots(command.lots)} lots of` : "closing") : command.type === "reverse" ? "reversing" : "changing"} position #${command.positionId}${p ? ` ${positionName(p)}` : ""}`;
    symbol = p?.symbol; ref = command.positionId;
  } else {
    const o = state.orders.find(x => x.id === command.orderId);
    what = `${command.type === "cancel" ? "cancelling" : "changing"} order #${command.orderId}${o ? ` ${orderName(o, digits)}` : ""}`;
    symbol = o?.symbol; ref = command.orderId;
  }
  return { at, kind: "refused", text: cap(`Refused ${what}: ${error.message}`), code: error.code, ...(symbol ? { symbol } : {}), ...(ref ? { ref } : {}) };
}

/**
 * Adds entries (in the order they happened) to the account's journal, newest
 * first, keeping JOURNAL_KEPT. A trailing-stop move replaces the previous one
 * for the same position when nothing else was recorded in between, so a stop
 * that follows the price all day is one line, not hundreds.
 * Returns the same object when there is nothing to add.
 */
export function appendJournal(state: AccountState, entries: JournalEntry[]): AccountState {
  if (!entries.length) return state;
  let journal = [...(state.journal ?? [])];
  for (const entry of entries) {
    const top = journal[0];
    const trail = (e: JournalEntry | undefined) => !!e && e.kind === "change" && e.text.startsWith("Trailing stop moved");
    if (trail(entry) && trail(top) && top.ref === entry.ref) journal[0] = entry;
    else journal.unshift(entry);
  }
  if (journal.length > JOURNAL_KEPT) journal = journal.slice(0, JOURNAL_KEPT);
  return { ...state, journal };
}

/** Checks one stored or received journal entry (the terminal drops malformed ones). */
export function validJournalEntry(v: unknown): v is JournalEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.at === "number" && Number.isFinite(e.at) && typeof e.kind === "string" && (JOURNAL_KINDS as readonly string[]).includes(e.kind)
    && typeof e.text === "string" && e.text.length > 0 && e.text.length <= JOURNAL_TEXT_MAX
    && (e.symbol === undefined || typeof e.symbol === "string") && (e.code === undefined || typeof e.code === "string") && (e.ref === undefined || typeof e.ref === "string");
}

/**
 * Restricted news windows ("no new trades around high-impact releases").
 *
 * FYNX Funded's rules page says news-trading permissions and restricted
 * release windows are set by the purchased agreement. This file makes the
 * engine ready for that rule without deciding it:
 *
 *  - the owner keeps a calendar of releases in the Firestore document
 *    `engineControl/news` (read every 60 s, no redeploy):
 *
 *      {
 *        enforce: false,            // true = refuse new orders in the windows
 *        beforeMinutes: 2,          // default window around every release
 *        afterMinutes: 2,
 *        events: [
 *          { title: "US non-farm payrolls", at: "2026-12-04T13:30:00Z", currencies: ["USD"] },
 *          { title: "ECB rate decision", at: "2026-12-10T13:15:00Z", currencies: "EUR", beforeMinutes: 5, afterMinutes: 5 }
 *        ]
 *      }
 *
 *    The release times come from the economic calendar the owner licenses or
 *    copies by hand; nothing here invents one.
 *  - With `enforce: false` (or no `enforce`) the windows are information only:
 *    GET /v1/status lists them and the terminal shows them, nothing is refused.
 *  - With `enforce: true`, inside a window new orders (market and pending) on
 *    every pair that contains a listed currency are refused with
 *    `news_window`, and so is moving a pending order's price. Closing trades,
 *    cancelling orders, changing stop loss / take profit, price alerts and the
 *    timer step (stops, targets, loss limits, pending fills) keep working:
 *    the rule never stops a trader from reducing risk.
 *
 * Fail-safe reading: an `enforce` that is neither true nor false enforces; an
 * event that cannot be read is dropped and named in `problems`; a failed read
 * keeps the last calendar. Pure apart from the clock and the injected reader;
 * no imports from Firebase.
 */

import { readTime, type DocReader } from "./trading-pause";

export interface NewsWindow {
  /** Stable id (the document's `id`, or time + currencies). */
  id: string;
  /** Plain name of the release, at most 80 characters. */
  title: string;
  /** Release time (ms, UTC). */
  at: number;
  /** Window start and end (ms, UTC): `at` minus the minutes before, plus the minutes after. */
  from: number;
  to: number;
  /** Three-letter currency codes; every pair containing one of them is affected. */
  currencies: string[];
}

export interface NewsState {
  /** true = new orders are refused inside the windows; false = information only. */
  enforce: boolean;
  windows: NewsWindow[];
}

export interface NewsReading {
  state: NewsState;
  /** What was not understood (the event was dropped, or the safe choice was taken). */
  problems: string[];
}

export const NEWS_CONTROL_DOC = { collection: "engineControl", id: "news" } as const;
export const NEWS_DEFAULT_MINUTES = 2;
export const NEWS_MAX_MINUTES = 120;
export const NEWS_MAX_EVENTS = 1000;
export const NEWS_TITLE_MAX = 80;
/** How far ahead GET /v1/status lists windows (7 days) and how many at most. */
export const NEWS_STATUS_DAYS = 7;
export const NEWS_STATUS_MAX = 200;

const EMPTY: NewsState = { enforce: false, windows: [] };

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > NEWS_TITLE_MAX ? `${t.slice(0, NEWS_TITLE_MAX - 1).trimEnd()}…` : t;
}

function readCurrencies(raw: unknown): string[] | null {
  const list = typeof raw === "string" ? raw.split(/[\s,]+/) : Array.isArray(raw) ? raw : null;
  if (!list) return null;
  const out: string[] = [];
  for (const c of list) {
    if (c === "") continue;
    if (typeof c !== "string" || !/^[A-Za-z]{3}$/.test(c.trim())) return null;
    const code = c.trim().toUpperCase();
    if (!out.includes(code)) out.push(code);
  }
  return out.length && out.length <= 20 ? out : null;
}

function readMinutes(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null) return fallback;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= NEWS_MAX_MINUTES ? raw : null;
}

/**
 * Reads the calendar document. Missing document → no windows. Windows that
 * ended before `now` are left out. Overlapping windows are all kept.
 */
export function readNewsDocument(data: Record<string, unknown> | undefined | null, now: number): NewsReading {
  const problems: string[] = [];
  if (!data) return { state: EMPTY, problems };
  const flag = data.enforce;
  let enforce = false;
  if (flag === true || flag === "true") enforce = true;
  else if (!(flag === false || flag === "false" || flag === undefined || flag === null)) {
    enforce = true;
    problems.push(`"enforce" should be true or false (got ${JSON.stringify(flag)?.slice(0, 40)}); new orders are refused in the windows until it is fixed.`);
  }
  const before = readMinutes(data.beforeMinutes, NEWS_DEFAULT_MINUTES);
  const after = readMinutes(data.afterMinutes, NEWS_DEFAULT_MINUTES);
  if (before === null) problems.push(`"beforeMinutes" should be a whole number from 0 to ${NEWS_MAX_MINUTES}; ${NEWS_DEFAULT_MINUTES} is used.`);
  if (after === null) problems.push(`"afterMinutes" should be a whole number from 0 to ${NEWS_MAX_MINUTES}; ${NEWS_DEFAULT_MINUTES} is used.`);
  const defBefore = before ?? NEWS_DEFAULT_MINUTES, defAfter = after ?? NEWS_DEFAULT_MINUTES;
  const raw = data.events;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) problems.push('"events" should be a list.');
  const events = Array.isArray(raw) ? raw : [];
  if (events.length > NEWS_MAX_EVENTS) problems.push(`Only the first ${NEWS_MAX_EVENTS} of ${events.length} events are read.`);
  const windows: NewsWindow[] = [];
  const ids = new Set<string>();
  events.slice(0, NEWS_MAX_EVENTS).forEach((e, i) => {
    const n = i + 1;
    if (typeof e !== "object" || e === null || Array.isArray(e)) { problems.push(`Event ${n} is not an object; skipped.`); return; }
    const r = e as Record<string, unknown>;
    const title = cleanTitle(r.title);
    const at = readTime(r.at);
    const currencies = readCurrencies(r.currencies);
    const b = readMinutes(r.beforeMinutes, defBefore), a = readMinutes(r.afterMinutes, defAfter);
    const label = title ? `Event ${n} ("${title}")` : `Event ${n}`;
    if (!title) { problems.push(`${label} has no title; skipped.`); return; }
    if (at === null || at === "bad") { problems.push(`${label} has no readable "at" time (use an ISO time like 2026-12-04T13:30:00Z); skipped.`); return; }
    if (!currencies) { problems.push(`${label} needs "currencies" as three-letter codes, e.g. ["USD"]; skipped.`); return; }
    if (b === null || a === null) { problems.push(`${label} has minutes outside 0 to ${NEWS_MAX_MINUTES}; skipped.`); return; }
    const to = at + a * 60_000;
    if (to <= now) return;
    let id = typeof r.id === "string" && /^[A-Za-z0-9_:.-]{1,80}$/.test(r.id) ? r.id : `${new Date(at).toISOString().slice(0, 16)}-${currencies.join("")}`;
    if (ids.has(id)) { let k = 2; while (ids.has(`${id}-${k}`)) k += 1; id = `${id}-${k}`; }
    ids.add(id);
    windows.push({ id, title, at, from: at - b * 60_000, to, currencies });
  });
  windows.sort((x, y) => x.from - y.from || x.at - y.at || x.id.localeCompare(y.id));
  return { state: { enforce, windows }, problems };
}

/** Whether a window touches the pair (its base or quote currency is listed). */
export const affects = (w: Pick<NewsWindow, "currencies">, pair: { base: string; quote: string }) =>
  w.currencies.includes(pair.base) || w.currencies.includes(pair.quote);

/** The window in force for this pair now (the one ending last when several overlap), or null. */
export function activeNewsWindow(windows: readonly NewsWindow[], pair: { base: string; quote: string }, now: number): NewsWindow | null {
  let best: NewsWindow | null = null;
  for (const w of windows) if (w.from <= now && now < w.to && affects(w, pair) && (!best || w.to > best.to)) best = w;
  return best;
}

const utc = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** The sentence a trader gets when an order is refused inside a window. */
export function newsWindowMessage(w: Pick<NewsWindow, "title" | "at" | "to" | "currencies">, symbol: string): string {
  return `New ${symbol} orders are paused around a high-impact release: ${w.title} (${w.currencies.join(", ")}) at ${utc(w.at)} UTC. Trading on this pair reopens at ${utc(w.to)} UTC. Nothing was sent; closing trades, cancelling orders and changing stop loss or take profit still work.`;
}

/** What GET /v1/status carries: the rule and the windows from now to `days` ahead (active ones included). */
export function newsStatus(state: NewsState, now: number, days = NEWS_STATUS_DAYS): NewsState {
  const end = now + days * 86_400_000;
  return { enforce: state.enforce, windows: state.windows.filter(w => w.to > now && w.from < end).slice(0, NEWS_STATUS_MAX) };
}

export interface NewsHealth {
  enforce: boolean;
  /** Windows still to come or in force now. */
  windows: number;
  /** Windows in force right now. */
  activeNow: number;
  lastReadAt: number | null;
  readFailures: number;
  problems: string[];
}

export interface NewsCalendarOptions {
  /** The calendar document, e.g. `db.collection("engineControl").doc("news")`. */
  control?: DocReader;
  /** Start with this calendar (tests, or a host that loads it elsewhere). */
  initial?: NewsState;
  /** How often the document is read (default 60 000 ms, at least 1000). */
  everyMs?: number;
  /** Called when the rule or the list of windows changes after a read. */
  onChange?: (state: NewsState, problems: string[]) => void;
  onError?: (e: unknown, failuresInARow: number) => void;
  clock?: () => number;
}

const sameState = (a: NewsState, b: NewsState) =>
  a.enforce === b.enforce && a.windows.length === b.windows.length && a.windows.every((w, i) => {
    const v = b.windows[i];
    return w.id === v.id && w.from === v.from && w.to === v.to && w.title === v.title && w.currencies.join() === v.currencies.join();
  });

export class NewsCalendar {
  private state: NewsState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading: Promise<void> | null = null;
  private lastReadAt: number | null = null;
  private failures = 0;
  private problems: string[] = [];
  private readonly clock: () => number;

  constructor(private readonly o: NewsCalendarOptions = {}) {
    this.clock = o.clock ?? Date.now;
    this.state = o.initial ?? EMPTY;
  }

  /** The rule and the windows not yet over. */
  current(): NewsState {
    const now = this.clock();
    return { enforce: this.state.enforce, windows: this.state.windows.filter(w => w.to > now) };
  }

  /** Replaces the calendar from code (tests, an admin tool). */
  set(state: NewsState): void { this.state = { enforce: state.enforce, windows: [...state.windows].sort((x, y) => x.from - y.from) }; }

  /** Reads the document once (no-op without one). Never throws. */
  refresh(): Promise<void> {
    if (!this.o.control) return Promise.resolve();
    this.reading ??= (async () => {
      try {
        const snap = await this.o.control!.get();
        const now = this.clock();
        const r = readNewsDocument(snap.exists ? snap.data() : undefined, now);
        const changed = !sameState(r.state, this.state) || r.problems.join("|") !== this.problems.join("|");
        this.state = r.state;
        this.problems = r.problems;
        this.lastReadAt = now;
        this.failures = 0;
        if (changed) this.o.onChange?.(this.current(), [...r.problems]);
      } catch (e) {
        this.failures += 1;
        this.o.onError?.(e, this.failures);
      } finally {
        this.reading = null;
      }
    })();
    return this.reading;
  }

  /** Reads the document now and then every `everyMs`. */
  start(): Promise<void> {
    if (!this.o.control) return Promise.resolve();
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh(); }, Math.max(1000, this.o.everyMs ?? 60_000));
      (this.timer as { unref?: () => void }).unref?.();
    }
    return this.refresh();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  health(): NewsHealth {
    const s = this.current(), now = this.clock();
    return { enforce: s.enforce, windows: s.windows.length, activeNow: s.windows.filter(w => w.from <= now).length, lastReadAt: this.lastReadAt, readFailures: this.failures, problems: [...this.problems] };
  }
}

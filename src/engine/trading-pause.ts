/**
 * The owner's "pause new trading" switch for the whole trading server
 * (often called close-only mode at brokers).
 *
 * When something is wrong outside the engine — the liquidity provider has an
 * outage, the price provider sends doubtful prices, a big news event — the
 * owner can stop every trader from opening or changing orders at once,
 * without a redeploy and without touching any account:
 *
 *  - in the Firebase console, document `engineControl/trading`:
 *    `{ paused: true, reason: "Our price provider has an outage.", until: "2026-12-01T12:00:00Z" }`
 *    (the host reads it every 10 s; set `paused` to false or delete the
 *    document to resume; `until` and `reason` are optional);
 *  - or, from the start, the setting FYNX_ENGINE_PAUSE="reason text"
 *    (stays paused until the setting is removed and the host restarted).
 *
 * While paused: new orders, and changes to orders and positions, are refused
 * with `trading_paused` (HTTP 503) and nothing is recorded. Closing positions,
 * cancelling orders, price alerts and notice choices keep working, and the
 * timer step keeps checking stops, targets and loss limits. Pending orders
 * already waiting still fill at their price, unless the document also says
 * `holdPending: true`: then they wait in the book until the pause ends, and
 * the first fresh price after it decides the fill (a limit at its price or
 * better, a stop at the market, like after a weekend gap). Expiry still
 * applies; traders can cancel them at any time.
 * GET /v1/status carries `paused` so the terminal can say so before a trader
 * clicks.
 *
 * Fail-safe reading: a document that says anything but a clear "not paused"
 * pauses. A failed read keeps the last known state. Pure apart from the clock
 * and the injected document reader; no imports from Firebase.
 */

export interface TradingPauseState {
  /** Plain sentence shown to traders (at most 200 characters). */
  reason: string;
  /** When the pause began (ms, UTC). */
  since: number;
  /** When it ends by itself (ms, UTC), or null until the owner lifts it. */
  until: number | null;
  /** Where it came from: the FYNX_ENGINE_PAUSE setting, the control document, or code. */
  source: "settings" | "control" | "code";
  /** true = pending orders already waiting do not fill during the pause either. */
  holdPending?: boolean;
}

export const PAUSE_REASON_MAX = 200;
export const DEFAULT_PAUSE_REASON = "FYNX is running a short check of the trading service.";
export const PAUSE_CONTROL_DOC = { collection: "engineControl", id: "trading" } as const;
export const PAUSE_ENV = "FYNX_ENGINE_PAUSE";

/** Removes control characters and extra spaces, keeps at most 200 characters; empty → default. */
export function cleanReason(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_PAUSE_REASON;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return DEFAULT_PAUSE_REASON;
  return text.length > PAUSE_REASON_MAX ? `${text.slice(0, PAUSE_REASON_MAX - 1).trimEnd()}…` : text;
}

/** A time from a document: milliseconds, an ISO text, a JavaScript Date or a Firestore Timestamp (`toMillis`). */
export function readTime(v: unknown): number | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  let ms: number;
  if (typeof v === "number") ms = v;
  else if (typeof v === "string") ms = /^\d{4}-\d{2}-\d{2}T/.test(v.trim()) ? Date.parse(v.trim()) : NaN;
  else if (v instanceof Date) ms = v.getTime();
  else if (typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") ms = Number((v as { toMillis(): number }).toMillis());
  else return "bad";
  return Number.isFinite(ms) && ms > 0 ? ms : "bad";
}

export interface PauseReading {
  state: TradingPauseState | null;
  /** Something in the document was not understood (the safe choice was taken). */
  problems: string[];
}

/**
 * Reads the control document. Missing document, `paused: false` (or "false")
 * → not paused. `paused: true` (or "true") → paused. Anything else in
 * `paused` → paused, because a switch that cannot be read must not let trading
 * continue. A passed `until` → not paused (the pause ended by itself); an
 * unreadable `until` is ignored (paused until lifted).
 */
export function readPauseDocument(data: Record<string, unknown> | undefined | null, now: number): PauseReading {
  const problems: string[] = [];
  if (!data) return { state: null, problems };
  const flag = data.paused;
  if (flag === false || flag === "false" || flag === undefined || flag === null) return { state: null, problems };
  if (flag !== true && flag !== "true") problems.push(`"paused" should be true or false (got ${JSON.stringify(flag)?.slice(0, 40)}); treated as paused.`);
  if (data.reason !== undefined && typeof data.reason !== "string") problems.push('"reason" should be text; the standard sentence is shown.');
  const rawUntil = readTime(data.until);
  if (rawUntil === "bad") problems.push('"until" is not a time (use an ISO time like 2026-12-01T12:00:00Z or a timestamp); paused until lifted.');
  const until = rawUntil === "bad" ? null : rawUntil;
  if (until !== null && until <= now) return { state: null, problems };
  const rawSince = readTime(data.since);
  const since = rawSince === "bad" || rawSince === null || rawSince > now ? now : rawSince;
  const hold = data.holdPending;
  let holdPending = false;
  if (hold === true || hold === "true") holdPending = true;
  else if (!(hold === false || hold === "false" || hold === undefined || hold === null)) {
    holdPending = true;
    problems.push(`"holdPending" should be true or false (got ${JSON.stringify(hold)?.slice(0, 40)}); waiting pending orders are held during the pause.`);
  }
  return { state: { reason: cleanReason(data.reason), since, until, source: "control", ...(holdPending ? { holdPending } : {}) }, problems };
}

/** The FYNX_ENGINE_PAUSE setting: empty/missing/"false"/"off" → not paused; "true"/"on" → standard sentence; other text → that sentence. */
export function readPauseSetting(raw: string | undefined, now: number): TradingPauseState | null {
  const v = raw?.trim();
  if (!v || /^(false|off|0|no)$/i.test(v)) return null;
  return { reason: /^(true|on|1|yes)$/i.test(v) ? DEFAULT_PAUSE_REASON : cleanReason(v), since: now, until: null, source: "settings" };
}

export interface PauseHealth {
  paused: boolean;
  /** Waiting pending orders are held too. */
  holdPending: boolean;
  source: TradingPauseState["source"] | null;
  reason: string | null;
  until: number | null;
  /** Last successful read of the control document (ms), or null. */
  lastReadAt: number | null;
  /** Failed reads in a row (the last known state is kept meanwhile). */
  readFailures: number;
  /** What was not understood in the control document at the last read. */
  problems: string[];
}

export interface DocReader { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> }

export interface TradingPauseOptions {
  /** Start paused (e.g. from readPauseSetting); this pause lasts until the process restarts. */
  initial?: TradingPauseState | null;
  /** The control document, e.g. `db.collection("engineControl").doc("trading")`. */
  control?: DocReader;
  /** How often the control document is read (default 10 000 ms, at least 1000). */
  everyMs?: number;
  /** Called when the pause starts, changes its reason/end, or ends. */
  onChange?: (state: TradingPauseState | null) => void;
  /** A read failed (state kept). */
  onError?: (e: unknown, failuresInARow: number) => void;
  clock?: () => number;
}

const same = (a: TradingPauseState | null, b: TradingPauseState | null) =>
  a === b || (!!a && !!b && a.reason === b.reason && a.until === b.until && a.source === b.source && !!a.holdPending === !!b.holdPending);

export class TradingPause {
  private settings: TradingPauseState | null;
  private control: TradingPauseState | null = null;
  private manual: TradingPauseState | null = null;
  private last: TradingPauseState | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading: Promise<void> | null = null;
  private lastReadAt: number | null = null;
  private failures = 0;
  private problems: string[] = [];
  private readonly clock: () => number;

  constructor(private readonly o: TradingPauseOptions = {}) {
    this.clock = o.clock ?? Date.now;
    this.settings = o.initial ?? null;
    this.last = this.settings;
  }

  /** The pause in force now, or null. A pause whose `until` has passed is over. */
  current(): TradingPauseState | null {
    const now = this.clock();
    const live = (s: TradingPauseState | null) => (s && (s.until === null || s.until > now) ? s : null);
    const state = live(this.settings) ?? live(this.manual) ?? live(this.control);
    if (!same(state, this.last)) { this.last = state; this.o.onChange?.(state); }
    return state;
  }

  /** Pause from code (tests, an admin tool). `until` in ms or null; `holdPending` also holds waiting pending orders. */
  pause(reason: string, until: number | null = null, holdPending = false): void {
    this.manual = { reason: cleanReason(reason), since: this.clock(), until, source: "code", ...(holdPending ? { holdPending } : {}) };
    this.current();
  }

  /** Lifts a pause set with `pause()`. The setting and the control document are not affected. */
  resume(): void { this.manual = null; this.current(); }

  /** Reads the control document once (no-op without one). Never throws. */
  refresh(): Promise<void> {
    if (!this.o.control) return Promise.resolve();
    this.reading ??= (async () => {
      try {
        const snap = await this.o.control!.get();
        const now = this.clock();
        const r = readPauseDocument(snap.exists ? snap.data() : undefined, now);
        // A pause that continues keeps its start time (unless the document gives one).
        if (r.state && this.control && r.state.since === now) r.state.since = this.control.since;
        this.control = r.state;
        this.problems = r.problems;
        this.lastReadAt = now;
        this.failures = 0;
      } catch (e) {
        this.failures += 1;
        this.o.onError?.(e, this.failures);
      } finally {
        this.reading = null;
      }
      this.current();
    })();
    return this.reading;
  }

  /** Reads the control document now and then every `everyMs`. */
  start(): Promise<void> {
    if (!this.o.control) return Promise.resolve();
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh(); }, Math.max(1000, this.o.everyMs ?? 10_000));
      (this.timer as { unref?: () => void }).unref?.();
    }
    return this.refresh();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  health(): PauseHealth {
    const s = this.current();
    return { paused: !!s, holdPending: !!s?.holdPending, source: s?.source ?? null, reason: s?.reason ?? null, until: s?.until ?? null, lastReadAt: this.lastReadAt, readFailures: this.failures, problems: [...this.problems] };
  }
}

/** The sentence traders get when an order or change is refused during a pause. */
export function pausedMessage(state: Pick<TradingPauseState, "reason" | "until">): string {
  const back = state.until ? ` Expected back by ${new Date(state.until).toISOString().slice(0, 16).replace("T", " ")} UTC.` : "";
  return `New trading is paused: ${state.reason}${back} No order was sent; closing trades and cancelling orders still work.`;
}

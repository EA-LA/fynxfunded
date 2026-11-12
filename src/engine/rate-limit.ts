import { EngineError } from "./types";

/**
 * Request limits for the engine's HTTP contract ("too many requests").
 *
 * A broken script, a stuck browser tab or someone hammering the server with a
 * valid sign-in could otherwise send hundreds of orders a second. Each signed-in
 * user gets three allowances (token buckets), refilled continuously:
 *
 *  - `trade`: opening an order, changing an order or position, price alerts,
 *    notice choices. Default 20 at once, then 2 per second (120 a minute).
 *  - `reduce`: closing a position, cancelling an order, deleting an alert.
 *    Kept much wider (100 at once, then 20 per second) because these only
 *    lower risk: "Close all" on many positions must never be slowed down.
 *  - `read`: every GET (account, status, history). 120 at once, 10 per second;
 *    the terminal reads about once every 2 seconds per open tab.
 *
 * A refused request is answered 429 `rate_limited` with `retryAfterSeconds`
 * and a `Retry-After` header, nothing is sent to the venue and nothing is
 * recorded, so the same request (same clientId) can simply be sent again.
 * Pure in-memory and per process; with several engine instances each one
 * counts separately.
 */

export type RequestClass = "trade" | "reduce" | "read";

export interface Bucket {
  /** Requests allowed at once (bucket size). */
  burst: number;
  /** Requests added back per second. */
  perSecond: number;
}

export type RateLimits = Record<RequestClass, Bucket>;

export const DEFAULT_RATE_LIMITS: RateLimits = {
  trade: { burst: 20, perSecond: 2 },
  reduce: { burst: 100, perSecond: 20 },
  read: { burst: 120, perSecond: 10 },
};

export const REQUEST_CLASSES: readonly RequestClass[] = ["trade", "reduce", "read"];

/** Most different users remembered before full (idle) allowances are forgotten. */
export const MAX_TRACKED_KEYS = 20_000;

/** Which allowance a request uses. Unknown addresses count as `trade` (the strictest). */
export function requestClass(method: string, path: string): RequestClass {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return "read";
  const p = path.split("?")[0].replace(/\/+$/, "");
  if (m === "POST" && /^\/v1\/accounts\/[^/]+\/positions\/[^/]+\/close$/.test(p)) return "reduce";
  if (m === "DELETE" && /^\/v1\/accounts\/[^/]+\/(orders|alerts)\/[^/]+$/.test(p)) return "reduce";
  return "trade";
}

/** Checks a full set of limits; throws `bad_settings` naming the wrong value. */
export function checkRateLimits(limits: RateLimits): RateLimits {
  for (const c of REQUEST_CLASSES) {
    const b = limits[c];
    if (!b || !Number.isFinite(b.burst) || !Number.isInteger(b.burst) || b.burst < 1 || b.burst > 10_000) throw new EngineError("bad_settings", `${c}: the number allowed at once must be a whole number from 1 to 10000.`);
    if (!Number.isFinite(b.perSecond) || b.perSecond <= 0 || b.perSecond > 1000) throw new EngineError("bad_settings", `${c}: the number added back per second must be above 0 and at most 1000.`);
  }
  if (limits.reduce.burst < limits.trade.burst || limits.reduce.perSecond < limits.trade.perSecond) {
    throw new EngineError("bad_settings", "Closing and cancelling (reduce) must be allowed at least as often as opening (trade), so a trader can always get out.");
  }
  return limits;
}

/**
 * Reads `FYNX_ENGINE_RATE_LIMITS`: empty → defaults; "off" → no limits;
 * otherwise "trade=20/2,reduce=100/20,read=120/10" (at once / per second),
 * any class left out keeps its default. Returns problems instead of throwing so
 * config.ts can list them with everything else.
 */
export function parseRateLimits(raw: string | undefined): { limits: RateLimits | false; problems: string[] } {
  const text = raw?.trim();
  if (!text) return { limits: DEFAULT_RATE_LIMITS, problems: [] };
  if (text.toLowerCase() === "off") return { limits: false, problems: [] };
  const limits: RateLimits = { trade: { ...DEFAULT_RATE_LIMITS.trade }, reduce: { ...DEFAULT_RATE_LIMITS.reduce }, read: { ...DEFAULT_RATE_LIMITS.read } };
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",").map(s => s.trim()).filter(Boolean)) {
    const m = /^(trade|reduce|read)=(\d{1,5})\/(\d{1,4}(?:\.\d{1,3})?)$/.exec(part);
    if (!m) { problems.push(`"${part}" should look like trade=20/2 (allowed at once / added back per second; classes trade, reduce, read).`); continue; }
    if (seen.has(m[1])) { problems.push(`${m[1]} is given twice.`); continue; }
    seen.add(m[1]);
    limits[m[1] as RequestClass] = { burst: Number(m[2]), perSecond: Number(m[3]) };
  }
  if (!problems.length) {
    try { checkRateLimits(limits); } catch (e) { problems.push((e as Error).message); }
  }
  return { limits, problems };
}

/** Plain description for the readiness check and logs. */
export function describeRateLimits(limits: RateLimits | false): string {
  if (!limits) return "No request limits (FYNX_ENGINE_RATE_LIMITS=off).";
  const one = (b: Bucket) => `${b.burst} at once, then ${b.perSecond}/s`;
  return `Per signed-in user: orders and changes ${one(limits.trade)}; closing and cancelling ${one(limits.reduce)}; reading ${one(limits.read)}.`;
}

export interface LimitResult {
  ok: boolean;
  /** When refused: whole seconds until one request is allowed again (at least 1). */
  retryAfterSeconds?: number;
}

export interface LimiterHealth {
  /** Requests refused since start, per class. */
  refused: Record<RequestClass, number>;
  /** When the last request was refused (ms since epoch), or null. */
  lastRefusedAt: number | null;
  /** Users currently remembered. */
  tracked: number;
}

interface State { tokens: number; at: number }

export class RequestLimiter {
  private readonly buckets = new Map<string, State>();
  private readonly refused: Record<RequestClass, number> = { trade: 0, reduce: 0, read: 0 };
  private lastRefusedAt: number | null = null;
  readonly limits: RateLimits;

  constructor(limits: RateLimits = DEFAULT_RATE_LIMITS, private readonly clock: () => number = Date.now, private readonly maxKeys = MAX_TRACKED_KEYS) {
    this.limits = checkRateLimits({ trade: { ...limits.trade }, reduce: { ...limits.reduce }, read: { ...limits.read } });
  }

  /** Takes one request from `key`'s allowance for `cls`. */
  take(key: string, cls: RequestClass): LimitResult {
    const now = this.clock();
    const { burst, perSecond } = this.limits[cls];
    const id = `${cls}\u0000${key}`;
    const prev = this.buckets.get(id);
    // A clock that goes backwards never adds requests.
    const elapsed = prev ? Math.max(0, now - prev.at) / 1000 : 0;
    const tokens = prev ? Math.min(burst, prev.tokens + elapsed * perSecond) : burst;
    if (tokens >= 1) {
      if (!prev && this.buckets.size >= this.maxKeys) this.forgetIdle(now);
      this.buckets.set(id, { tokens: tokens - 1, at: now });
      return { ok: true };
    }
    this.buckets.set(id, { tokens, at: now });
    this.refused[cls] += 1;
    this.lastRefusedAt = now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perSecond)) };
  }

  health(): LimiterHealth {
    return { refused: { ...this.refused }, lastRefusedAt: this.lastRefusedAt, tracked: this.buckets.size };
  }

  /** Drops allowances that have refilled completely (they behave exactly like a new user). */
  private forgetIdle(now: number) {
    for (const [id, s] of this.buckets) {
      const cls = id.slice(0, id.indexOf("\u0000")) as RequestClass;
      const { burst, perSecond } = this.limits[cls];
      if (s.tokens + Math.max(0, now - s.at) / 1000 * perSecond >= burst) this.buckets.delete(id);
    }
    // Still full of busy users (an attack with many accounts): drop the oldest.
    if (this.buckets.size >= this.maxKeys) {
      const drop = this.buckets.size - Math.floor(this.maxKeys * 0.9);
      let i = 0;
      for (const id of this.buckets.keys()) { if (i++ >= drop) break; this.buckets.delete(id); }
    }
  }
}

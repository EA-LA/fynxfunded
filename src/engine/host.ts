import type { LocalVenue, Snapshot } from "./venue";
import type { OrderChange, PositionChange } from "./core";
import type { AlertRequest, NoticeChange, OrderRequest } from "./types";
import { NEAR_LIMIT_MAX_PERCENT, NEAR_LIMIT_MIN_PERCENT, NOTICE_KINDS } from "./core";
import { EngineError } from "./types";
import { requestClass, type RequestLimiter } from "./rate-limit";
import { pausedMessage, type TradingPauseState } from "./trading-pause";

/**
 * Server-side skeleton for the HTTP contract in docs/ENGINE-READINESS.md.
 *
 * Framework-free: a host (Cloud Function, FYNX API, any Node server) turns its
 * incoming request into a HostRequest, calls handleEngineRequest, and writes
 * the HostResponse back as JSON. Nothing in the web app imports this file, so
 * it is not part of the site bundle and is not deployed anywhere by itself.
 *
 * Safety: every request needs a valid token for a user who owns the account,
 * and opening or changing orders also needs the account's tradingEnabled flag
 * (the same owner switch the terminal checks). Price alerts never trade and need no switch. Closing positions and
 * cancelling orders are always allowed because they only reduce risk.
 */

export interface HostRequest {
  method: string;
  /**
   * Path without the host, e.g. "/v1/accounts/acc_1/orders". A query string
   * on the path is read only by the history endpoint (`?chunk=n`).
   */
  path: string;
  /** Already-parsed query parameters (used instead of the path's query string when given). */
  query?: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  /** Parsed JSON body (undefined when there is none). */
  body?: unknown;
}

export interface HostResponse {
  status: number;
  body: unknown;
  /** Extra response headers (e.g. Retry-After on 429). */
  headers?: Record<string, string>;
}

export interface HostOptions {
  venue: LocalVenue;
  /** Verifies the bearer token (e.g. Firebase Admin verifyIdToken) and returns the user id, or null. */
  verifyToken: (token: string) => Promise<string | null>;
  /** Whether this user may see and trade this account. */
  canAccess: (userId: string, accountId: string) => Promise<boolean>;
  /** The owner's per-account switch. Until it returns true no order is opened or changed. */
  tradingEnabled: (accountId: string) => Promise<boolean>;
  /** What GET /v1/status reports. `markets` (open/closed per symbol), `instruments` (leverage, lot limits, commission, swap), `schedule` (open stretches and closures for the next 7 days) and `news` (restricted news windows for the next 7 days, when a calendar is connected) are added from the venue. */
  status: () => { priceFeed: boolean; execution: boolean; message: string; notices?: boolean };
  /**
   * Opens the engine account the first time its owner loads it (GET
   * /v1/accounts/{id}), with the balance and rules from `rulesFor`. Default
   * true: a purchased account works in the terminal without a separate setup
   * step. Opening places no order. Set false if accounts are created elsewhere.
   */
  openOnFirstVisit?: boolean;
  /**
   * Request limits per signed-in user (src/engine/rate-limit.ts). Checked right
   * after the sign-in, before anything reaches the venue; a refused request is
   * 429 `rate_limited` with `retryAfterSeconds` and changes nothing.
   */
  limiter?: RequestLimiter;
  /**
   * The owner's "pause new trading" switch for the whole server
   * (src/engine/trading-pause.ts). While it returns a pause, opening or
   * changing orders is refused with 503 `trading_paused`; closing, cancelling,
   * alerts and notices still work, and GET /v1/status carries `paused`.
   */
  pause?: () => TradingPauseState | null;
}

const STATUS_BY_CODE: Record<string, number> = {
  unauthorized: 401, forbidden: 403, trading_disabled: 403, account_closed: 403,
  trading_paused: 503, not_found: 404, no_account: 404, no_position: 404, no_order: 404, no_chunk: 404, no_archive: 404, no_alert: 404,
  method_not_allowed: 405, conflict: 409, price_moved: 409, news_window: 409, weekend_close: 409, bad_request: 400, rate_limited: 429,
};

const fail = (code: string, message: string): HostResponse => ({ status: STATUS_BY_CODE[code] ?? 422, body: { error: { code, message } } });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, name: string, optional = true): number | undefined => {
  if (v === undefined && optional) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new EngineError("bad_request", `${name} must be a number.`);
  return v;
};
const level = (v: unknown, name: string): number | null | undefined => (v === null ? null : num(v, name));

/** Strictly reads an order request body; unknown fields are refused so typos never pass silently. */
export function parseOrderRequest(body: unknown, idempotencyKey?: string): OrderRequest {
  if (!isObject(body)) throw new EngineError("bad_request", "The order must be a JSON object.");
  const allowed = new Set(["symbol", "side", "type", "lots", "price", "stopLoss", "takeProfit", "trailingPips", "expiresAt", "expectedPrice", "maxDeviationPips", "ocoWith", "clientId"]);
  const extra = Object.keys(body).filter(k => !allowed.has(k));
  if (extra.length) throw new EngineError("bad_request", `Unknown field: ${extra.join(", ")}.`);
  const { symbol, side, type, clientId } = body;
  if (typeof symbol !== "string" || !/^[A-Z]{6}$/.test(symbol)) throw new EngineError("bad_request", "symbol must be a pair like EURUSD.");
  if (side !== "buy" && side !== "sell") throw new EngineError("bad_request", "side must be buy or sell.");
  if (type !== "market" && type !== "limit" && type !== "stop") throw new EngineError("bad_request", "type must be market, limit or stop.");
  if (clientId !== undefined && (typeof clientId !== "string" || !clientId || clientId.length > 100)) throw new EngineError("bad_request", "clientId must be a short string.");
  if (idempotencyKey && clientId && idempotencyKey !== clientId) throw new EngineError("bad_request", "Idempotency-Key and clientId differ.");
  const key = (clientId as string | undefined) ?? (idempotencyKey || undefined);
  const req: OrderRequest = { symbol, side, type, lots: num(body.lots, "lots", false)! };
  const price = num(body.price, "price"), sl = num(body.stopLoss, "stopLoss"), tp = num(body.takeProfit, "takeProfit");
  if (price !== undefined) req.price = price;
  if (sl !== undefined) req.stopLoss = sl;
  if (tp !== undefined) req.takeProfit = tp;
  const trail = num(body.trailingPips, "trailingPips");
  if (trail !== undefined) req.trailingPips = trail;
  const expires = num(body.expiresAt, "expiresAt");
  if (expires !== undefined) req.expiresAt = expires;
  const expected = num(body.expectedPrice, "expectedPrice"), deviation = num(body.maxDeviationPips, "maxDeviationPips");
  if (expected !== undefined) req.expectedPrice = expected;
  if (deviation !== undefined) req.maxDeviationPips = deviation;
  if (body.ocoWith !== undefined) req.ocoWith = orderId(body.ocoWith);
  if (key) req.clientId = key;
  return req;
}

/**
 * Strictly reads a notices body: { alert?, fill?, stop?, limit?, target?,
 * expiry?, near? } with true/false values, and optionally `nearPercent`
 * (whole percent 5–90: warn when this share of a loss allowance is left).
 */
export function parseNotices(body: unknown): NoticeChange {
  if (!isObject(body)) throw new EngineError("bad_request", "Send the notices as a JSON object, e.g. { \"alert\": true }.");
  const keys = Object.keys(body);
  const extra = keys.filter(k => k !== "nearPercent" && !(NOTICE_KINDS as readonly string[]).includes(k));
  if (extra.length) throw new EngineError("bad_request", `Unknown field: ${extra.join(", ")}.`);
  if (!keys.length) throw new EngineError("bad_request", "Nothing to change.");
  if (keys.some(k => k !== "nearPercent" && typeof body[k] !== "boolean")) throw new EngineError("bad_request", "Each notice must be true or false.");
  if (body.nearPercent !== undefined && !(typeof body.nearPercent === "number" && Number.isInteger(body.nearPercent) && body.nearPercent >= NEAR_LIMIT_MIN_PERCENT && body.nearPercent <= NEAR_LIMIT_MAX_PERCENT)) {
    throw new EngineError("bad_request", `nearPercent must be a whole number from ${NEAR_LIMIT_MIN_PERCENT} to ${NEAR_LIMIT_MAX_PERCENT}.`);
  }
  return body as NoticeChange;
}

/** Strictly reads a price alert body: { symbol, condition: "above" | "below", price, note? }. */
export function parseAlertRequest(body: unknown): AlertRequest {
  if (!isObject(body)) throw new EngineError("bad_request", "The alert must be a JSON object.");
  const extra = Object.keys(body).filter(k => !["symbol", "condition", "price", "note"].includes(k));
  if (extra.length) throw new EngineError("bad_request", `Unknown field: ${extra.join(", ")}.`);
  const { symbol, condition, note } = body;
  if (typeof symbol !== "string" || !/^[A-Z]{6}$/.test(symbol)) throw new EngineError("bad_request", "symbol must be a pair like EURUSD.");
  if (condition !== "above" && condition !== "below") throw new EngineError("bad_request", "condition must be above or below.");
  if (note !== undefined && (typeof note !== "string" || note.length > 200)) throw new EngineError("bad_request", "note must be short text.");
  return { symbol, condition, price: num(body.price, "price", false)!, ...(note !== undefined ? { note: note as string } : {}) };
}

/** An order id sent as a link target: a short string without spaces. */
function orderId(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_:.-]{1,100}$/.test(v)) throw new EngineError("bad_request", "ocoWith must be the id of a pending order.");
  return v;
}

function parseChange(body: unknown, fields: ("price" | "stopLoss" | "takeProfit" | "trailingPips" | "expiresAt" | "ocoWith")[]): OrderChange & PositionChange {
  if (!isObject(body)) throw new EngineError("bad_request", "The change must be a JSON object.");
  const extra = Object.keys(body).filter(k => !(fields as string[]).includes(k));
  if (extra.length) throw new EngineError("bad_request", `Unknown field: ${extra.join(", ")}.`);
  const out: OrderChange & PositionChange = {};
  if ("price" in body) { const p = num(body.price, "price", false); if (p !== undefined) out.price = p; }
  if ("stopLoss" in body) out.stopLoss = level(body.stopLoss, "stopLoss");
  if ("takeProfit" in body) out.takeProfit = level(body.takeProfit, "takeProfit");
  if ("trailingPips" in body) out.trailingPips = level(body.trailingPips, "trailingPips");
  if ("expiresAt" in body) out.expiresAt = level(body.expiresAt, "expiresAt");
  if ("ocoWith" in body) out.ocoWith = body.ocoWith === null ? null : orderId(body.ocoWith);
  if (!Object.keys(out).length) throw new EngineError("bad_request", "Nothing to change.");
  return out;
}

/** Reads `chunk` (a whole number from 0) for GET /v1/accounts/{id}/history. */
export function parseChunk(req: Pick<HostRequest, "path" | "query">): number {
  const raw = req.query ? req.query.chunk : new URLSearchParams(req.path.split("?")[1] ?? "").get("chunk") ?? undefined;
  if (raw === undefined || !/^\d{1,6}$/.test(raw)) throw new EngineError("bad_request", "Add ?chunk=n (a whole number from 0, 0 is the oldest page).");
  return Number(raw);
}

const header = (h: HostRequest["headers"], name: string) => {
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
};

/** The account's snapshot; on the owner's first visit the account is opened (see openOnFirstVisit). */
async function snapshotOrOpen(opts: HostOptions, accountId: string): Promise<Snapshot> {
  try {
    return await opts.venue.snapshot(accountId);
  } catch (e) {
    if (!(e instanceof EngineError) || e.code !== "no_account" || opts.openOnFirstVisit === false) throw e;
    try {
      return await opts.venue.open(accountId);
    } catch (again) {
      // Two first visits at once: the other one created it, so just read it.
      if (again instanceof EngineError && again.code === "conflict") return opts.venue.snapshot(accountId);
      throw again;
    }
  }
}

/** Handles one request of the HTTP contract. Never throws: errors come back as { error: { code, message } }. */
export async function handleEngineRequest(req: HostRequest, opts: HostOptions): Promise<HostResponse> {
  try {
    const path = req.path.split("?")[0].replace(/\/+$/, "");
    const method = req.method.toUpperCase();
    const auth = header(req.headers, "authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    if (!token) return fail("unauthorized", "Sign in again to trade.");
    const userId = await opts.verifyToken(token);
    if (!userId) return fail("unauthorized", "Sign in again to trade.");
    if (opts.limiter) {
      const cls = requestClass(method, path);
      const r = opts.limiter.take(userId, cls);
      if (!r.ok) {
        const wait = r.retryAfterSeconds ?? 1;
        const what = cls === "read" ? "Too many requests in a short time" : cls === "reduce" ? "Too many close or cancel requests in a short time" : "Too many orders or changes in a short time";
        return {
          status: 429, headers: { "Retry-After": String(wait) },
          body: { error: { code: "rate_limited", message: `${what}. Nothing was sent; try again in ${wait} second${wait === 1 ? "" : "s"}.`, retryAfterSeconds: wait } },
        };
      }
    }

    if (path === "/v1/status") {
      if (method !== "GET") return fail("method_not_allowed", "Use GET.");
      const p = opts.pause?.();
      const news = opts.venue.newsStatus();
      return { status: 200, body: { ...opts.status(), ...(p ? { paused: { reason: p.reason, since: p.since, until: p.until, ...(p.holdPending ? { holdPending: true } : {}) } } : {}), markets: opts.venue.markets(), instruments: opts.venue.conditions(), schedule: opts.venue.schedule(), ...(news ? { news } : {}) } };
    }

    const m = /^\/v1\/accounts\/([^/]+)(?:\/(orders|positions|history|alerts|notices)(?:\/([^/]+)(?:\/(close))?)?)?$/.exec(path);
    if (!m) return fail("not_found", "Unknown address.");
    const [, rawAccount, collection, rawItem, action] = m;
    const accountId = decodeURIComponent(rawAccount), itemId = rawItem === undefined ? undefined : decodeURIComponent(rawItem);
    if (!(await opts.canAccess(userId, accountId))) return fail("forbidden", "This account belongs to someone else.");
    const ok = (s: Snapshot): HostResponse => ({ status: 200, body: s });
    const needsTrading = async () => {
      const p = opts.pause?.();
      if (p) throw new EngineError("trading_paused", pausedMessage(p));
      if (!(await opts.tradingEnabled(accountId))) throw new EngineError("trading_disabled", "Trading isn't switched on for this account yet, so no order was sent."); };

    if (!collection) return method === "GET" ? ok(await snapshotOrOpen(opts, accountId)) : fail("method_not_allowed", "Use GET.");
    if (collection === "history") {
      if (itemId) return fail("not_found", "Unknown address.");
      if (method !== "GET") return fail("method_not_allowed", "Use GET.");
      return { status: 200, body: await opts.venue.history(accountId, parseChunk(req)) };
    }
    // Notice choices never trade either; they work on any account, also before trading is switched on.
    if (collection === "notices") {
      if (itemId) return fail("not_found", "Unknown address.");
      return method === "PATCH" ? ok(await opts.venue.setNotices(accountId, parseNotices(req.body))) : fail("method_not_allowed", "Use PATCH.");
    }
    // Alerts never place, change or close an order, so they work before the owner switches trading on.
    if (collection === "alerts") {
      if (action) return fail("not_found", "Unknown address.");
      if (!itemId) return method === "POST" ? ok(await opts.venue.addAlert(accountId, parseAlertRequest(req.body))) : fail("method_not_allowed", "Use POST.");
      return method === "DELETE" ? ok(await opts.venue.removeAlert(accountId, itemId)) : fail("method_not_allowed", "Use DELETE.");
    }
    if (collection === "orders" && !itemId) {
      if (method !== "POST") return fail("method_not_allowed", "Use POST.");
      const order = parseOrderRequest(req.body, header(req.headers, "idempotency-key"));
      await needsTrading();
      return ok(await opts.venue.place(accountId, order));
    }
    if (collection === "orders" && itemId && !action) {
      if (method === "DELETE") return ok(await opts.venue.cancel(accountId, itemId));
      if (method === "PATCH") { const change = parseChange(req.body, ["price", "stopLoss", "takeProfit", "trailingPips", "expiresAt", "ocoWith"]); await needsTrading(); return ok(await opts.venue.modifyOrder(accountId, itemId, change)); }
      return fail("method_not_allowed", "Use PATCH or DELETE.");
    }
    if (collection === "positions" && itemId && action === "close") {
      if (method !== "POST") return fail("method_not_allowed", "Use POST.");
      const body = req.body === undefined ? {} : req.body;
      if (!isObject(body) || Object.keys(body).some(k => k !== "lots")) throw new EngineError("bad_request", "Send { lots } or an empty body.");
      return ok(await opts.venue.close(accountId, itemId, num(body.lots, "lots")));
    }
    if (collection === "positions" && itemId && !action) {
      if (method !== "PATCH") return fail("method_not_allowed", "Use PATCH.");
      const change = parseChange(req.body, ["stopLoss", "takeProfit", "trailingPips"]);
      await needsTrading();
      const { stopLoss, takeProfit, trailingPips } = change;
      return ok(await opts.venue.modify(accountId, itemId, { ...("stopLoss" in change ? { stopLoss } : {}), ...("takeProfit" in change ? { takeProfit } : {}), ...("trailingPips" in change ? { trailingPips } : {}) }));
    }
    return fail("not_found", "Unknown address.");
  } catch (e) {
    if (e instanceof EngineError) return fail(e.code, e.message);
    return { status: 500, body: { error: { code: "server_error", message: "The trading server had a problem. Refresh to see whether the request went through." } } };
  }
}

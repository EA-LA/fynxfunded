import type { PairLike } from "./venue";
import { EngineError } from "./types";
import { StreamingQuoteFeed, type FeedTransport, type RawPrice, type StreamingFeedOptions } from "./quote-feed";

/**
 * Price feed from settings: most licensed forex price providers stream JSON
 * over a WebSocket. For those, the owner connects the provider by filling in
 * environment variables on the engine host instead of writing code:
 *
 * | Variable | Example | Required |
 * | --- | --- | --- |
 * | FYNX_FEED_URL | wss://stream.example-provider.com/v1/fx?apiKey={key} | yes (wss://) |
 * | FYNX_FEED_API_KEY | (the provider's key; a secret on the host, never in git) | no |
 * | FYNX_FEED_SUBSCRIBE | {"action":"subscribe","pairs":{symbols},"key":"{key}"} | no (message sent after connecting) |
 * | FYNX_FEED_FIELDS | {"symbol":"pair","bid":"b","ask":"a","time":"t"} | yes (where the numbers are in each message) |
 * | FYNX_FEED_SYMBOL_FORMAT | {base}/{quote} | no (default {symbol}, e.g. EURUSD) |
 * | FYNX_FEED_SYMBOL_MAP | {"USDHUF":"USD-HUF"} | no (exceptions to the format) |
 * | FYNX_FEED_TIME_UNIT | ms | no (ms, s or iso; default ms) |
 * | FYNX_FEED_MAX_SPREAD_PIPS | 50 | no (default 50) |
 * | FYNX_FEED_IDLE_RECONNECT_MS | 60000 | no (reconnect after this long without any message; default 60000) |
 *
 * `FYNX_FEED_FIELDS` keys: `symbol`, `bid`, `ask` (required), `time` (optional;
 * without it the arrival time is used), `items` (optional path to a list of
 * prices inside one message) and `match` (optional `{ "path": value }` pairs a
 * message must carry to count as a price, e.g. `{"ev":"C"}`). Paths use dots
 * and list positions: `data.0.bid`. A message that is a JSON list is read item
 * by item. Messages without any of symbol/bid/ask (heartbeats, acknowledgements)
 * are ignored, not counted as errors.
 *
 * Placeholders: `{key}` (the API key; URL-encoded in the URL), `{symbols}`
 * (JSON list of provider symbols), `{symbols_csv}` (comma separated). Symbol
 * format: `{symbol}`, `{base}`, `{quote}` and their `_lower` forms.
 *
 * Providers that need header authentication, a REST login first, or a binary
 * protocol use the `StreamingQuoteFeed` template in `quote-feed.ts` directly.
 * Nothing here connects to anything until the host calls `venue.connect(feed)`.
 */

export const FEED_ENV = {
  url: "FYNX_FEED_URL",
  key: "FYNX_FEED_API_KEY",
  subscribe: "FYNX_FEED_SUBSCRIBE",
  fields: "FYNX_FEED_FIELDS",
  symbolFormat: "FYNX_FEED_SYMBOL_FORMAT",
  symbolMap: "FYNX_FEED_SYMBOL_MAP",
  timeUnit: "FYNX_FEED_TIME_UNIT",
  maxSpread: "FYNX_FEED_MAX_SPREAD_PIPS",
  idle: "FYNX_FEED_IDLE_RECONNECT_MS",
} as const;

type Env = Record<string, string | undefined>;

export interface FieldMap {
  symbol: string;
  bid: string;
  ask: string;
  time?: string;
  items?: string;
  match?: Record<string, string | number | boolean>;
}

export type TimeUnit = "ms" | "s" | "iso";

export interface FeedConfig {
  /** Full URL with the key filled in. Never log it: use `safeUrl`. */
  url: string;
  /** URL with the key replaced by "•••", for logs and the check report. */
  safeUrl: string;
  /** Text sent once after each connection, or null. Contains the key when the template uses {key}. */
  subscribe: ((providerSymbols: string[]) => string) | null;
  fields: FieldMap;
  timeUnit: TimeUnit;
  /** FYNX symbol -> provider symbol, for every pair. */
  symbolMap: Record<string, string>;
  maxSpreadPips: number;
  idleReconnectMs: number;
}

const PATH = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const KEY_OK = /^[\x21-\x7e]+$/;

/** Reads a dotted path ("data.0.bid") from a parsed JSON value. */
export function readPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function providerSymbol(format: string, pair: PairLike): string {
  return format
    .replace(/\{symbol_lower\}/g, pair.symbol.toLowerCase())
    .replace(/\{base_lower\}/g, pair.base.toLowerCase())
    .replace(/\{quote_lower\}/g, pair.quote.toLowerCase())
    .replace(/\{symbol\}/g, pair.symbol)
    .replace(/\{base\}/g, pair.base)
    .replace(/\{quote\}/g, pair.quote);
}

function readFields(raw: string | undefined, problems: string[]): FieldMap {
  const empty: FieldMap = { symbol: "", bid: "", ask: "" };
  if (!raw?.trim()) { problems.push(`${FEED_ENV.fields} is missing (where symbol, bid and ask are in each message, e.g. {"symbol":"pair","bid":"b","ask":"a","time":"t"}).`); return empty; }
  let v: unknown;
  try { v = JSON.parse(raw); } catch { problems.push(`${FEED_ENV.fields} is not valid JSON.`); return empty; }
  if (!v || typeof v !== "object" || Array.isArray(v)) { problems.push(`${FEED_ENV.fields} must be an object like {"symbol":"pair","bid":"b","ask":"a"}.`); return empty; }
  const o = v as Record<string, unknown>;
  const unknownKeys = Object.keys(o).filter(k => !["symbol", "bid", "ask", "time", "items", "match"].includes(k));
  if (unknownKeys.length) problems.push(`${FEED_ENV.fields}: unknown key(s) ${unknownKeys.join(", ")} (use symbol, bid, ask, time, items, match).`);
  const out: FieldMap = { ...empty };
  for (const k of ["symbol", "bid", "ask"] as const) {
    if (typeof o[k] !== "string" || !PATH.test(o[k] as string)) problems.push(`${FEED_ENV.fields}: "${k}" must be a path like "${k === "symbol" ? "pair" : k}" or "data.${k}".`);
    else out[k] = o[k] as string;
  }
  for (const k of ["time", "items"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "string" || !PATH.test(o[k] as string)) problems.push(`${FEED_ENV.fields}: "${k}" must be a path like "data".`);
    else out[k] = o[k] as string;
  }
  if (o.match !== undefined) {
    const m = o.match;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Object.keys(m).length
      || Object.entries(m).some(([p, val]) => !PATH.test(p) || !["string", "number", "boolean"].includes(typeof val))) {
      problems.push(`${FEED_ENV.fields}: "match" must be like {"type":"quote"} (paths to plain values).`);
    } else out.match = m as FieldMap["match"];
  }
  return out;
}

/**
 * Reads and checks every price-feed setting. Throws `bad_settings` listing
 * all problems at once. The API key is never part of an error message.
 */
export function readFeedConfig(env: Env, pairs: PairLike[]): FeedConfig {
  const problems: string[] = [];
  const key = env[FEED_ENV.key]?.trim() || "";
  if (key && (!KEY_OK.test(key) || /["\\]/.test(key))) problems.push(`${FEED_ENV.key} contains spaces, quotes or backslashes; check it was copied correctly.`);

  const rawUrl = env[FEED_ENV.url]?.trim() || "";
  let url = "", safeUrl = "";
  if (!rawUrl) problems.push(`${FEED_ENV.url} is missing (the provider's streaming address, starting with wss://).`);
  else {
    url = rawUrl.replace(/\{key\}/g, encodeURIComponent(key));
    safeUrl = rawUrl.replace(/\{key\}/g, "•••");
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { problems.push(`${FEED_ENV.url} is not a valid address.`); }
    if (parsed) {
      const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "wss:" && !(parsed.protocol === "ws:" && local)) problems.push(`${FEED_ENV.url} must start with wss:// (encrypted); ws:// is only allowed for localhost tests.`);
      if (parsed.username || parsed.password) problems.push(`${FEED_ENV.url} must not contain a user name or password; use {key} with ${FEED_ENV.key}.`);
    }
    if (/\{key\}/.test(rawUrl) && !key) problems.push(`${FEED_ENV.url} uses {key} but ${FEED_ENV.key} is missing.`);
  }

  const rawSub = env[FEED_ENV.subscribe]?.trim() || "";
  if (/\{key\}/.test(rawSub) && !key) problems.push(`${FEED_ENV.subscribe} uses {key} but ${FEED_ENV.key} is missing.`);
  if (key && !/\{key\}/.test(rawUrl) && !/\{key\}/.test(rawSub)) problems.push(`${FEED_ENV.key} is set but not used: put {key} in ${FEED_ENV.url} or ${FEED_ENV.subscribe} where the provider expects it.`);
  const subscribe = rawSub
    ? (symbols: string[]) => rawSub
      .replace(/\{symbols_csv\}/g, symbols.join(","))
      .replace(/\{symbols\}/g, JSON.stringify(symbols))
      .replace(/\{key\}/g, key)
    : null;

  const fields = readFields(env[FEED_ENV.fields], problems);

  const rawUnit = (env[FEED_ENV.timeUnit]?.trim() || "ms").toLowerCase();
  if (!["ms", "s", "iso"].includes(rawUnit)) problems.push(`${FEED_ENV.timeUnit} must be ms, s or iso (got "${rawUnit}").`);
  const timeUnit = rawUnit as TimeUnit;

  const format = env[FEED_ENV.symbolFormat]?.trim() || "{symbol}";
  if (!/\{(symbol|base|quote)(_lower)?\}/.test(format)) problems.push(`${FEED_ENV.symbolFormat} must contain {symbol} or {base} and {quote} (e.g. {base}/{quote}).`);
  const symbolMap: Record<string, string> = {};
  for (const p of pairs) symbolMap[p.symbol] = providerSymbol(format, p);
  const rawMap = env[FEED_ENV.symbolMap]?.trim();
  if (rawMap) {
    let m: unknown;
    try { m = JSON.parse(rawMap); } catch { problems.push(`${FEED_ENV.symbolMap} is not valid JSON.`); }
    if (m !== undefined) {
      if (!m || typeof m !== "object" || Array.isArray(m)) problems.push(`${FEED_ENV.symbolMap} must be an object like {"USDHUF":"USD-HUF"}.`);
      else for (const [fynx, prov] of Object.entries(m as Record<string, unknown>)) {
        if (!pairs.some(p => p.symbol === fynx)) problems.push(`${FEED_ENV.symbolMap}: ${fynx} is not a FYNX Trade pair.`);
        else if (typeof prov !== "string" || !prov.trim() || prov.length > 40) problems.push(`${FEED_ENV.symbolMap}: ${fynx} needs the provider's name for it (1–40 characters).`);
        else symbolMap[fynx] = prov.trim();
      }
    }
  }
  const seen = new Map<string, string>();
  for (const [fynx, prov] of Object.entries(symbolMap)) {
    const other = seen.get(prov);
    if (other) problems.push(`${other} and ${fynx} would both be "${prov}" at the provider; fix ${FEED_ENV.symbolFormat} or ${FEED_ENV.symbolMap}.`);
    else seen.set(prov, fynx);
  }

  const num = (name: string, fallback: number, [lo, hi]: [number, number]) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || n < lo || n > hi) { problems.push(`${name} must be a number from ${lo} to ${hi} (got "${raw}").`); return fallback; }
    return n;
  };
  const maxSpreadPips = num(FEED_ENV.maxSpread, 50, [0.1, 1000]);
  const idleReconnectMs = num(FEED_ENV.idle, 60_000, [5_000, 600_000]);

  if (problems.length) throw new EngineError("bad_settings", `The price feed is not configured yet:\n- ${problems.join("\n- ")}`);
  return { url, safeUrl, subscribe, fields, timeUnit, symbolMap, maxSpreadPips, idleReconnectMs };
}

function toTime(v: unknown, unit: TimeUnit): unknown {
  if (v === undefined || v === null) return v;
  if (unit === "iso") return typeof v === "string" ? Date.parse(v) : NaN;
  const n = typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== "number") return NaN;
  return unit === "s" ? Math.round(n * 1000) : n;
}

/**
 * Builds the `parse` function for `StreamingQuoteFeed` from the field map.
 * The transport hands over raw text; this parses JSON (bad JSON throws, which
 * the feed counts as `parse_error`) and returns the prices found.
 */
export function fieldParser(fields: FieldMap, timeUnit: TimeUnit, clock: () => number = Date.now): (message: unknown) => RawPrice[] {
  const matches = (v: unknown) => !fields.match || Object.entries(fields.match).every(([p, want]) => readPath(v, p) === want);
  return (message: unknown) => {
    const value = typeof message === "string" ? JSON.parse(message) : message;
    const messages = Array.isArray(value) ? value : [value];
    const out: RawPrice[] = [];
    for (const m of messages) {
      if (!matches(m)) continue;
      const items = fields.items ? readPath(m, fields.items) : [m];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const symbol = readPath(item, fields.symbol), bid = readPath(item, fields.bid), ask = readPath(item, fields.ask);
        if (symbol === undefined && bid === undefined && ask === undefined) continue; // heartbeat / acknowledgement
        const time = fields.time ? toTime(readPath(item, fields.time), timeUnit) : clock();
        out.push({ symbol, bid, ask, time } as RawPrice);
      }
    }
    return out;
  };
}

/** The part of a WebSocket the transport uses (browser/Node `WebSocket` fits). */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export interface WebSocketTransportOptions {
  url: string;
  subscribe?: ((providerSymbols: string[]) => string) | null;
  socket: SocketFactory;
  /** Close and reconnect when nothing at all arrives for this long (half-open connections). */
  idleReconnectMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const decoder = new TextDecoder();

/**
 * A `FeedTransport` over a WebSocket: connects, sends the subscribe message,
 * hands each text message to the feed, and reports closes, errors and silent
 * connections so `StreamingQuoteFeed` reconnects with backoff. Close reasons
 * never contain the address (it may carry the key).
 */
export function webSocketTransport(o: WebSocketTransportOptions): FeedTransport {
  const schedule = o.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.cancel ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
  const idleMs = o.idleReconnectMs ?? 60_000;
  return {
    open(providerSymbols, onMessage, onClose) {
      let done = false, idle: unknown = null;
      const ws = o.socket(o.url);
      const finish = (reason: string) => {
        if (done) return;
        done = true;
        if (idle !== null) cancel(idle);
        try { ws.close(); } catch { /* already closed */ }
        onClose(reason);
      };
      const arm = () => {
        if (idle !== null) cancel(idle);
        idle = schedule(() => finish(`no data for ${Math.round(idleMs / 1000)} s`), idleMs);
      };
      ws.onopen = () => {
        if (done) return;
        arm();
        if (o.subscribe) {
          try { ws.send(o.subscribe(providerSymbols)); } catch { finish("could not send the subscribe message"); }
        }
      };
      ws.onmessage = ev => {
        if (done) return;
        arm();
        const d = ev.data;
        const text = typeof d === "string" ? d
          : Object.prototype.toString.call(d) === "[object ArrayBuffer]" ? decoder.decode(new Uint8Array(d as ArrayBuffer))
          : ArrayBuffer.isView(d) ? decoder.decode(new Uint8Array((d as ArrayBufferView).buffer, (d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteLength))
          : null;
        if (text !== null) onMessage(text);
      };
      ws.onerror = () => finish("connection error");
      ws.onclose = ev => finish(`closed by the provider (code ${ev?.code ?? "unknown"})`);
      return () => {
        if (done) return;
        done = true;
        if (idle !== null) cancel(idle);
        try { ws.close(); } catch { /* already closed */ }
      };
    },
  };
}

export interface FeedFromEnvOptions extends Pick<StreamingFeedOptions, "clock" | "schedule" | "cancel" | "backoffMs" | "staleAfterMs"> {
  /** WebSocket factory; Node 22+ has a global WebSocket: `url => new WebSocket(url)`. */
  socket: SocketFactory;
}

/**
 * One call for the host file: `createFeedFromEnv(process.env, FOREX_PAIRS, { socket: url => new WebSocket(url) })`.
 * Returns the checked settings (for logs: `config.safeUrl`) and a ready
 * `StreamingQuoteFeed` with symbol mapping, price checks, reconnects and health.
 */
export function createFeedFromEnv(env: Env, pairs: PairLike[], opts: FeedFromEnvOptions): { config: FeedConfig; feed: StreamingQuoteFeed } {
  const config = readFeedConfig(env, pairs);
  const clock = opts.clock ?? Date.now;
  const feed = new StreamingQuoteFeed({
    transport: webSocketTransport({ url: config.url, subscribe: config.subscribe, socket: opts.socket, idleReconnectMs: config.idleReconnectMs, schedule: opts.schedule, cancel: opts.cancel }),
    parse: fieldParser(config.fields, config.timeUnit, clock),
    symbolMap: config.symbolMap,
    pipSize: s => pairs.find(p => p.symbol === s)?.pipSize,
    maxSpreadPips: config.maxSpreadPips,
    clock, schedule: opts.schedule, cancel: opts.cancel, backoffMs: opts.backoffMs, staleAfterMs: opts.staleAfterMs,
  });
  return { config, feed };
}

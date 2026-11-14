import type { QuoteFeed } from "./venue";
import type { Quote } from "./types";

/**
 * Template for the licensed price feed ("the gas").
 *
 * A provider adapter only has to supply two things:
 *  - `open(onMessage, onClose)`: open the provider's stream (WebSocket, SSE,
 *    SDK…) for the given provider symbols and return a function that closes it;
 *  - `parse(message)`: turn one raw provider message into zero or more raw
 *    prices `{ symbol, bid, ask, time }` using the PROVIDER's symbol names.
 *
 * `StreamingQuoteFeed` does everything else the engine needs and that is easy
 * to get wrong: mapping provider symbols to FYNX symbols, refusing bad prices
 * (missing, negative, crossed bid/ask, absurd spreads, future or out-of-order
 * timestamps) instead of filling orders on them, reconnecting with backoff, and
 * reporting health for GET /v1/status (`priceFeed`). Nothing here connects to
 * anything until a host calls `subscribe`.
 */

export interface RawPrice { symbol: string; bid: unknown; ask: unknown; time: unknown }

export interface FeedTransport {
  /** Opens the stream. Must call onMessage for each message and onClose when the stream ends or fails. Returns a close function. */
  open(providerSymbols: string[], onMessage: (message: unknown) => void, onClose: (reason?: string) => void): () => void;
}

export interface StreamingFeedOptions {
  transport: FeedTransport;
  parse: (message: unknown) => RawPrice[];
  /** FYNX symbol -> provider symbol (e.g. { EURUSD: "EUR/USD" }). Symbols not listed are passed through unchanged. */
  symbolMap?: Record<string, string>;
  /** Pip size per FYNX symbol, used for the spread check. */
  pipSize?: (symbol: string) => number | undefined;
  /** Refuse quotes whose spread is wider than this many pips. Default 50. */
  maxSpreadPips?: number;
  /** Refuse quotes timestamped more than this far in the future (clock skew). Default 5 000 ms. */
  maxFutureMs?: number;
  /** Health: the feed counts as live only if a valid quote arrived within this window. Default 15 000 ms. */
  staleAfterMs?: number;
  /** Reconnect delays in ms; the last one repeats. Default 1s, 2s, 5s, 10s, 30s. */
  backoffMs?: number[];
  clock?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export type RejectReason = "unknown_symbol" | "bad_number" | "crossed" | "wide_spread" | "future_time" | "out_of_order" | "parse_error";

export interface FeedHealth {
  connected: boolean;
  /** True when connected and a valid quote arrived within `staleAfterMs`. Use this for /v1/status priceFeed. */
  live: boolean;
  lastQuoteAt: number | null;
  accepted: number;
  rejected: Record<RejectReason, number>;
  reconnects: number;
  lastError: string | null;
}

/** Validates one raw provider price. Returns a Quote or the reason it was refused. */
export function validatePrice(raw: RawPrice, symbol: string, opts: { now: number; lastTime?: number; pipSize?: number; maxSpreadPips: number; maxFutureMs: number }): Quote | RejectReason {
  const bid = typeof raw.bid === "string" ? Number(raw.bid) : raw.bid;
  const ask = typeof raw.ask === "string" ? Number(raw.ask) : raw.ask;
  const time = typeof raw.time === "string" ? Date.parse(raw.time) : raw.time;
  if (typeof bid !== "number" || typeof ask !== "number" || typeof time !== "number" || ![bid, ask, time].every(Number.isFinite) || bid <= 0 || ask <= 0) return "bad_number";
  if (bid > ask) return "crossed";
  if (opts.pipSize && (ask - bid) / opts.pipSize > opts.maxSpreadPips + 1e-9) return "wide_spread";
  if (time > opts.now + opts.maxFutureMs) return "future_time";
  if (opts.lastTime !== undefined && time < opts.lastTime) return "out_of_order";
  return { symbol, bid, ask, time };
}

const emptyRejects = (): Record<RejectReason, number> => ({ unknown_symbol: 0, bad_number: 0, crossed: 0, wide_spread: 0, future_time: 0, out_of_order: 0, parse_error: 0 });

export class StreamingQuoteFeed implements QuoteFeed {
  private readonly o: Required<Omit<StreamingFeedOptions, "symbolMap" | "pipSize">> & Pick<StreamingFeedOptions, "pipSize">;
  private readonly toProvider: Record<string, string>;
  private stats: FeedHealth = { connected: false, live: false, lastQuoteAt: null, accepted: 0, rejected: emptyRejects(), reconnects: 0, lastError: null };
  private lastTime: Record<string, number> = {};

  constructor(opts: StreamingFeedOptions) {
    this.o = {
      transport: opts.transport, parse: opts.parse, pipSize: opts.pipSize,
      maxSpreadPips: opts.maxSpreadPips ?? 50, maxFutureMs: opts.maxFutureMs ?? 5_000, staleAfterMs: opts.staleAfterMs ?? 15_000,
      backoffMs: opts.backoffMs?.length ? opts.backoffMs : [1_000, 2_000, 5_000, 10_000, 30_000],
      clock: opts.clock ?? Date.now,
      schedule: opts.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
      cancel: opts.cancel ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
    this.toProvider = opts.symbolMap ?? {};
  }

  health(): FeedHealth {
    const now = this.o.clock();
    const live = this.stats.connected && this.stats.lastQuoteAt !== null && now - this.stats.lastQuoteAt <= this.o.staleAfterMs;
    return { ...this.stats, rejected: { ...this.stats.rejected }, live };
  }

  subscribe(symbols: string[], onQuote: (q: Quote) => void): () => void {
    const fromProvider = new Map(symbols.map(s => [this.toProvider[s] ?? s, s]));
    let stopped = false, attempt = 0, close: (() => void) | null = null, timer: unknown = null;

    const onMessage = (message: unknown) => {
      if (stopped) return;
      let raws: RawPrice[];
      try { raws = this.o.parse(message); } catch { this.stats.rejected.parse_error++; return; }
      for (const raw of raws) {
        const symbol = fromProvider.get(String(raw?.symbol));
        if (!symbol) { this.stats.rejected.unknown_symbol++; continue; }
        const q = validatePrice(raw, symbol, { now: this.o.clock(), lastTime: this.lastTime[symbol], pipSize: this.o.pipSize?.(symbol), maxSpreadPips: this.o.maxSpreadPips, maxFutureMs: this.o.maxFutureMs });
        if (typeof q === "string") { this.stats.rejected[q]++; continue; }
        attempt = 0;
        this.lastTime[symbol] = q.time;
        this.stats.accepted++;
        this.stats.lastQuoteAt = this.o.clock();
        onQuote(q);
      }
    };
    const onClose = (reason?: string) => {
      if (stopped) return;
      close = null;
      this.stats.connected = false;
      this.stats.lastError = reason ?? "stream closed";
      const delay = this.o.backoffMs[Math.min(attempt, this.o.backoffMs.length - 1)];
      attempt++;
      timer = this.o.schedule(() => { timer = null; this.stats.reconnects++; connect(); }, delay);
    };
    const connect = () => {
      if (stopped) return;
      try {
        this.stats.connected = true;
        close = this.o.transport.open([...fromProvider.keys()], onMessage, onClose);
      } catch (e) {
        onClose(e instanceof Error ? e.message : "could not open the stream");
      }
    };
    connect();
    return () => {
      stopped = true;
      this.stats.connected = false;
      if (timer !== null) this.o.cancel(timer);
      close?.();
    };
  }
}

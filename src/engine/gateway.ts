import type { LocalVenue, Snapshot } from "./venue";
import type { CloseReason, Deal, HistoryPage, OrderRequest } from "./types";
import type { OrderChange } from "./core";
import { EngineError } from "./types";
import type { MarketState } from "./hours";

/**
 * What the FYNX Trade terminal talks to. Three implementations:
 *  - DisconnectedGateway: nothing is plugged in yet; every action says so and no order is sent.
 *  - HttpGateway: the FYNX API (or any server) speaking the contract in docs/ENGINE-READINESS.md.
 *  - LocalGatewayAdapter: an in-process LocalVenue (tests and server hosts).
 */

export type GatewayMode = "disconnected" | "remote" | "local";

export interface GatewayStatus {
  connected: boolean;
  /** Price feed delivering quotes. */
  priceFeed: boolean;
  /** Orders can be executed. */
  execution: boolean;
  message: string;
  /**
   * Open/closed per symbol from the server's trading hours (including the
   * provider's holiday closures). Optional: without it the terminal uses the
   * standard forex week.
   */
  markets?: Record<string, MarketState>;
}

/** Keeps only well-formed per-symbol market states from a server answer; anything else is dropped. */
export function parseMarkets(raw: unknown): Record<string, MarketState> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, MarketState> = {};
  for (const [symbol, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z]{6}$/.test(symbol) || typeof v !== "object" || v === null) continue;
    const { open, nextChange, reason } = v as Record<string, unknown>;
    if (typeof open !== "boolean") continue;
    if (!(nextChange === null || nextChange === undefined || (typeof nextChange === "number" && Number.isFinite(nextChange) && nextChange > 0))) continue;
    if (!(reason === null || reason === undefined || (typeof reason === "string" && reason.length <= 120))) continue;
    out[symbol] = { open, nextChange: (nextChange as number | null | undefined) ?? null, reason: open ? null : ((reason as string | null | undefined) || "Outside trading hours") };
  }
  return Object.keys(out).length ? out : undefined;
}

export interface TradingGateway {
  readonly mode: GatewayMode;
  status(): Promise<GatewayStatus>;
  snapshot(accountId: string): Promise<Snapshot>;
  placeOrder(accountId: string, order: OrderRequest): Promise<Snapshot>;
  closePosition(accountId: string, positionId: string, lots?: number): Promise<Snapshot>;
  modifyPosition(accountId: string, positionId: string, protection: { stopLoss?: number | null; takeProfit?: number | null }): Promise<Snapshot>;
  /** Changes the price, stop loss or take profit of a pending order (null removes a level). */
  modifyOrder(accountId: string, orderId: string, change: OrderChange): Promise<Snapshot>;
  cancelOrder(accountId: string, orderId: string): Promise<Snapshot>;
  /**
   * One page of older trades moved to the account archive (chunk 0 is the
   * oldest; the snapshot's `state.archived.chunks` says how many there are).
   */
  archivedDeals(accountId: string, index: number): Promise<HistoryPage>;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const CLOSE_REASONS = new Set<string>(["manual", "stop_loss", "take_profit", "daily_loss_limit", "maximum_loss_limit", "target_reached"] satisfies CloseReason[]);
function validDeal(d: unknown): d is Deal {
  if (typeof d !== "object" || d === null) return false;
  const x = d as Record<string, unknown>;
  return typeof x.id === "string" && typeof x.positionId === "string" && typeof x.symbol === "string" && /^[A-Z]{6}$/.test(x.symbol)
    && (x.side === "buy" || x.side === "sell") && finite(x.lots) && x.lots > 0 && finite(x.entryPrice) && finite(x.exitPrice)
    && finite(x.openedAt) && finite(x.closedAt) && finite(x.grossProfit) && finite(x.commission) && finite(x.netProfit)
    && (x.swap === undefined || finite(x.swap)) && typeof x.reason === "string" && CLOSE_REASONS.has(x.reason)
    && (x.entryRisk === undefined || validEntryRisk(x.entryRisk));
}

/** Entry risk on a deal or position: stop loss, optional take profit, dollars at risk and the opening balance. */
export function validEntryRisk(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return finite(x.stopLoss) && x.stopLoss > 0 && (x.takeProfit === undefined || (finite(x.takeProfit) && x.takeProfit > 0))
    && finite(x.amount) && x.amount > 0 && finite(x.balance) && x.balance > 0;
}

/**
 * Checks a server's archive page before the terminal shows it: right account
 * and page, every deal well-formed. Anything else is refused rather than shown.
 */
export function parseHistoryPage(raw: unknown, accountId: string, index: number): HistoryPage {
  const bad = () => new EngineError("bad_response", "The trading server sent an archive page the terminal could not read.");
  if (typeof raw !== "object" || raw === null) throw bad();
  const p = raw as Record<string, unknown>;
  if (p.accountId !== accountId || p.index !== index || !Number.isInteger(p.chunks) || (p.chunks as number) <= index) throw bad();
  if (!Array.isArray(p.deals) || !p.deals.every(validDeal) || !finite(p.firstClosedAt) || !finite(p.lastClosedAt)) throw bad();
  return { accountId, index, chunks: p.chunks as number, firstClosedAt: p.firstClosedAt, lastClosedAt: p.lastClosedAt, deals: p.deals };
}

export class GatewayNotConnectedError extends EngineError {
  constructor() { super("not_connected", "Trading isn't connected yet, so no order was sent."); this.name = "GatewayNotConnectedError"; }
}

export class DisconnectedGateway implements TradingGateway {
  readonly mode = "disconnected" as const;
  async status(): Promise<GatewayStatus> { return { connected: false, priceFeed: false, execution: false, message: "The trading engine is not connected yet." }; }
  private fail(): Promise<never> { return Promise.reject(new GatewayNotConnectedError()); }
  snapshot() { return this.fail(); }
  placeOrder() { return this.fail(); }
  closePosition() { return this.fail(); }
  modifyPosition() { return this.fail(); }
  modifyOrder() { return this.fail(); }
  cancelOrder() { return this.fail(); }
  archivedDeals() { return this.fail(); }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpGateway implements TradingGateway {
  readonly mode = "remote" as const;
  private base: string;
  constructor(baseUrl: string, private token: () => Promise<string | null>, private fetcher: FetchLike = (i, init) => fetch(i, init)) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const token = await this.token();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new EngineError("network", "Could not reach the trading server. Check your connection; the order may not have been sent.");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = data && typeof data === "object" && "error" in data ? (data as { error: { code?: string; message?: string } }).error : null;
      throw new EngineError(err?.code || `http_${response.status}`, err?.message || `The trading server answered ${response.status}.`);
    }
    return data as T;
  }

  async status(): Promise<GatewayStatus> {
    try {
      const s = await this.call<Partial<GatewayStatus> & { markets?: unknown }>("GET", "/v1/status");
      const markets = parseMarkets(s?.markets);
      return { connected: true, priceFeed: !!s?.priceFeed, execution: !!s?.execution, message: (typeof s?.message === "string" && s.message) || "Connected.", ...(markets ? { markets } : {}) };
    } catch (e) {
      return { connected: false, priceFeed: false, execution: false, message: e instanceof Error ? e.message : "Not connected." };
    }
  }
  snapshot(id: string) { return this.call<Snapshot>("GET", `/v1/accounts/${encodeURIComponent(id)}`); }
  placeOrder(id: string, order: OrderRequest) { return this.call<Snapshot>("POST", `/v1/accounts/${encodeURIComponent(id)}/orders`, order, order.clientId); }
  closePosition(id: string, positionId: string, lots?: number) { return this.call<Snapshot>("POST", `/v1/accounts/${encodeURIComponent(id)}/positions/${encodeURIComponent(positionId)}/close`, lots === undefined ? {} : { lots }); }
  modifyPosition(id: string, positionId: string, protection: { stopLoss?: number | null; takeProfit?: number | null }) { return this.call<Snapshot>("PATCH", `/v1/accounts/${encodeURIComponent(id)}/positions/${encodeURIComponent(positionId)}`, protection); }
  modifyOrder(id: string, orderId: string, change: OrderChange) { return this.call<Snapshot>("PATCH", `/v1/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`, change); }
  cancelOrder(id: string, orderId: string) { return this.call<Snapshot>("DELETE", `/v1/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`); }
  async archivedDeals(id: string, index: number) {
    if (!Number.isInteger(index) || index < 0) throw new EngineError("bad_request", "chunk must be a whole number from 0.");
    return parseHistoryPage(await this.call<unknown>("GET", `/v1/accounts/${encodeURIComponent(id)}/history?chunk=${index}`), id, index);
  }
}

export class LocalGatewayAdapter implements TradingGateway {
  readonly mode = "local" as const;
  constructor(private venue: LocalVenue) {}
  async status(): Promise<GatewayStatus> { const live = Object.keys(this.venue.quotes).length > 0; return { connected: true, priceFeed: live, execution: live, message: live ? "Local engine running." : "Local engine waiting for prices.", markets: this.venue.markets() }; }
  snapshot(id: string) { return this.venue.snapshot(id); }
  placeOrder(id: string, order: OrderRequest) { return this.venue.place(id, order); }
  closePosition(id: string, positionId: string, lots?: number) { return this.venue.close(id, positionId, lots); }
  modifyPosition(id: string, positionId: string, p: { stopLoss?: number | null; takeProfit?: number | null }) { return this.venue.modify(id, positionId, p); }
  modifyOrder(id: string, orderId: string, change: OrderChange) { return this.venue.modifyOrder(id, orderId, change); }
  cancelOrder(id: string, orderId: string) { return this.venue.cancel(id, orderId); }
  archivedDeals(id: string, index: number) { return this.venue.history(id, index); }
}

/**
 * Picks the gateway from configuration. Set VITE_FYNX_TRADE_API_URL (an https
 * address) at build time to connect the terminal to the FYNX API.
 */
export function createGateway(apiUrl: string | undefined, token: () => Promise<string | null>): TradingGateway {
  const url = (apiUrl || "").trim();
  if (!/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) return new DisconnectedGateway();
  return new HttpGateway(url, token);
}

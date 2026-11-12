import type { LocalVenue, Snapshot } from "./venue";
import type { AlertRequest, CloseReason, Deal, HistoryPage, NoticeChange, OrderRequest } from "./types";
import type { OrderChange, PositionChange } from "./core";
import { EngineError } from "./types";
import type { MarketState, Schedule } from "./hours";
import type { TradingConditions } from "./venue";

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
  /**
   * Leverage, lot limits, commission and swap per symbol from the server's
   * settings. Optional: without it the terminal does not show margin or
   * commission figures (it never guesses them).
   */
  instruments?: Record<string, TradingConditions>;
  /**
   * Open stretches and one-off closures per symbol for the next days (UTC ms),
   * from the server's trading hours. Optional: without it the terminal's
   * contract specification shows the standard forex week, labelled as such.
   */
  schedule?: Record<string, Schedule>;
  /**
   * true when the server has a notice sender connected (email or another
   * channel), so the trader's notice choices are acted on. Missing or false:
   * the terminal says notices start once the sender is connected.
   */
  notices?: boolean;
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

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Keeps only well-formed per-symbol trading conditions from a server answer; anything else is dropped. */
export function parseInstruments(raw: unknown): Record<string, TradingConditions> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, TradingConditions> = {};
  for (const [symbol, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z]{6}$/.test(symbol) || typeof v !== "object" || v === null) continue;
    const c = v as Record<string, unknown>;
    if (!num(c.contractSize, 1, 10_000_000) || !num(c.minLots, 0.0001, 1000) || !num(c.lotStep, 0.0001, 1000) || !num(c.maxLots, 0.0001, 100_000)) continue;
    if ((c.maxLots as number) < (c.minLots as number)) continue;
    if (!num(c.leverage, 1, 1000) || !Number.isInteger(c.leverage)) continue;
    if (!num(c.commissionPerLotPerSide, 0, 1000)) continue;
    let swap: TradingConditions["swap"] = null;
    if (c.swap !== null && c.swap !== undefined) {
      const w = c.swap as Record<string, unknown>;
      if (typeof w !== "object" || !num(w.longPerLot, -10_000, 10_000) || !num(w.shortPerLot, -10_000, 10_000)) continue;
      const triple = w.tripleWeekday === undefined ? 3 : w.tripleWeekday;
      if (!(Number.isInteger(triple) && (triple as number) >= 0 && (triple as number) <= 6)) continue;
      swap = { longPerLot: w.longPerLot as number, shortPerLot: w.shortPerLot as number, tripleWeekday: triple as number };
    }
    out[symbol] = { contractSize: c.contractSize as number, minLots: c.minLots as number, lotStep: c.lotStep as number, maxLots: c.maxLots as number, leverage: c.leverage as number, commissionPerLotPerSide: c.commissionPerLotPerSide as number, swap };
  }
  return Object.keys(out).length ? out : undefined;
}

const MAX_SPAN = 15 * 86_400_000;

/**
 * Keeps only well-formed per-symbol schedules from a server answer: sessions
 * in time order without overlaps, closures with a short plain reason, all
 * within about two weeks. A symbol with any bad entry is dropped as a whole.
 */
export function parseSchedule(raw: unknown): Record<string, Schedule> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, Schedule> = {};
  const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  for (const [symbol, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z]{6}$/.test(symbol) || typeof v !== "object" || v === null) continue;
    const { sessions, closures } = v as Record<string, unknown>;
    if (!Array.isArray(sessions) || sessions.length > 60 || !(closures === undefined || (Array.isArray(closures) && closures.length <= 60))) continue;
    const ok: Schedule = { sessions: [], closures: [] };
    let bad = false, prev = 0;
    for (const x of sessions) {
      const r = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
      if (!time(r.from) || !time(r.to) || (r.to as number) <= (r.from as number) || (r.from as number) < prev || (r.to as number) - (r.from as number) > MAX_SPAN) { bad = true; break; }
      prev = r.to as number; ok.sessions.push({ from: r.from as number, to: r.to as number });
    }
    for (const x of (closures as unknown[] | undefined) ?? []) {
      if (bad) break;
      const r = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
      if (!time(r.from) || !time(r.to) || (r.to as number) <= (r.from as number) || typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 120) { bad = true; break; }
      ok.closures.push({ from: r.from as number, to: r.to as number, reason: r.reason });
    }
    if (!bad) out[symbol] = ok;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface TradingGateway {
  readonly mode: GatewayMode;
  status(): Promise<GatewayStatus>;
  snapshot(accountId: string): Promise<Snapshot>;
  placeOrder(accountId: string, order: OrderRequest): Promise<Snapshot>;
  closePosition(accountId: string, positionId: string, lots?: number): Promise<Snapshot>;
  modifyPosition(accountId: string, positionId: string, protection: PositionChange): Promise<Snapshot>;
  /** Changes the price, stop loss or take profit of a pending order (null removes a level). */
  modifyOrder(accountId: string, orderId: string, change: OrderChange): Promise<Snapshot>;
  cancelOrder(accountId: string, orderId: string): Promise<Snapshot>;
  /**
   * One page of older trades moved to the account archive (chunk 0 is the
   * oldest; the snapshot's `state.archived.chunks` says how many there are).
   */
  archivedDeals(accountId: string, index: number): Promise<HistoryPage>;
  /** Sets a price alert the server checks on every fresh bid, also with the terminal closed. Alerts never trade. */
  addAlert(accountId: string, alert: AlertRequest): Promise<Snapshot>;
  removeAlert(accountId: string, alertId: string): Promise<Snapshot>;
  /** Changes which notices the trader receives (only the given kinds). Never trades. */
  setNotices(accountId: string, change: NoticeChange): Promise<Snapshot>;
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
  addAlert() { return this.fail(); }
  removeAlert() { return this.fail(); }
  setNotices() { return this.fail(); }
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
      const s = await this.call<Partial<GatewayStatus> & { markets?: unknown; instruments?: unknown; schedule?: unknown }>("GET", "/v1/status");
      const markets = parseMarkets(s?.markets), instruments = parseInstruments(s?.instruments), schedule = parseSchedule(s?.schedule);
      return { connected: true, priceFeed: !!s?.priceFeed, execution: !!s?.execution, message: (typeof s?.message === "string" && s.message) || "Connected.", ...(markets ? { markets } : {}), ...(instruments ? { instruments } : {}), ...(schedule ? { schedule } : {}), ...(s?.notices === true ? { notices: true } : {}) };
    } catch (e) {
      return { connected: false, priceFeed: false, execution: false, message: e instanceof Error ? e.message : "Not connected." };
    }
  }
  snapshot(id: string) { return this.call<Snapshot>("GET", `/v1/accounts/${encodeURIComponent(id)}`); }
  placeOrder(id: string, order: OrderRequest) { return this.call<Snapshot>("POST", `/v1/accounts/${encodeURIComponent(id)}/orders`, order, order.clientId); }
  closePosition(id: string, positionId: string, lots?: number) { return this.call<Snapshot>("POST", `/v1/accounts/${encodeURIComponent(id)}/positions/${encodeURIComponent(positionId)}/close`, lots === undefined ? {} : { lots }); }
  modifyPosition(id: string, positionId: string, protection: PositionChange) { return this.call<Snapshot>("PATCH", `/v1/accounts/${encodeURIComponent(id)}/positions/${encodeURIComponent(positionId)}`, protection); }
  modifyOrder(id: string, orderId: string, change: OrderChange) { return this.call<Snapshot>("PATCH", `/v1/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`, change); }
  cancelOrder(id: string, orderId: string) { return this.call<Snapshot>("DELETE", `/v1/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`); }
  addAlert(id: string, alert: AlertRequest) { return this.call<Snapshot>("POST", `/v1/accounts/${encodeURIComponent(id)}/alerts`, alert); }
  removeAlert(id: string, alertId: string) { return this.call<Snapshot>("DELETE", `/v1/accounts/${encodeURIComponent(id)}/alerts/${encodeURIComponent(alertId)}`); }
  setNotices(id: string, change: NoticeChange) { return this.call<Snapshot>("PATCH", `/v1/accounts/${encodeURIComponent(id)}/notices`, change); }
  async archivedDeals(id: string, index: number) {
    if (!Number.isInteger(index) || index < 0) throw new EngineError("bad_request", "chunk must be a whole number from 0.");
    return parseHistoryPage(await this.call<unknown>("GET", `/v1/accounts/${encodeURIComponent(id)}/history?chunk=${index}`), id, index);
  }
}

export class LocalGatewayAdapter implements TradingGateway {
  readonly mode = "local" as const;
  /** `notices`: whether a notice sender is connected next to this venue (default false). */
  constructor(private venue: LocalVenue, private options: { notices?: boolean } = {}) {}
  async status(): Promise<GatewayStatus> { const live = Object.keys(this.venue.quotes).length > 0; return { connected: true, priceFeed: live, execution: live, message: live ? "Local engine running." : "Local engine waiting for prices.", markets: this.venue.markets(), instruments: this.venue.conditions(), schedule: this.venue.schedule(), ...(this.options.notices ? { notices: true } : {}) }; }
  snapshot(id: string) { return this.venue.snapshot(id); }
  placeOrder(id: string, order: OrderRequest) { return this.venue.place(id, order); }
  closePosition(id: string, positionId: string, lots?: number) { return this.venue.close(id, positionId, lots); }
  modifyPosition(id: string, positionId: string, p: PositionChange) { return this.venue.modify(id, positionId, p); }
  modifyOrder(id: string, orderId: string, change: OrderChange) { return this.venue.modifyOrder(id, orderId, change); }
  cancelOrder(id: string, orderId: string) { return this.venue.cancel(id, orderId); }
  archivedDeals(id: string, index: number) { return this.venue.history(id, index); }
  addAlert(id: string, alert: AlertRequest) { return this.venue.addAlert(id, alert); }
  removeAlert(id: string, alertId: string) { return this.venue.removeAlert(id, alertId); }
  setNotices(id: string, change: NoticeChange) { return this.venue.setNotices(id, change); }
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

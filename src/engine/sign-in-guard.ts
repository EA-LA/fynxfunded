import { EngineError } from "./types";

/**
 * Failed sign-in protection for the engine's HTTP adapter.
 *
 * The per-user request limits (rate-limit.ts) only start after a valid
 * sign-in, so a script sending requests with made-up or stolen-and-expired
 * tokens is never slowed down by them: every such request costs a token check.
 * This guard counts failed sign-ins (answers 401 `unauthorized`) per visitor
 * address and, after too many in a short time, refuses that address for a
 * while: 429 `too_many_failed_sign_ins` with `retryAfterSeconds` and a
 * `Retry-After` header, before the request body is read or the token checked.
 *
 * Where the visitor's address comes from depends on the host, so it is an
 * owner setting (FYNX_ENGINE_CLIENT_ADDRESS) and the guard stays OFF until it
 * is given. Behind Cloud Run or a load balancer every request arrives from the
 * proxy, so "socket" there would put every trader behind one address; use the
 * forwarded header instead and count the proxies you run (`trustedHops`):
 * the address is read that many entries from the RIGHT of X-Forwarded-For,
 * because entries further left are written by the visitor and can be faked.
 *
 *  - "socket": the TCP connection's address (engine reached directly).
 *  - "x-forwarded-for" / "x-forwarded-for:N": the N-th address from the right
 *    (default 1 = the one added by the proxy in front of the engine).
 *
 * IPv6 visitors are counted per /64 network (one home or phone connection
 * usually owns a whole /64), IPv4 per address; "::ffff:1.2.3.4" is 1.2.3.4.
 * Successful requests do not wipe the count (an attacker could mix in one
 * valid token). Memory is bounded; in-process only, like the request limits.
 */

export type ClientAddressMode = { from: "socket" } | { from: "x-forwarded-for"; trustedHops: number };

export interface SignInGuardLimits {
  /** Failed sign-ins allowed from one address within `windowSeconds`. */
  maxFailures: number;
  windowSeconds: number;
  /** How long the address is refused once over the limit. */
  blockSeconds: number;
}

/** Generous on purpose: an office or mobile network shares one address among many traders. */
export const DEFAULT_SIGN_IN_GUARD: SignInGuardLimits = { maxFailures: 30, windowSeconds: 300, blockSeconds: 900 };

/** Most different addresses remembered before the oldest are forgotten. */
export const MAX_TRACKED_ADDRESSES = 50_000;

export interface SignInGuardConfig {
  address: ClientAddressMode;
  limits: SignInGuardLimits;
}

export function checkSignInGuardLimits(l: SignInGuardLimits): SignInGuardLimits {
  if (!Number.isInteger(l.maxFailures) || l.maxFailures < 3 || l.maxFailures > 1000) throw new EngineError("bad_settings", "Failed sign-ins allowed must be a whole number from 3 to 1000.");
  if (!Number.isInteger(l.windowSeconds) || l.windowSeconds < 10 || l.windowSeconds > 86_400) throw new EngineError("bad_settings", "The counting window must be 10 to 86400 seconds.");
  if (!Number.isInteger(l.blockSeconds) || l.blockSeconds < 10 || l.blockSeconds > 86_400) throw new EngineError("bad_settings", "The refusal time must be 10 to 86400 seconds.");
  return l;
}

/**
 * Reads FYNX_ENGINE_CLIENT_ADDRESS + FYNX_ENGINE_SIGNIN_LIMIT.
 * Address empty → guard off (null). Limit empty → defaults; "off" → guard off;
 * otherwise "30/300/900" (failures / window seconds / refusal seconds).
 * Returns problems instead of throwing so config.ts lists them with the rest.
 */
export function parseSignInGuard(rawAddress: string | undefined, rawLimit: string | undefined): { guard: SignInGuardConfig | null; problems: string[] } {
  const problems: string[] = [];
  const addr = rawAddress?.trim().toLowerCase() ?? "";
  const lim = rawLimit?.trim() ?? "";
  if (lim.toLowerCase() === "off") return { guard: null, problems };

  let limits = DEFAULT_SIGN_IN_GUARD;
  if (lim) {
    const m = /^(\d{1,4})\/(\d{1,5})\/(\d{1,5})$/.exec(lim);
    if (!m) problems.push(`FYNX_ENGINE_SIGNIN_LIMIT should look like 30/300/900 (failed sign-ins / within seconds / refused for seconds) or off (got "${lim}").`);
    else {
      limits = { maxFailures: Number(m[1]), windowSeconds: Number(m[2]), blockSeconds: Number(m[3]) };
      try { checkSignInGuardLimits(limits); } catch (e) { problems.push(`FYNX_ENGINE_SIGNIN_LIMIT: ${(e as Error).message}`); }
    }
  }

  if (!addr) return { guard: null, problems };
  let address: ClientAddressMode | null = null;
  if (addr === "socket") address = { from: "socket" };
  else {
    const m = /^x-forwarded-for(?::(\d{1,2}))?$/.exec(addr);
    const hops = m ? Number(m[1] ?? 1) : NaN;
    if (m && hops >= 1 && hops <= 5) address = { from: "x-forwarded-for", trustedHops: hops };
    else problems.push(`FYNX_ENGINE_CLIENT_ADDRESS must be "socket", "x-forwarded-for" or "x-forwarded-for:N" with N from 1 to 5 proxies (got "${rawAddress?.trim()}").`);
  }
  return { guard: address && !problems.length ? { address, limits } : null, problems };
}

/** Plain description for the readiness check and the start-up log. */
export function describeSignInGuard(g: SignInGuardConfig | null): string {
  if (!g) return "Failed sign-in protection is off: set FYNX_ENGINE_CLIENT_ADDRESS (x-forwarded-for on Cloud Run or behind a load balancer, socket when reached directly).";
  const where = g.address.from === "socket" ? "the connection's address" : `X-Forwarded-For, ${g.address.trustedHops} proxy hop(s) from the right`;
  const { maxFailures, windowSeconds, blockSeconds } = g.limits;
  return `Failed sign-in protection: ${maxFailures} failed sign-ins within ${windowSeconds} s from one address (read from ${where}) refuse it for ${blockSeconds} s.`;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Expands an IPv6 address to 8 groups, or null when it is not one. */
function ipv6Groups(text: string): string[] | null {
  if (!/^[0-9a-f:.]{2,45}$/.test(text) || (text.match(/::/g) ?? []).length > 1) return null;
  let s = text;
  // Embedded IPv4 at the end (e.g. 64:ff9b::1.2.3.4) becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (!IPV4.test(v4[1])) return null;
    const n = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((n[0] << 8) | n[1]).toString(16) + ":" + ((n[2] << 8) | n[3]).toString(16);
  }
  const [head, tail] = s.includes("::") ? s.split("::") : [s, null];
  const a = head ? head.split(":") : [];
  const b = tail === null ? [] : tail ? tail.split(":") : [];
  const missing = 8 - a.length - b.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  const groups = [...a, ...Array(tail === null ? 0 : missing).fill("0"), ...b];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => g.replace(/^0+(?=.)/, ""));
}

/**
 * Turns a raw address into the key the guard counts: IPv4 as is, IPv6 as its
 * /64 network ("2001:db8:1:2::/64"), IPv4-mapped IPv6 as the IPv4 address.
 * Ports, brackets and zone ids are removed. Null when it is not an address.
 */
export function addressKey(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s || s.length > 64) return null;
  if (s.startsWith("[")) { const end = s.indexOf("]"); if (end < 0) return null; s = s.slice(1, end); }
  else if (/^\d+\.\d+\.\d+\.\d+:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  s = s.replace(/%[0-9a-z._-]+$/, "");
  if (s.startsWith("::ffff:") && IPV4.test(s.slice(7))) s = s.slice(7);
  if (IPV4.test(s)) return s;
  const g = ipv6Groups(s);
  if (!g) return null;
  if (g.slice(0, 6).join(":") === "0:0:0:0:0:ffff") return [parseInt(g[6], 16) >> 8, parseInt(g[6], 16) & 255, parseInt(g[7], 16) >> 8, parseInt(g[7], 16) & 255].join(".");
  return `${g.slice(0, 4).join(":")}::/64`;
}

/** The parts of a request the guard reads (node:http, Express and Firebase requests fit). */
export interface AddressSource {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null } | null;
}

/** The visitor's address key for this request, or null when it cannot be told (then the guard skips it). */
export function clientAddress(req: AddressSource, mode: ClientAddressMode): string | null {
  if (mode.from === "socket") return addressKey(req.socket?.remoteAddress);
  const key = Object.keys(req.headers).find(k => k.toLowerCase() === "x-forwarded-for");
  const value = key === undefined ? undefined : req.headers[key];
  const list = (Array.isArray(value) ? value.join(",") : value ?? "").split(",").map(s => s.trim()).filter(Boolean);
  // Too few entries means the request did not come through the proxies we were told about.
  if (list.length < mode.trustedHops) return null;
  return addressKey(list[list.length - mode.trustedHops]);
}

export interface SignInGuardHealth {
  /** Requests refused because their address was blocked, since start. */
  refused: number;
  /** Times an address went over the limit, since start. */
  blocks: number;
  /** Addresses refused right now. */
  blockedNow: number;
  lastBlockedAt: number | null;
  tracked: number;
}

interface Entry { failures: number[]; blockedUntil: number }

export class SignInGuard {
  private readonly entries = new Map<string, Entry>();
  private refused = 0;
  private blocks = 0;
  private lastBlockedAt: number | null = null;
  readonly limits: SignInGuardLimits;

  constructor(limits: SignInGuardLimits = DEFAULT_SIGN_IN_GUARD, private readonly clock: () => number = Date.now, private readonly maxKeys = MAX_TRACKED_ADDRESSES) {
    this.limits = checkSignInGuardLimits({ ...limits });
  }

  /** Is this address allowed to try right now? Counts refusals. */
  check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const e = this.entries.get(key);
    const now = this.clock();
    if (!e || e.blockedUntil <= now) return { ok: true };
    this.refused += 1;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((e.blockedUntil - now) / 1000)) };
  }

  /** Records one failed sign-in; returns true when this failure starts a block. */
  fail(key: string): boolean {
    const now = this.clock();
    const windowMs = this.limits.windowSeconds * 1000;
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= this.maxKeys) this.forget(now);
      e = { failures: [], blockedUntil: 0 };
    } else {
      // Map order = last activity, so the oldest are forgotten first.
      this.entries.delete(key);
    }
    this.entries.set(key, e);
    if (e.blockedUntil > now) return false;
    // A clock that goes backwards keeps old failures in the window rather than dropping them early.
    e.failures = e.failures.filter(t => now - t < windowMs);
    e.failures.push(now);
    if (e.failures.length < this.limits.maxFailures) return false;
    e.failures = [];
    e.blockedUntil = now + this.limits.blockSeconds * 1000;
    this.blocks += 1;
    this.lastBlockedAt = now;
    return true;
  }

  health(): SignInGuardHealth {
    const now = this.clock();
    let blockedNow = 0;
    for (const e of this.entries.values()) if (e.blockedUntil > now) blockedNow += 1;
    return { refused: this.refused, blocks: this.blocks, blockedNow, lastBlockedAt: this.lastBlockedAt, tracked: this.entries.size };
  }

  private forget(now: number) {
    const windowMs = this.limits.windowSeconds * 1000;
    for (const [k, e] of this.entries) if (e.blockedUntil <= now && e.failures.every(t => now - t >= windowMs)) this.entries.delete(k);
    if (this.entries.size >= this.maxKeys) {
      const drop = this.entries.size - Math.floor(this.maxKeys * 0.9);
      let i = 0;
      for (const k of this.entries.keys()) { if (i++ >= drop) break; this.entries.delete(k); }
    }
  }
}

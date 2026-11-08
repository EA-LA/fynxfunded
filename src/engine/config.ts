import { buildSpecs, type PairLike, type SpecOptions, type VenueSettings } from "./venue";
import { FOREX_HOURS, type Closure } from "./hours";
import { checkAllowedOrigins } from "./http-adapter";
import { EngineError, type SwapRates } from "./types";

/**
 * Reads the engine host's settings from environment variables, so the owner
 * switches the engine on by filling in values instead of editing code.
 * Business numbers (leverage, commission, maximum lots, allowed websites) have
 * no defaults: the host refuses to start until each is given, and every
 * missing or wrong value is listed in one message.
 *
 * | Variable | Example | Required |
 * | --- | --- | --- |
 * | FYNX_ENGINE_LEVERAGE | 30 | yes (1–1000) |
 * | FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE | 3.5 | yes (USD, 0–100) |
 * | FYNX_ENGINE_MAX_LOTS | 50 | yes (0.01–1000) |
 * | FYNX_ENGINE_ALLOWED_ORIGINS | https://www.fynxfunded.com,https://fynxfunded.com | yes |
 * | FYNX_ENGINE_MAX_QUOTE_AGE_MS | 15000 | no (default 15000, 1000–300000) |
 * | FYNX_ENGINE_SWAP | {"EURUSD":{"longPerLot":-6.2,"shortPerLot":1.1}} | no (no swap) |
 * | FYNX_ENGINE_CLOSURES | [{"from":"2026-12-25T00:00:00Z","to":"2026-12-26T00:00:00Z","reason":"Christmas Day"}] | no |
 * | FYNX_ENGINE_BASE_PATH | /engine | no |
 */

export interface EngineConfig {
  settings: VenueSettings & SpecOptions;
  http: { allowedOrigins: string[]; basePath?: string };
}

export const ENGINE_ENV = {
  leverage: "FYNX_ENGINE_LEVERAGE",
  commission: "FYNX_ENGINE_COMMISSION_PER_LOT_PER_SIDE",
  maxLots: "FYNX_ENGINE_MAX_LOTS",
  origins: "FYNX_ENGINE_ALLOWED_ORIGINS",
  quoteAge: "FYNX_ENGINE_MAX_QUOTE_AGE_MS",
  swap: "FYNX_ENGINE_SWAP",
  closures: "FYNX_ENGINE_CLOSURES",
  basePath: "FYNX_ENGINE_BASE_PATH",
} as const;

type Env = Record<string, string | undefined>;

function number(env: Env, name: string, problems: string[], range: [number, number], fallback?: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    problems.push(`${name} is missing.`);
    return NaN;
  }
  const n = Number(raw);
  if (!/^-?\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n) || n < range[0] || n > range[1]) problems.push(`${name} must be a number from ${range[0]} to ${range[1]} (got "${raw}").`);
  return n;
}

function json(env: Env, name: string, problems: string[]): unknown {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { problems.push(`${name} is not valid JSON.`); return undefined; }
}

function readSwap(value: unknown, problems: string[]): Record<string, SwapRates> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) { problems.push(`${ENGINE_ENV.swap} must be an object like {"EURUSD":{"longPerLot":-6.2,"shortPerLot":1.1}}.`); return undefined; }
  const out: Record<string, SwapRates> = {};
  for (const [symbol, r] of Object.entries(value as Record<string, unknown>)) {
    const rates = r as Record<string, unknown> | null;
    const keys = rates && typeof rates === "object" ? Object.keys(rates) : [];
    if (!rates || typeof rates !== "object" || typeof rates.longPerLot !== "number" || typeof rates.shortPerLot !== "number"
      || (rates.tripleWeekday !== undefined && typeof rates.tripleWeekday !== "number")
      || keys.some(k => !["longPerLot", "shortPerLot", "tripleWeekday"].includes(k))) {
      problems.push(`${ENGINE_ENV.swap}: ${symbol} needs longPerLot and shortPerLot numbers (and optionally tripleWeekday 0–6).`);
      continue;
    }
    out[symbol] = { longPerLot: rates.longPerLot, shortPerLot: rates.shortPerLot, ...(rates.tripleWeekday !== undefined ? { tripleWeekday: rates.tripleWeekday as number } : {}) };
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

function readClosures(value: unknown, problems: string[]): Closure[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) { problems.push(`${ENGINE_ENV.closures} must be a list like [{"from":"2026-12-25T00:00:00Z","to":"2026-12-26T00:00:00Z","reason":"Christmas Day"}].`); return undefined; }
  const out: Closure[] = [];
  value.forEach((c, i) => {
    const item = c as Record<string, unknown> | null;
    const from = item && typeof item.from === "string" && ISO.test(item.from) ? Date.parse(item.from) : NaN;
    const to = item && typeof item.to === "string" && ISO.test(item.to) ? Date.parse(item.to) : NaN;
    const reason = item && typeof item.reason === "string" ? item.reason.trim() : "";
    if (!Number.isFinite(from) || !Number.isFinite(to)) problems.push(`${ENGINE_ENV.closures} #${i + 1}: from and to must be UTC times like 2026-12-25T00:00:00Z.`);
    else if (to <= from) problems.push(`${ENGINE_ENV.closures} #${i + 1}: "to" must be after "from".`);
    else if (!reason || reason.length > 80) problems.push(`${ENGINE_ENV.closures} #${i + 1}: give a short reason the trader will see (1–80 characters).`);
    else out.push({ from, to, reason });
  });
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Reads and checks every engine setting. Throws `bad_settings` listing all
 * problems at once, so the host never starts half-configured.
 */
export function readEngineConfig(env: Env, pairs: PairLike[]): EngineConfig {
  const problems: string[] = [];
  const leverage = number(env, ENGINE_ENV.leverage, problems, [1, 1000]);
  const commissionPerLotPerSide = number(env, ENGINE_ENV.commission, problems, [0, 100]);
  const maxLots = number(env, ENGINE_ENV.maxLots, problems, [0.01, 1000]);
  const maxQuoteAgeMs = number(env, ENGINE_ENV.quoteAge, problems, [1000, 300_000], 15_000);
  if (Number.isFinite(leverage) && !Number.isInteger(leverage)) problems.push(`${ENGINE_ENV.leverage} must be a whole number.`);
  if (Number.isFinite(maxQuoteAgeMs) && !Number.isInteger(maxQuoteAgeMs)) problems.push(`${ENGINE_ENV.quoteAge} must be a whole number of milliseconds.`);

  let allowedOrigins: string[] = [];
  const rawOrigins = env[ENGINE_ENV.origins]?.trim();
  if (!rawOrigins) problems.push(`${ENGINE_ENV.origins} is missing (the website addresses allowed to call the engine, comma separated).`);
  else {
    try { allowedOrigins = checkAllowedOrigins(rawOrigins.split(",").map(s => s.trim()).filter(Boolean)); }
    catch (e) { problems.push(`${ENGINE_ENV.origins}: ${(e as Error).message}`); }
  }

  const swap = readSwap(json(env, ENGINE_ENV.swap, problems), problems);
  const closures = readClosures(json(env, ENGINE_ENV.closures, problems), problems);
  const basePath = env[ENGINE_ENV.basePath]?.trim() || undefined;
  if (basePath && !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(basePath)) problems.push(`${ENGINE_ENV.basePath} must look like /engine.`);

  const settings: VenueSettings & SpecOptions = {
    leverage, commissionPerLotPerSide, maxLots, maxQuoteAgeMs,
    ...(closures && closures.length ? { hours: { ...FOREX_HOURS, closures } } : {}),
    ...(swap && Object.keys(swap).length ? { swap } : {}),
  };
  // Let the catalogue check the swap symbols and rates exactly as the venue will.
  if (!problems.length) {
    try { buildSpecs(pairs, settings); } catch (e) { problems.push((e as Error).message); }
  }
  if (problems.length) throw new EngineError("bad_settings", `The trading engine is not configured yet:\n- ${problems.join("\n- ")}`);
  return { settings, http: { allowedOrigins, ...(basePath ? { basePath } : {}) } };
}

import { EngineError } from "./types";
import { readPath } from "./feed-config";
import { NEWS_CONTROL_DOC, NEWS_MAX_EVENTS, NEWS_MAX_MINUTES, NEWS_TITLE_MAX } from "./news";
import type { FirestoreLike } from "./firestore-store";

/**
 * Automatic news calendar import ("fill engineControl/news from a provider").
 *
 * The restricted news windows (`news.ts`) read their release times from the
 * Firestore document `engineControl/news`. Instead of copying them by hand,
 * the owner can connect the economic-calendar provider they license by
 * filling in environment variables on the engine host — no code:
 *
 * | Variable | Example | Required |
 * | --- | --- | --- |
 * | FYNX_NEWS_URL | https://api.calendar-provider.test/v1/events?from={from}&to={to}&token={key} | yes (https://) |
 * | FYNX_NEWS_API_KEY | (the provider's key; a secret on the host, never in git) | no |
 * | FYNX_NEWS_HEADERS | {"Authorization":"Bearer {key}"} | no (for providers that want the key in a header) |
 * | FYNX_NEWS_FIELDS | {"items":"data","title":"event","time":"date","currency":"currency","impact":"impact"} | yes |
 * | FYNX_NEWS_IMPACT | High | no (comma list of impact values to keep; empty = every release) |
 * | FYNX_NEWS_TIME_UNIT | iso | no (iso, iso-utc, s or ms; default iso) |
 * | FYNX_NEWS_EVERY_MINUTES | 360 | no (15–1440; default 360 = every 6 hours) |
 * | FYNX_NEWS_DAYS | 14 | no (days ahead to import, 1–60; default 14) |
 *
 * `FYNX_NEWS_FIELDS` keys: `title` and `time` (required), `currency` and/or
 * `country` (at least one; countries such as "US" or "Euro Area" are turned
 * into their currency), `impact`, `id` (the provider's own event id) and
 * `items` (path to the list; without it the answer itself must be a list).
 * Paths use dots: `data.events`. URL placeholders: `{key}` (URL-encoded),
 * `{from}` / `{to}` (YYYY-MM-DD, UTC), `{from_unix}` / `{to_unix}` (seconds).
 * Time units: `iso` needs a time zone (`2026-12-04T13:30:00Z` or `+01:00`);
 * `iso-utc` also reads times without a zone as UTC (`2026-12-04 13:30:00`).
 *
 * What it writes: only the `events` list (and an `imported` summary) of
 * `engineControl/news`. Events the owner typed by hand (no `source: "import"`)
 * are never changed or removed, and an imported release at the same minute on
 * a currency the owner already listed is left out (the owner's entry wins,
 * with its own minutes). `enforce`, `holdPending` and the window minutes stay
 * exactly as the owner set them: importing never switches the rule on.
 *
 * Fail-safe: a failed download, an unreadable answer or an answer with no
 * releases keeps the calendar as it is (nothing is removed); the host logs it
 * and tries again at the next interval. The API key never appears in logs,
 * errors or the readiness report.
 */

type Env = Record<string, string | undefined>;

export const NEWS_IMPORT_ENV = {
  url: "FYNX_NEWS_URL",
  key: "FYNX_NEWS_API_KEY",
  headers: "FYNX_NEWS_HEADERS",
  fields: "FYNX_NEWS_FIELDS",
  impact: "FYNX_NEWS_IMPACT",
  timeUnit: "FYNX_NEWS_TIME_UNIT",
  every: "FYNX_NEWS_EVERY_MINUTES",
  days: "FYNX_NEWS_DAYS",
} as const;

export interface NewsFieldMap {
  items?: string;
  title: string;
  time: string;
  currency?: string;
  country?: string;
  impact?: string;
  id?: string;
}

export type NewsTimeUnit = "iso" | "iso-utc" | "s" | "ms";

export interface NewsImportConfig {
  /** Download address for the period, with the key filled in. Never log it: use `safeUrl`. */
  url(from: number, to: number): string;
  /** Address with the key replaced by "•••". */
  safeUrl: string;
  /** Request headers (may contain the key). Never log the values. */
  headers: Record<string, string>;
  fields: NewsFieldMap;
  /** Lower-case impact values to keep, or null for every release. */
  impact: string[] | null;
  timeUnit: NewsTimeUnit;
  everyMs: number;
  days: number;
  /** The key, only so it can be blanked out of error texts. */
  readonly secret: string;
}

/** An event as written to `engineControl/news` (`source: "import"` marks it as the importer's). */
export interface ImportedEvent {
  id: string;
  title: string;
  at: string;
  currencies: string[];
  source: "import";
}

const PATH = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const KEY_OK = /^[\x21-\x7e]+$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FIELD_KEYS = ["items", "title", "time", "currency", "country", "impact", "id"] as const;

/**
 * Country names and codes calendar providers use, and the currency they move.
 * Euro-area members map to EUR. Anything else is skipped and named.
 */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  us: "USD", usa: "USD", "united states": "USD",
  eu: "EUR", ez: "EUR", ea: "EUR", emu: "EUR", "euro area": "EUR", "euro zone": "EUR", eurozone: "EUR", "european union": "EUR",
  de: "EUR", germany: "EUR", fr: "EUR", france: "EUR", it: "EUR", italy: "EUR", es: "EUR", spain: "EUR",
  nl: "EUR", netherlands: "EUR", be: "EUR", belgium: "EUR", at: "EUR", austria: "EUR", pt: "EUR", portugal: "EUR",
  ie: "EUR", ireland: "EUR", fi: "EUR", finland: "EUR", gr: "EUR", greece: "EUR",
  gb: "GBP", uk: "GBP", "united kingdom": "GBP",
  jp: "JPY", japan: "JPY", ch: "CHF", switzerland: "CHF", ca: "CAD", canada: "CAD",
  au: "AUD", australia: "AUD", nz: "NZD", "new zealand": "NZD", cn: "CNY", china: "CNY",
  se: "SEK", sweden: "SEK", no: "NOK", norway: "NOK", dk: "DKK", denmark: "DKK",
  pl: "PLN", poland: "PLN", hu: "HUF", hungary: "HUF", cz: "CZK", "czech republic": "CZK", czechia: "CZK",
  tr: "TRY", turkey: "TRY", "türkiye": "TRY", za: "ZAR", "south africa": "ZAR", mx: "MXN", mexico: "MXN",
  sg: "SGD", singapore: "SGD", hk: "HKD", "hong kong": "HKD",
};

/** Currencies known to the importer (3-letter codes given directly are checked against this list). */
const KNOWN_CURRENCIES = new Set(Object.values(COUNTRY_CURRENCY));

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function readFields(raw: string | undefined, problems: string[]): NewsFieldMap {
  const empty: NewsFieldMap = { title: "", time: "" };
  const name = NEWS_IMPORT_ENV.fields;
  if (!raw?.trim()) { problems.push(`${name} is missing (where the title, time and currency are in each release, e.g. {"items":"data","title":"event","time":"date","currency":"currency","impact":"impact"}).`); return empty; }
  let v: unknown;
  try { v = JSON.parse(raw); } catch { problems.push(`${name} is not valid JSON.`); return empty; }
  if (!v || typeof v !== "object" || Array.isArray(v)) { problems.push(`${name} must be an object like {"title":"event","time":"date","currency":"currency"}.`); return empty; }
  const o = v as Record<string, unknown>;
  const unknownKeys = Object.keys(o).filter(k => !(FIELD_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length) problems.push(`${name}: unknown key(s) ${unknownKeys.join(", ")} (use ${FIELD_KEYS.join(", ")}).`);
  const out: NewsFieldMap = { ...empty };
  for (const k of FIELD_KEYS) {
    if (o[k] === undefined) {
      if (k === "title" || k === "time") problems.push(`${name}: "${k}" is required (a path like "${k === "title" ? "event" : "date"}").`);
      continue;
    }
    if (typeof o[k] !== "string" || !PATH.test(o[k] as string)) problems.push(`${name}: "${k}" must be a path like "data" or "event.name".`);
    else out[k] = o[k] as string;
  }
  if (o.currency === undefined && o.country === undefined) problems.push(`${name}: give "currency" or "country" (which currency each release moves).`);
  return out;
}

/**
 * Reads and checks every calendar-import setting. Returns null when
 * FYNX_NEWS_URL is not set (import off). Throws `bad_settings` listing all
 * problems at once; the key is never part of the message.
 */
export function readNewsImportConfig(env: Env): NewsImportConfig | null {
  const rawUrl = env[NEWS_IMPORT_ENV.url]?.trim() || "";
  if (!rawUrl) return null;
  const problems: string[] = [];
  const key = env[NEWS_IMPORT_ENV.key]?.trim() || "";
  if (key && (!KEY_OK.test(key) || /["\\]/.test(key))) problems.push(`${NEWS_IMPORT_ENV.key} contains spaces, quotes or backslashes; check it was copied correctly.`);

  const fill = (text: string, from: number, to: number, encode: boolean) => text
    .replace(/\{key\}/g, encode ? encodeURIComponent(key) : key)
    .replace(/\{from\}/g, day(from)).replace(/\{to\}/g, day(to))
    .replace(/\{from_unix\}/g, String(Math.floor(from / 1000))).replace(/\{to_unix\}/g, String(Math.floor(to / 1000)));
  const safeUrl = rawUrl.replace(/\{key\}/g, "•••");
  let parsed: URL | null = null;
  try { parsed = new URL(fill(rawUrl, 0, 0, true)); } catch { problems.push(`${NEWS_IMPORT_ENV.url} is not a valid address.`); }
  if (parsed) {
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) problems.push(`${NEWS_IMPORT_ENV.url} must start with https:// (encrypted); http:// is only allowed for localhost tests.`);
    if (parsed.username || parsed.password) problems.push(`${NEWS_IMPORT_ENV.url} must not contain a user name or password; use {key} with ${NEWS_IMPORT_ENV.key}.`);
  }

  const headers: Record<string, string> = {};
  const rawHeaders = env[NEWS_IMPORT_ENV.headers]?.trim();
  if (rawHeaders) {
    let h: unknown;
    try { h = JSON.parse(rawHeaders); } catch { problems.push(`${NEWS_IMPORT_ENV.headers} is not valid JSON.`); }
    if (h !== undefined) {
      if (!h || typeof h !== "object" || Array.isArray(h)) problems.push(`${NEWS_IMPORT_ENV.headers} must be an object like {"Authorization":"Bearer {key}"}.`);
      else for (const [n, val] of Object.entries(h as Record<string, unknown>)) {
        if (!HEADER_NAME.test(n) || typeof val !== "string" || !val.trim() || val.length > 500 || /[\r\n]/.test(val)) problems.push(`${NEWS_IMPORT_ENV.headers}: "${n}" needs a one-line text value (header names: letters, digits and dashes).`);
        else headers[n] = val.replace(/\{key\}/g, key);
      }
    }
  }
  const usesKey = /\{key\}/.test(rawUrl) || /\{key\}/.test(rawHeaders ?? "");
  if (usesKey && !key) problems.push(`{key} is used but ${NEWS_IMPORT_ENV.key} is missing.`);
  if (key && !usesKey) problems.push(`${NEWS_IMPORT_ENV.key} is set but not used: put {key} in ${NEWS_IMPORT_ENV.url} or ${NEWS_IMPORT_ENV.headers} where the provider expects it.`);

  const fields = readFields(env[NEWS_IMPORT_ENV.fields], problems);

  const rawImpact = env[NEWS_IMPORT_ENV.impact]?.trim();
  const impact = rawImpact ? [...new Set(rawImpact.split(",").map(s => s.trim().toLowerCase()).filter(Boolean))] : null;
  if (impact && !impact.length) problems.push(`${NEWS_IMPORT_ENV.impact} must list impact values separated by commas, e.g. "High" or "3".`);
  if (impact && !fields.impact) problems.push(`${NEWS_IMPORT_ENV.impact} is set but ${NEWS_IMPORT_ENV.fields} has no "impact" path.`);

  const rawUnit = (env[NEWS_IMPORT_ENV.timeUnit]?.trim() || "iso").toLowerCase();
  if (!["iso", "iso-utc", "s", "ms"].includes(rawUnit)) problems.push(`${NEWS_IMPORT_ENV.timeUnit} must be iso, iso-utc, s or ms (got "${rawUnit}").`);

  const whole = (name: string, fallback: number, lo: number, hi: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < lo || n > hi) { problems.push(`${name} must be a whole number from ${lo} to ${hi} (got "${raw}").`); return fallback; }
    return n;
  };
  const every = whole(NEWS_IMPORT_ENV.every, 360, 15, 1440);
  const days = whole(NEWS_IMPORT_ENV.days, 14, 1, 60);

  if (problems.length) throw new EngineError("bad_settings", `The news calendar import is not configured yet:\n- ${problems.join("\n- ")}`);
  return {
    url: (from, to) => fill(rawUrl, from, to, true),
    safeUrl, headers, fields, impact: impact && impact.length ? impact : null,
    timeUnit: rawUnit as NewsTimeUnit, everyMs: every * 60_000, days, secret: key,
  };
}

/** Plain lines describing the import for the readiness report (no key). */
export function describeNewsImport(c: NewsImportConfig): string[] {
  const f = c.fields;
  return [
    `Address: ${c.safeUrl}${Object.keys(c.headers).length ? ` (headers: ${Object.keys(c.headers).join(", ")})` : ""}`,
    `Releases read from: ${f.items ? `list "${f.items}", ` : ""}title "${f.title}", time "${f.time}" (${c.timeUnit})${f.currency ? `, currency "${f.currency}"` : ""}${f.country ? `, country "${f.country}"` : ""}${f.id ? `, id "${f.id}"` : ""}.`,
    c.impact ? `Only releases whose "${f.impact}" is ${c.impact.map(v => `"${v}"`).join(" or ")} are imported.` : "Every release is imported (set FYNX_NEWS_IMPACT, e.g. High, to keep only high-impact ones).",
    `Downloads the next ${c.days} day(s) on start and every ${c.everyMs % 3_600_000 ? `${c.everyMs / 60_000} minutes` : `${c.everyMs / 3_600_000} hour(s)`} into engineControl/news; your own events, enforce and holdPending are never changed. Run with --news to download once and see what would be imported (nothing is written).`,
  ];
}

function readWhen(v: unknown, unit: NewsTimeUnit): number | null {
  if (unit === "s" || unit === "ms") {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
    const ms = unit === "s" ? n * 1000 : n;
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null;
  }
  if (typeof v !== "string") return null;
  let t = v.trim();
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(t);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return null;
  if (!zoned) {
    if (unit !== "iso-utc") return null;
    t = `${t}Z`;
  }
  const ms = Date.parse(t.replace(" ", "T"));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  // eslint-disable-next-line no-control-regex
  const t = String(raw).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > NEWS_TITLE_MAX ? `${t.slice(0, NEWS_TITLE_MAX - 1).trimEnd()}…` : t;
}

/** Currencies from a currency field ("USD", "usd, cad", ["USD"]) and/or a country field ("US", "Euro Area"). */
function readCurrencies(currency: unknown, country: unknown): string[] | null {
  const out: string[] = [];
  const add = (c: string) => { if (!out.includes(c)) out.push(c); };
  const list = (v: unknown) => (typeof v === "string" ? v.split(/[,;/]+/) : Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  for (const c of list(currency)) {
    if (typeof c !== "string" || !c.trim()) continue;
    const code = c.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && KNOWN_CURRENCIES.has(code)) add(code);
    else if (COUNTRY_CURRENCY[c.trim().toLowerCase()]) add(COUNTRY_CURRENCY[c.trim().toLowerCase()]);
  }
  for (const c of list(country)) {
    if (typeof c !== "string") continue;
    const mapped = COUNTRY_CURRENCY[c.trim().toLowerCase()];
    if (mapped) add(mapped);
  }
  return out.length ? out : null;
}

/** Short stable fingerprint (FNV-1a) so a release keeps its id between downloads. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface CalendarReading {
  /** Releases to import, in time order. */
  events: ImportedEvent[];
  /** Items found in the provider's answer. */
  found: number;
  /** Left out because of the impact filter. */
  lowImpact: number;
  /** Left out because they are already over or beyond the import period. */
  outsidePeriod: number;
  /** Items that could not be read (named in `problems`, at most 10 lines). */
  unreadable: number;
  problems: string[];
}

/**
 * Turns the provider's answer into calendar events. Pure. Throws when the
 * answer has no list where `items` points (the setting or the provider is
 * wrong; the calendar is then kept as it is).
 */
export function parseCalendar(body: unknown, c: Pick<NewsImportConfig, "fields" | "impact" | "timeUnit" | "days">, now: number): CalendarReading {
  const f = c.fields;
  const items = f.items ? readPath(body, f.items) : body;
  if (!Array.isArray(items)) throw new Error(f.items ? `The answer has no list at "${f.items}" (check FYNX_NEWS_FIELDS "items").` : `The answer is not a list; set "items" in FYNX_NEWS_FIELDS to where the releases are.`);
  const problems: string[] = [];
  const note = (text: string) => { if (problems.length < 10) problems.push(text); };
  const earliest = now - NEWS_MAX_MINUTES * 60_000, latest = now + c.days * 86_400_000;
  const byId = new Map<string, ImportedEvent>();
  let lowImpact = 0, outsidePeriod = 0, unreadable = 0;
  items.forEach((item, i) => {
    const n = i + 1;
    if (c.impact) {
      const level = readPath(item, f.impact!);
      if (level === undefined || level === null || !c.impact.includes(String(level).trim().toLowerCase())) { lowImpact += 1; return; }
    }
    const title = cleanTitle(readPath(item, f.title));
    const at = readWhen(readPath(item, f.time), c.timeUnit);
    const currencies = readCurrencies(f.currency ? readPath(item, f.currency) : undefined, f.country ? readPath(item, f.country) : undefined);
    if (!title) { unreadable += 1; note(`Release ${n} has no title; skipped.`); return; }
    if (at === null) { unreadable += 1; note(`Release ${n} ("${title}") has no readable time${c.timeUnit === "iso" ? " (times need a zone like Z; use FYNX_NEWS_TIME_UNIT=iso-utc if the provider gives UTC without one)" : ""}; skipped.`); return; }
    if (!currencies) { unreadable += 1; note(`Release ${n} ("${title}") has no currency or country the engine knows; skipped.`); return; }
    if (at < earliest || at > latest) { outsidePeriod += 1; return; }
    const rawId = f.id ? readPath(item, f.id) : undefined;
    const own = (typeof rawId === "string" || typeof rawId === "number") && /^[A-Za-z0-9_:.-]{1,60}$/.test(String(rawId)) ? String(rawId) : null;
    const iso = new Date(at).toISOString();
    const id = own ? `imp-${own}` : `imp-${iso.slice(0, 16).replace(/[-:]/g, "")}-${currencies.join("")}-${fingerprint(title.toLowerCase())}`;
    byId.set(id, { id, title, at: iso, currencies, source: "import" });
  });
  const events = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { events, found: items.length, lowImpact, outsidePeriod, unreadable, problems };
}

const isImported = (e: unknown) => typeof e === "object" && e !== null && (e as Record<string, unknown>).source === "import";

function minuteOf(v: unknown): number | null {
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : v instanceof Date ? v.getTime()
    : typeof v === "object" && v !== null && typeof (v as { toMillis?: unknown }).toMillis === "function" ? Number((v as { toMillis(): number }).toMillis()) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 60_000) : null;
}

function ownCurrencies(v: unknown): string[] {
  const list = typeof v === "string" ? v.split(/[\s,]+/) : Array.isArray(v) ? v : [];
  return list.filter((c): c is string => typeof c === "string").map(c => c.trim().toUpperCase()).filter(Boolean);
}

export interface ImportSummary {
  at: string;
  source: string;
  events: number;
  /** Imported releases left out because the owner already lists them. */
  alreadyListed: number;
  problems: string[];
}

/**
 * The new `engineControl/news` document: everything the owner set is kept
 * (enforce, holdPending, minutes, hand-typed events); the previous imported
 * events are replaced by `events`. Pure.
 */
export function mergeImported(existing: Record<string, unknown> | undefined, events: ImportedEvent[], meta: { at: number; source: string; problems: string[] }): Record<string, unknown> {
  const base = existing ?? {};
  const own = Array.isArray(base.events) ? base.events.filter(e => !isImported(e)) : [];
  const taken = new Map<number, string[]>();
  for (const e of own) {
    if (typeof e !== "object" || e === null) continue;
    const m = minuteOf((e as Record<string, unknown>).at);
    if (m !== null) taken.set(m, [...(taken.get(m) ?? []), ...ownCurrencies((e as Record<string, unknown>).currencies)]);
  }
  let alreadyListed = 0;
  const fresh = events.filter(e => {
    const listed = taken.get(Math.floor(Date.parse(e.at) / 60_000));
    if (listed && e.currencies.some(c => listed.includes(c))) { alreadyListed += 1; return false; }
    return true;
  });
  const room = Math.max(0, NEWS_MAX_EVENTS - own.length);
  const problems = [...meta.problems];
  if (fresh.length > room) problems.push(`Only ${room} of ${fresh.length} imported releases fit (the calendar holds ${NEWS_MAX_EVENTS} events); the latest ones were left out. Set FYNX_NEWS_IMPACT or a shorter FYNX_NEWS_DAYS.`);
  const kept = fresh.slice(0, room);
  const imported: ImportSummary = { at: new Date(meta.at).toISOString(), source: meta.source, events: kept.length, alreadyListed, problems: problems.slice(0, 10) };
  return { ...base, events: [...own, ...kept], imported };
}

export type NewsFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Largest provider answer read (2 MB). */
export const NEWS_IMPORT_MAX_BYTES = 2_000_000;

export interface NewsImportResult {
  ok: boolean;
  /** true when engineControl/news was rewritten. */
  written: boolean;
  /** Releases written (0 when nothing was written). */
  imported: number;
  alreadyListed: number;
  reading: CalendarReading | null;
  /** Why nothing was written (download failed, no releases…). */
  error: string | null;
}

export interface NewsImportHealth {
  source: string;
  lastRunAt: number | null;
  lastWrittenAt: number | null;
  lastImported: number;
  failuresInARow: number;
  lastError: string | null;
  problems: string[];
}

export interface NewsImporterOptions {
  config: NewsImportConfig;
  /** Firestore (the Admin SDK's `getFirestore()`); only the calendar document is written. Not needed for `preview`. */
  db?: FirestoreLike;
  fetch: NewsFetch;
  clock?: () => number;
  /** Longest wait for the provider (default 15 s). */
  timeoutMs?: number;
  /** After every run (written or not). */
  onResult?: (r: NewsImportResult) => void;
}

/** Downloads the provider's calendar and keeps the imported part of engineControl/news up to date. */
export class NewsImporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<NewsImportResult> | null = null;
  private lastRunAt: number | null = null;
  private lastWrittenAt: number | null = null;
  private lastImported = 0;
  private failures = 0;
  private lastError: string | null = null;
  private problems: string[] = [];
  private readonly clock: () => number;
  readonly source: string;

  constructor(private readonly o: NewsImporterOptions) {
    this.clock = o.clock ?? Date.now;
    let host = "provider";
    try { host = new URL(o.config.url(0, 0)).hostname; } catch { /* checked by readNewsImportConfig */ }
    this.source = host;
  }

  private blank(text: string): string {
    const s = this.o.config.secret;
    let out = text.split("\n")[0].slice(0, 300);
    if (s) out = out.split(s).join("•••").split(encodeURIComponent(s)).join("•••");
    return out;
  }

  /** Downloads and parses once without writing anything (`npm run engine:check -- --news`). */
  async preview(): Promise<CalendarReading> {
    const now = this.clock();
    const c = this.o.config;
    const limit = this.o.timeoutMs ?? 15_000;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The wait is capped even if the download ignores the abort signal.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller?.abort(); reject(new Error(`The calendar provider did not answer within ${Math.round(limit / 1000)} s.`)); }, limit);
    });
    const download = (async () => {
      const res = await this.o.fetch(c.url(now, now + c.days * 86_400_000), { headers: { Accept: "application/json", ...c.headers }, ...(controller ? { signal: controller.signal } : {}) });
      if (!res.ok) throw new Error(`The calendar provider answered HTTP ${res.status}${res.status === 401 || res.status === 403 ? " (check FYNX_NEWS_API_KEY and where {key} goes)" : ""}.`);
      const text = await res.text();
      if (text.length > NEWS_IMPORT_MAX_BYTES) throw new Error(`The answer is larger than ${NEWS_IMPORT_MAX_BYTES / 1_000_000} MB; use a shorter FYNX_NEWS_DAYS or a provider filter in the address.`);
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new Error("The answer is not JSON."); }
      return parseCalendar(body, c, now);
    })();
    download.catch(() => {}); // a late failure after the timeout is not an unhandled rejection
    try {
      return await Promise.race([download, timeout]);
    } catch (e) {
      throw new Error(this.blank(String((e as Error)?.message ?? e)));
    } finally {
      clearTimeout(timer);
    }
  }

  /** One import: download, then rewrite the imported events. Never throws; overlapping calls share one run. */
  run(): Promise<NewsImportResult> {
    this.running ??= (async (): Promise<NewsImportResult> => {
      const now = this.clock();
      this.lastRunAt = now;
      let reading: CalendarReading | null = null;
      try {
        reading = await this.preview();
        if (!reading.events.length) {
          const why = reading.found
            ? `None of the ${reading.found} releases could be imported (${reading.lowImpact} below the impact filter, ${reading.outsidePeriod} outside the period, ${reading.unreadable} unreadable); the calendar was kept as it is.`
            : "The provider returned no releases for the period; the calendar was kept as it is.";
          throw new Error(why);
        }
        const db = this.o.db;
        if (!db) throw new Error("No Firestore connected; nothing was written.");
        const ref = db.collection(NEWS_CONTROL_DOC.collection).doc(NEWS_CONTROL_DOC.id);
        let doc: Record<string, unknown> = {};
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          doc = mergeImported(snap.exists ? snap.data() : undefined, reading!.events, { at: now, source: this.source, problems: reading!.problems });
          tx.set(ref, doc);
        });
        const summary = doc.imported as ImportSummary;
        this.failures = 0;
        this.lastError = null;
        this.lastWrittenAt = now;
        this.lastImported = summary.events;
        this.problems = summary.problems;
        const r: NewsImportResult = { ok: true, written: true, imported: summary.events, alreadyListed: summary.alreadyListed, reading, error: null };
        this.o.onResult?.(r);
        return r;
      } catch (e) {
        this.failures += 1;
        this.lastError = this.blank(String((e as Error)?.message ?? e));
        if (reading) this.problems = reading.problems;
        const r: NewsImportResult = { ok: false, written: false, imported: 0, alreadyListed: 0, reading, error: this.lastError };
        this.o.onResult?.(r);
        return r;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Imports now and then every `config.everyMs`. */
  start(): Promise<NewsImportResult> {
    if (!this.timer) {
      this.timer = setInterval(() => { void this.run(); }, Math.max(60_000, this.o.config.everyMs));
      (this.timer as { unref?: () => void }).unref?.();
    }
    return this.run();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  health(): NewsImportHealth {
    return { source: this.source, lastRunAt: this.lastRunAt, lastWrittenAt: this.lastWrittenAt, lastImported: this.lastImported, failuresInARow: this.failures, lastError: this.lastError, problems: [...this.problems] };
  }
}

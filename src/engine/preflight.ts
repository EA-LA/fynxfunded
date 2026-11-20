import type { PairLike } from "./venue";
import { spreadRuleFor, spreadRuleText, traderSpreadPips, type SpreadRule } from "./spread";
import type { Quote } from "./types";
import { readEngineConfig } from "./config";
import { describeRateLimits } from "./rate-limit";
import { describeSignInGuard } from "./sign-in-guard";
import { PAUSE_ENV, readPauseSetting } from "./trading-pause";
import { createFeedFromEnv, readFeedConfig, type SocketFactory } from "./feed-config";
import type { FeedHealth, RejectReason } from "./quote-feed";
import { describeNewsImport, NEWS_IMPORT_ENV, NewsImporter, readNewsImportConfig, type CalendarReading, type NewsFetch } from "./news-import";

/**
 * "Is the engine ready to run?" check for the owner, before going live.
 * `npm run engine:check` reads the host's environment variables and lists, in
 * plain words, what is set and what is still missing; `npm run engine:check --
 * --feed 20` also connects the price feed for 20 seconds and reports which
 * pairs received prices. It never places orders, never writes to Firestore and
 * never prints the API key. `--news` downloads the economic calendar once (when
 * FYNX_NEWS_URL is set) and lists what would be imported, without writing.
 */

type Env = Record<string, string | undefined>;

export type CheckStatus = "ready" | "missing" | "warn" | "info";
export interface CheckItem { name: string; status: CheckStatus; detail: string[] }

const lines = (e: unknown) => String((e as Error)?.message ?? e).split("\n").slice(1).map(l => l.replace(/^- /, ""));

/** One line about the "pause new trading" switch for the readiness list. */
export function describePauseSetting(env: Env): string {
  const p = readPauseSetting(env[PAUSE_ENV], 0);
  return p
    ? `New trading starts PAUSED (${PAUSE_ENV}: "${p.reason}"); closing and cancelling work. Remove the setting and restart to resume.`
    : `New trading not paused. To pause every account without a restart, set the Firestore document engineControl/trading to { paused: true, reason: "..." } (read every 10 s); add holdPending: true to keep waiting pending orders from filling during the pause.`;
}

/** One line about the spread markup setting for the readiness list. */
export function describeSpread(spread: Record<string, SpreadRule> | undefined): string {
  if (!spread || !Object.keys(spread).length) return "Prices: the provider's bid/ask unchanged (no spread markup; FYNX_ENGINE_SPREAD not set).";
  const own = Object.keys(spread).filter(k => k !== "*");
  const all = spread["*"] ? `every pair: ${spreadRuleText(spread["*"]).toLowerCase()}` : "pairs without their own setting: no markup";
  return `Prices: ${all}${own.length ? `; own setting for ${own.join(", ")}` : ""} (FYNX_ENGINE_SPREAD). Traders see the same price in the terminal and the contract specification.`;
}

export function engineChecklist(env: Env, pairs: PairLike[]): CheckItem[] {
  const items: CheckItem[] = [];

  try {
    const c = readEngineConfig(env, pairs);
    const s = c.settings;
    items.push({ name: "Trading settings", status: "ready", detail: [
      `Leverage 1:${s.leverage}, commission $${s.commissionPerLotPerSide} per lot per side, up to ${s.maxLots} lots per order, prices older than ${Math.round((s.maxQuoteAgeMs ?? 15_000) / 1000)} s refused.`,
      s.swap ? `Overnight swap set for ${Object.keys(s.swap).length} pair(s).` : "No overnight swap charged (FYNX_ENGINE_SWAP not set).",
      describeSpread(s.spread),
      s.hours && "closures" in s.hours && s.hours.closures?.length ? `${s.hours.closures.length} holiday/maintenance closure(s) entered.` : "No holiday closures entered (FYNX_ENGINE_CLOSURES); add the provider's calendar when you have it.",
      `Websites allowed to call the engine: ${c.http.allowedOrigins.join(", ")}.`,
      describeRateLimits(c.rateLimits) + (c.rateLimits && !env.FYNX_ENGINE_RATE_LIMITS?.trim() ? " (defaults; change with FYNX_ENGINE_RATE_LIMITS)" : ""),
      describeSignInGuard(c.signInGuard),
      describePauseSetting(env),
      "News windows: read from the Firestore document engineControl/news every 60 s (release title, time, currencies; information only until it says enforce: true; with holdPending: true waiting pending orders on the affected pairs also wait until the window ends). Fill it from your economic calendar.",
    ] });
  } catch (e) {
    items.push({ name: "Trading settings", status: "missing", detail: lines(e) });
  }

  try {
    const f = readFeedConfig(env, pairs);
    const sample = ["EURUSD", "USDJPY"].filter(s => f.symbolMap[s]).map(s => `${s} → ${f.symbolMap[s]}`).join(", ");
    items.push({ name: "Price feed settings", status: "ready", detail: [
      `Address: ${f.safeUrl}`,
      f.subscribe ? "A subscribe message is sent after connecting." : "No subscribe message (the address alone selects the prices).",
      `${pairs.length} pairs requested from the provider${sample ? ` (${sample})` : ""}.`,
      `Prices read from: symbol "${f.fields.symbol}", bid "${f.fields.bid}", ask "${f.fields.ask}", ${f.fields.time ? `time "${f.fields.time}" (${f.timeUnit})` : "time = arrival time"}.`,
      "Run with --feed 20 to connect for 20 seconds and see real prices arrive.",
    ] });
  } catch (e) {
    items.push({ name: "Price feed settings", status: "missing", detail: lines(e) });
  }

  const onGoogleCloud = Boolean(env.K_SERVICE || env.FUNCTION_TARGET || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.FIREBASE_CONFIG);
  const keyFile = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  items.push(onGoogleCloud || keyFile
    ? { name: "Firebase access", status: "ready", detail: [onGoogleCloud ? "Running on Google Cloud: the engine uses the service's own account." : "GOOGLE_APPLICATION_CREDENTIALS points at a service-account key file."] }
    : { name: "Firebase access", status: "warn", detail: ["No Google Cloud credentials found. Run the engine on Cloud Run (recommended) or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file kept outside git."] });

  const allow = env.FYNX_ENGINE_ALLOW_TRADING?.trim();
  items.push(allow === "true"
    ? { name: "Trading switch", status: "info", detail: ["FYNX_ENGINE_ALLOW_TRADING=true: orders are accepted for accounts that also have tradingEnabled on their account document, a paid order and a running challenge."] }
    : { name: "Trading switch", status: "info", detail: [`FYNX_ENGINE_ALLOW_TRADING is ${allow ? `"${allow}"` : "not set"}: the engine refuses every order. Prices, accounts, alerts and history still work. Set it to true only when you decide to open trading.`] });

  const notices = env.FYNX_ENGINE_EMAIL_NOTICES?.trim();
  items.push(notices === "true"
    ? { name: "Email notices", status: "info", detail: ["FYNX_ENGINE_EMAIL_NOTICES=true: notices (alert fired, stop hit, loss limit…) are written to the Firestore \"mail\" collection. They only reach traders once the Firebase \"Trigger Email\" extension (or another mail worker) is installed on that collection."] }
    : { name: "Email notices", status: "info", detail: [`FYNX_ENGINE_EMAIL_NOTICES is ${notices ? `"${notices}"` : "not set"}: no emails are sent and the terminal says so. Set it to true after installing an email sender on the "mail" collection.`] });

  const catchUp = env.FYNX_ENGINE_LEDGER_CATCHUP_DAYS?.trim();
  const catchUpDays = catchUp ? Number(catchUp) : 7;
  items.push(catchUp && (!/^\d+$/.test(catchUp) || catchUpDays > 30)
    ? { name: "Trade catch-up", status: "missing", detail: [`FYNX_ENGINE_LEDGER_CATCHUP_DAYS must be a whole number of days from 0 to 30 (got "${catchUp}"; 0 = off).`] }
    : { name: "Trade catch-up", status: "info", detail: [catchUpDays === 0
      ? "FYNX_ENGINE_LEDGER_CATCHUP_DAYS=0: on start, trades closed before the last stop are not re-sent to the dashboard."
      : `On start, trades closed in the last ${catchUpDays} day(s) are re-sent to the dashboard's trades list (ones already there are left as they are)${catchUp ? "" : "; change with FYNX_ENGINE_LEDGER_CATCHUP_DAYS (0 = off)"}.`] });

  const port = env.PORT?.trim();
  items.push({ name: "Port", status: "info", detail: [port ? `Listens on port ${port}.` : "PORT not set: listens on 8080 (Cloud Run sets PORT for you)."] });

  try {
    const n = readNewsImportConfig(env);
    items.push(n
      ? { name: "News calendar import", status: "ready", detail: describeNewsImport(n) }
      : { name: "News calendar import", status: "info", detail: [`${NEWS_IMPORT_ENV.url} not set: release times are only what you type into engineControl/news. To download them from your economic-calendar provider, fill in the FYNX_NEWS_* settings (docs/ENGINE-READINESS.md).`] });
  } catch (e) {
    items.push({ name: "News calendar import", status: "missing", detail: lines(e) });
  }

  return items;
}

export interface FeedProbe {
  seconds: number;
  /** Pairs that received at least one accepted price, with the last one. */
  received: { symbol: string; count: number; bid: number; ask: number; spreadPips: number; traderSpreadPips?: number }[];
  /** Pairs with no accepted price during the probe. */
  silent: string[];
  rejected: Partial<Record<RejectReason, number>>;
  reconnects: number;
  lastError: string | null;
  verdict: "live" | "partial" | "none";
}

/**
 * Connects a feed for `seconds`, then disconnects and reports what arrived.
 * Places no orders and stores nothing.
 */
export async function probeFeed(
  feed: { subscribe(symbols: string[], onQuote: (q: Quote) => void): () => void; health(): FeedHealth },
  pairs: PairLike[],
  seconds: number,
  wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  spread?: Record<string, SpreadRule>,
): Promise<FeedProbe> {
  const last = new Map<string, { count: number; q: Quote }>();
  const stop = feed.subscribe(pairs.map(p => p.symbol), q => {
    const prev = last.get(q.symbol);
    last.set(q.symbol, { count: (prev?.count ?? 0) + 1, q });
  });
  try { await wait(seconds * 1000); } finally { stop(); }
  const h = feed.health();
  const received = pairs.filter(p => last.has(p.symbol)).map(p => {
    const { count, q } = last.get(p.symbol)!;
    const spreadPips = Math.round(((q.ask - q.bid) / p.pipSize) * 10) / 10;
    const rule = spreadRuleFor(spread, p.symbol);
    return { symbol: p.symbol, count, bid: q.bid, ask: q.ask, spreadPips, ...(rule ? { traderSpreadPips: traderSpreadPips(spreadPips, rule) } : {}) };
  });
  const silent = pairs.filter(p => !last.has(p.symbol)).map(p => p.symbol);
  const rejected = Object.fromEntries(Object.entries(h.rejected).filter(([, n]) => n > 0)) as FeedProbe["rejected"];
  return { seconds, received, silent, rejected, reconnects: h.reconnects, lastError: h.lastError, verdict: !received.length ? "none" : silent.length ? "partial" : "live" };
}

const MARK: Record<CheckStatus, string> = { ready: "[ready]  ", missing: "[missing]", warn: "[check]  ", info: "[info]   " };

const REJECT_WORDS: Record<RejectReason, string> = {
  unknown_symbol: "pair name not recognised (check FYNX_FEED_SYMBOL_FORMAT / FYNX_FEED_SYMBOL_MAP)",
  bad_number: "missing or invalid bid/ask/time (check FYNX_FEED_FIELDS and FYNX_FEED_TIME_UNIT)",
  crossed: "bid above ask",
  wide_spread: "spread wider than FYNX_FEED_MAX_SPREAD_PIPS",
  future_time: "time in the future (check FYNX_FEED_TIME_UNIT or the server clock)",
  out_of_order: "older than the previous price",
  parse_error: "not readable JSON",
};

export interface NewsProbe { reading: CalendarReading | null; error: string | null; now: number }

function newsProbeLines(p: NewsProbe): string[] {
  if (p.error || !p.reading) return ["", `[missing] News calendar test: ${p.error ?? "no answer."}`];
  const r = p.reading;
  const out = ["", `${r.events.length ? MARK.ready : MARK.missing} News calendar test (downloaded once, nothing written)`,
    `            ${r.found} release(s) in the answer; ${r.events.length} would be imported${r.lowImpact ? `, ${r.lowImpact} below the impact filter` : ""}${r.outsidePeriod ? `, ${r.outsidePeriod} outside the period` : ""}${r.unreadable ? `, ${r.unreadable} unreadable` : ""}.`];
  for (const e of r.events.slice(0, 8)) out.push(`            ${e.at.slice(0, 16).replace("T", " ")} UTC  ${e.currencies.join(", ")}  ${e.title}`);
  if (r.events.length > 8) out.push(`            … and ${r.events.length - 8} more.`);
  for (const pr of r.problems) out.push(`            ${pr}`);
  return out;
}

export function formatReport(items: CheckItem[], probe?: FeedProbe | null, probeError?: string | null, news?: NewsProbe | null): string {
  const out: string[] = ["FYNX trading engine: readiness check", ""];
  for (const it of items) {
    out.push(`${MARK[it.status]} ${it.name}`);
    for (const d of it.detail) out.push(`            ${d}`);
  }
  if (probeError) out.push("", `[missing] Price feed test: ${probeError}`);
  if (probe) {
    out.push("", `${probe.verdict === "live" ? MARK.ready : probe.verdict === "partial" ? MARK.warn : MARK.missing} Price feed test (${probe.seconds} s)`);
    out.push(`            Prices received for ${probe.received.length} of ${probe.received.length + probe.silent.length} pairs.`);
    for (const r of probe.received.slice(0, 8)) out.push(`            ${r.symbol}: ${r.count} price(s), last bid ${r.bid} / ask ${r.ask}, spread ${r.spreadPips} pips${r.traderSpreadPips !== undefined ? ` (traders get about ${r.traderSpreadPips} pips with FYNX_ENGINE_SPREAD)` : ""}`);
    if (probe.received.length > 8) out.push(`            … and ${probe.received.length - 8} more pairs.`);
    if (probe.silent.length) out.push(`            No price for: ${probe.silent.join(", ")}.`);
    for (const [k, n] of Object.entries(probe.rejected)) out.push(`            Refused ${n} message(s): ${REJECT_WORDS[k as RejectReason]}.`);
    if (probe.reconnects) out.push(`            Reconnected ${probe.reconnects} time(s).`);
    if (probe.lastError) out.push(`            Last connection problem: ${probe.lastError}.`);
  }
  if (news) out.push(...newsProbeLines(news));
  const missing = items.filter(i => i.status === "missing").length + (probeError || probe?.verdict === "none" ? 1 : 0) + (news && (news.error || !news.reading?.events.length) ? 1 : 0);
  out.push("", missing ? `Not ready: ${missing} item(s) above need a value. Nothing was started.` : "Ready to start: every required setting is in place. Trading stays off until FYNX_ENGINE_ALLOW_TRADING=true and an account is switched on.");
  return out.join("\n");
}

/** Entry point used by `npm run engine:check`. Returns the exit code (0 ready, 1 not ready). */
export async function runEngineCheck(o: { env: Env; argv: string[]; pairs: PairLike[]; socket?: SocketFactory; fetch?: NewsFetch; write: (text: string) => void; wait?: (ms: number) => Promise<void>; clock?: () => number }): Promise<number> {
  const items = engineChecklist(o.env, o.pairs);
  let probe: FeedProbe | null = null, probeError: string | null = null;
  const i = o.argv.indexOf("--feed");
  if (i >= 0) {
    const seconds = Number(o.argv[i + 1] ?? 20);
    const secs = Number.isFinite(seconds) && seconds >= 3 && seconds <= 300 ? Math.round(seconds) : 20;
    if (items.find(x => x.name === "Price feed settings")?.status !== "ready") probeError = "fill in the price feed settings first.";
    else if (!o.socket) probeError = "this Node.js has no WebSocket; use Node 22 or newer.";
    else {
      const { feed } = createFeedFromEnv(o.env, o.pairs, { socket: o.socket });
      let spread: Record<string, SpreadRule> | undefined;
      try { spread = readEngineConfig(o.env, o.pairs).settings.spread; } catch { spread = undefined; }
      probe = await probeFeed(feed, o.pairs, secs, o.wait, spread);
    }
  }
  let news: NewsProbe | null = null;
  if (o.argv.includes("--news")) {
    const now = (o.clock ?? Date.now)();
    const status = items.find(x => x.name === "News calendar import")?.status;
    if (status !== "ready") news = { reading: null, error: status === "missing" ? "fix the news calendar settings first." : `set ${NEWS_IMPORT_ENV.url} and the other FYNX_NEWS_* settings first.`, now };
    else if (!o.fetch) news = { reading: null, error: "this Node.js has no fetch; use Node 22 or newer.", now };
    else {
      const importer = new NewsImporter({ config: readNewsImportConfig(o.env)!, fetch: o.fetch, ...(o.clock ? { clock: o.clock } : {}) });
      try { news = { reading: await importer.preview(), error: null, now }; } catch (e) { news = { reading: null, error: String((e as Error)?.message ?? e), now }; }
    }
  }
  o.write(formatReport(items, probe, probeError, news));
  const notReady = items.some(x => x.status === "missing") || Boolean(probeError) || probe?.verdict === "none" || Boolean(news && (news.error || !news.reading?.events.length));
  return notReady ? 1 : 0;
}

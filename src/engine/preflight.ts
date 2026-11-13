import type { PairLike } from "./venue";
import type { Quote } from "./types";
import { readEngineConfig } from "./config";
import { describeRateLimits } from "./rate-limit";
import { describeSignInGuard } from "./sign-in-guard";
import { PAUSE_ENV, readPauseSetting } from "./trading-pause";
import { createFeedFromEnv, readFeedConfig, type SocketFactory } from "./feed-config";
import type { FeedHealth, RejectReason } from "./quote-feed";

/**
 * "Is the engine ready to run?" check for the owner, before going live.
 * `npm run engine:check` reads the host's environment variables and lists, in
 * plain words, what is set and what is still missing; `npm run engine:check --
 * --feed 20` also connects the price feed for 20 seconds and reports which
 * pairs received prices. It never places orders, never writes to Firestore and
 * never prints the API key.
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
    : `New trading not paused. To pause every account without a restart, set the Firestore document engineControl/trading to { paused: true, reason: "..." } (read every 10 s).`;
}

export function engineChecklist(env: Env, pairs: PairLike[]): CheckItem[] {
  const items: CheckItem[] = [];

  try {
    const c = readEngineConfig(env, pairs);
    const s = c.settings;
    items.push({ name: "Trading settings", status: "ready", detail: [
      `Leverage 1:${s.leverage}, commission $${s.commissionPerLotPerSide} per lot per side, up to ${s.maxLots} lots per order, prices older than ${Math.round((s.maxQuoteAgeMs ?? 15_000) / 1000)} s refused.`,
      s.swap ? `Overnight swap set for ${Object.keys(s.swap).length} pair(s).` : "No overnight swap charged (FYNX_ENGINE_SWAP not set).",
      s.hours && "closures" in s.hours && s.hours.closures?.length ? `${s.hours.closures.length} holiday/maintenance closure(s) entered.` : "No holiday closures entered (FYNX_ENGINE_CLOSURES); add the provider's calendar when you have it.",
      `Websites allowed to call the engine: ${c.http.allowedOrigins.join(", ")}.`,
      describeRateLimits(c.rateLimits) + (c.rateLimits && !env.FYNX_ENGINE_RATE_LIMITS?.trim() ? " (defaults; change with FYNX_ENGINE_RATE_LIMITS)" : ""),
      describeSignInGuard(c.signInGuard),
      describePauseSetting(env),
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

  return items;
}

export interface FeedProbe {
  seconds: number;
  /** Pairs that received at least one accepted price, with the last one. */
  received: { symbol: string; count: number; bid: number; ask: number; spreadPips: number }[];
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
    return { symbol: p.symbol, count, bid: q.bid, ask: q.ask, spreadPips: Math.round(((q.ask - q.bid) / p.pipSize) * 10) / 10 };
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

export function formatReport(items: CheckItem[], probe?: FeedProbe | null, probeError?: string | null): string {
  const out: string[] = ["FYNX trading engine: readiness check", ""];
  for (const it of items) {
    out.push(`${MARK[it.status]} ${it.name}`);
    for (const d of it.detail) out.push(`            ${d}`);
  }
  if (probeError) out.push("", `[missing] Price feed test: ${probeError}`);
  if (probe) {
    out.push("", `${probe.verdict === "live" ? MARK.ready : probe.verdict === "partial" ? MARK.warn : MARK.missing} Price feed test (${probe.seconds} s)`);
    out.push(`            Prices received for ${probe.received.length} of ${probe.received.length + probe.silent.length} pairs.`);
    for (const r of probe.received.slice(0, 8)) out.push(`            ${r.symbol}: ${r.count} price(s), last bid ${r.bid} / ask ${r.ask}, spread ${r.spreadPips} pips`);
    if (probe.received.length > 8) out.push(`            … and ${probe.received.length - 8} more pairs.`);
    if (probe.silent.length) out.push(`            No price for: ${probe.silent.join(", ")}.`);
    for (const [k, n] of Object.entries(probe.rejected)) out.push(`            Refused ${n} message(s): ${REJECT_WORDS[k as RejectReason]}.`);
    if (probe.reconnects) out.push(`            Reconnected ${probe.reconnects} time(s).`);
    if (probe.lastError) out.push(`            Last connection problem: ${probe.lastError}.`);
  }
  const missing = items.filter(i => i.status === "missing").length + (probeError || probe?.verdict === "none" ? 1 : 0);
  out.push("", missing ? `Not ready: ${missing} item(s) above need a value. Nothing was started.` : "Ready to start: every required setting is in place. Trading stays off until FYNX_ENGINE_ALLOW_TRADING=true and an account is switched on.");
  return out.join("\n");
}

/** Entry point used by `npm run engine:check`. Returns the exit code (0 ready, 1 not ready). */
export async function runEngineCheck(o: { env: Env; argv: string[]; pairs: PairLike[]; socket?: SocketFactory; write: (text: string) => void; wait?: (ms: number) => Promise<void> }): Promise<number> {
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
      probe = await probeFeed(feed, o.pairs, secs, o.wait);
    }
  }
  o.write(formatReport(items, probe, probeError));
  const notReady = items.some(x => x.status === "missing") || Boolean(probeError) || probe?.verdict === "none";
  return notReady ? 1 : 0;
}

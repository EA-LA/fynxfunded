import { checkConsistency, effectiveFloor, type ConsistencyResult, type RulePlan } from "@/lib/ruleCalculator";
import { previousReset } from "@/lib/tradingDayClock";
import type { PhaseChoice } from "@/lib/challengeSimulator";
import {
  looksLikeHeader,
  MAX_TRADE_RESULTS,
  parseMoney,
  parseTradeResults,
  pickDelimiter,
  PROFIT_COLUMN,
  splitDelimited,
} from "@/lib/tradeResultsImport";

/**
 * "Replay my record day by day" on the Rules page. A trader's closed-trade
 * results are played back in their real order (grouped into the same
 * 22:00 UTC trading days the daily loss limit uses when dates are given) against
 * the published schedule, so they can see exactly which day would have passed
 * a phase, broken a loss limit or still left work to do.
 *
 * Educational only: it works from closed results, so floating losses on open
 * trades (which the real check includes) are not visible. Nothing is saved or sent.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;
const DAY_MS = 86_400_000;

export interface ReplayTrade {
  /** Close time in ms since 1970 (UTC), or null when the record has no dates. */
  time: number | null;
  /** Profit or loss in USD before charges. */
  value: number;
}

export interface DatedTradesImport {
  trades: ReplayTrade[];
  /** True when every trade has a close time, so trading days follow the 22:00 UTC reset. */
  dated: boolean;
  skipped: string[];
  column: string | null;
  timeColumn: string | null;
  error: string | null;
  truncated: boolean;
}

const DATE_TIME =
  /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:(?:[ T]+|,\s*)(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(z|utc|gmt|[+-]\d{2}:?\d{2})?$/i;

/**
 * Reads a year-first date or date-time ("2026-11-02 14:30", "2026.11.02 14:30:05",
 * "2026-11-02T14:30:00Z", "2026/11/02"). Times without a zone are taken to be
 * `offsetMinutes` ahead of UTC (0 = UTC). A date without a time counts as midday.
 */
export function parseTradeTime(raw: string, offsetMinutes = 0): number | null {
  const s = raw.trim().replace(/^["']|["']$/g, "").trim();
  const m = s.match(DATE_TIME);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = h === undefined ? 12 : Number(h);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = sec === undefined ? 0 : Number(sec);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(local);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null; // e.g. 2026-02-30
  let offset = offsetMinutes;
  if (zone) {
    if (/^(z|utc|gmt)$/i.test(zone)) offset = 0;
    else {
      const digits = zone.replace(":", "");
      const sign = digits[0] === "-" ? -1 : 1;
      offset = sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
    }
  }
  return local - offset * 60_000;
}

const cleanHeader = (h: string) => h.replace(/^["']|["']$/g, "").replace(/\(.*\)/g, "").trim().toLowerCase();

/**
 * Picks the close-time column: "Close Time"/"Exit time" first, then a plain
 * "Time"/"Date" (the last one, because MT5 history lists open time first and
 * close time second), then "Open time" as a last resort.
 */
export function pickTimeColumn(header: string[]): number {
  let best = -1;
  let bestScore = 0;
  header.forEach((raw, i) => {
    const h = cleanHeader(raw);
    const score = /^(close|closing|closed|exit)([\s_-]*(time|date|date[\s_/-]*time|at))?$/.test(h)
      ? 3
      : /^(time|date|datetime|date[\s_/-]*time|timestamp)$/.test(h)
        ? 2
        : /^(open|opening|entry)[\s_-]*(time|date|date[\s_/-]*time)$/.test(h)
          ? 1
          : 0;
    if (score > 0 && score >= bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Splits a header-less "date, result" line; returns null when it isn't one. */
function datedLine(line: string, offsetMinutes: number): { time: number; raw: string } | null {
  for (const d of ["\t", ";", ","]) {
    const cells = splitDelimited(line, d);
    if (cells.length < 2) continue;
    const time = parseTradeTime(cells[0], offsetMinutes);
    if (time === null) continue;
    const rest = cells.slice(1).join(d === "," ? "," : " ").trim();
    return { time, raw: parseMoney(rest) !== null ? rest : cells[cells.length - 1] };
  }
  const m = line.match(/^(.+?)\s+(\S+)$/);
  if (m) {
    const time = parseTradeTime(m[1], offsetMinutes);
    if (time !== null) return { time, raw: m[2] };
  }
  return null;
}

/**
 * Reads pasted text or a broker CSV. With a header row, the profit column and a
 * close-time column are found by name; header-less lines may be "date, result".
 * Anything else falls back to a plain list of results kept in the order given.
 */
export function parseDatedTradeResults(text: string, offsetMinutes = 0): DatedTradesImport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const out: DatedTradesImport = { trades: [], dated: false, skipped: [], column: null, timeColumn: null, error: null, truncated: false };
  if (!lines.length) return out;

  const skip = (raw: string) => {
    if (out.skipped.length < 50) out.skipped.push(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
  };
  const push = (time: number | null, raw: string, original: string) => {
    const value = parseMoney(raw);
    if (value === null) return skip(original);
    if (out.trades.length >= MAX_TRADE_RESULTS) {
      out.truncated = true;
      return;
    }
    out.trades.push({ time, value });
  };

  const delimiter = looksLikeHeader(lines[0]) ? pickDelimiter(lines[0]) : null;
  if (delimiter) {
    const header = splitDelimited(lines[0], delimiter);
    const profit = header.findIndex((h) => PROFIT_COLUMN.test(h.replace(/^["']|["']$/g, "").trim()));
    const timeIndex = pickTimeColumn(header);
    if (profit === -1 || timeIndex === -1) {
      // Same messages and behaviour as the plain list reader.
      const plain = parseTradeResults(text);
      return { ...out, trades: plain.values.map((value) => ({ time: null, value })), skipped: plain.skipped, column: plain.column, error: plain.error, truncated: plain.truncated };
    }
    out.column = header[profit];
    out.timeColumn = header[timeIndex];
    for (const line of lines.slice(1)) {
      const cells = splitDelimited(line, delimiter);
      const cell = cells[profit] ?? "";
      if (cell === "") continue; // Summary or blank rows in broker exports.
      const time = parseTradeTime(cells[timeIndex] ?? "", offsetMinutes);
      if (time === null) {
        skip(cells[timeIndex] || line);
        continue;
      }
      push(time, cell, cell);
    }
    if (!out.trades.length && !out.error) {
      out.error = `Couldn't read the dates in the "${out.timeColumn}" column. Use year-first dates such as 2026-11-02 14:30 or 2026.11.02 14:30:00.`;
    }
    out.dated = out.trades.length > 0;
    return finish(out);
  }

  if (datedLine(lines[0], offsetMinutes) || (lines[1] && PROFIT_COLUMN.test(lines[0]) === false && datedLine(lines[1], offsetMinutes))) {
    for (const line of lines) {
      const d = datedLine(line, offsetMinutes);
      if (d) push(d.time, d.raw, line);
      else skip(line);
    }
    out.dated = out.trades.length > 0;
    return finish(out);
  }

  const plain = parseTradeResults(text);
  return { ...out, trades: plain.values.map((value) => ({ time: null, value })), skipped: plain.skipped, column: plain.column, error: plain.error, truncated: plain.truncated };
}

/** Oldest first; trades with the same time keep the order they were given in. */
function finish(out: DatedTradesImport): DatedTradesImport {
  out.trades = out.trades.map((t, i) => ({ t, i })).sort((a, b) => (a.t.time! - b.t.time!) || a.i - b.i).map(({ t }) => t);
  return out;
}

export type ReplayOutcome = "passed" | "dailyBreach" | "maxBreach" | "unfinished";
export type DayEvent = "phasePassed" | "dailyBreach" | "maxBreach" | "targetWaiting" | null;

export interface ReplayDay {
  /** 1-based position in the whole replay. */
  index: number;
  /** Trading-day number within its phase (counts toward the minimum days). */
  phaseDay: number;
  phase: number;
  /** Calendar date the trading day mostly falls on (YYYY-MM-DD), or null for an undated record. */
  date: string | null;
  trades: number;
  pnl: number;
  startBalance: number;
  endBalance: number;
  /** Lowest closed balance during the day (after any trade). */
  lowBalance: number;
  floor: number;
  binding: "daily" | "maximum";
  /** How far the lowest closed balance stayed above the floor (negative = breach). */
  roomAtLow: number;
  event: DayEvent;
}

export interface PhaseProgress {
  phase: number;
  targetProfit: number;
  profit: number;
  tradingDays: number;
  minDays: number;
  consistency: ConsistencyResult;
}

export interface ReplayResult {
  outcome: ReplayOutcome;
  phases: number[];
  phasesPassed: number;
  days: ReplayDay[];
  /** The day the replay ended on (the pass or the breach), or the last day replayed. */
  finalDay: ReplayDay | null;
  tradesUsed: number;
  tradesTotal: number;
  /** Where the phase in progress stands when the record ran out (unfinished only). */
  progress: PhaseProgress | null;
  /** Day with the least room left above its floor (excluding the breach day). */
  closestCall: ReplayDay | null;
}

export interface ReplayInput {
  plan: RulePlan;
  phase: PhaseChoice;
  trades: ReplayTrade[];
  /** Used only for undated records: how many results make one trading day. */
  tradesPerDay: number;
  /** Round-turn charges per trade, taken off every result. */
  costPerTrade: number;
}

interface DayGroup {
  date: string | null;
  values: number[];
}

/** Trades grouped into trading days: by the 22:00 UTC reset when dated, otherwise N at a time in order. */
export function groupTradingDays(trades: ReplayTrade[], tradesPerDay: number): DayGroup[] {
  if (trades.length && trades.every((t) => t.time !== null)) {
    const groups: DayGroup[] = [];
    let current = NaN;
    for (const t of trades) {
      const start = previousReset(new Date(t.time!)).getTime();
      if (start !== current) {
        current = start;
        groups.push({ date: new Date(start + DAY_MS).toISOString().slice(0, 10), values: [] });
      }
      groups[groups.length - 1].values.push(t.value);
    }
    return groups;
  }
  const size = Math.max(1, Math.trunc(tradesPerDay) || 1);
  const groups: DayGroup[] = [];
  for (let i = 0; i < trades.length; i += size) groups.push({ date: null, values: trades.slice(i, i + size).map((t) => t.value) });
  return groups;
}

export function replayRecord(input: ReplayInput): ReplayResult {
  const { plan, costPerTrade } = input;
  if (!(costPerTrade >= 0)) throw new Error("Charges cannot be negative");
  const phases =
    input.phase === "all"
      ? plan.phases.map((p) => p.phase)
      : [Math.min(Math.max(1, Math.trunc(input.phase) || 1), plan.phases.length)];
  const groups = groupTradingDays(input.trades, input.tradesPerDay);
  const start = plan.accountSize;

  const days: ReplayDay[] = [];
  let phaseIndex = 0;
  let balance = start;
  let dayResults: number[] = [];
  let tradesUsed = 0;
  let outcome: ReplayOutcome = "unfinished";
  let phasesPassed = 0;

  for (const group of groups) {
    const phase = phases[phaseIndex];
    const target = plan.phases[phase - 1].targetProfit;
    const startBalance = balance;
    const { floor, binding } = effectiveFloor(plan, startBalance);
    let low = startBalance;
    let pnl = 0;
    let count = 0;
    let breach: "dailyBreach" | "maxBreach" | null = null;
    for (const v of group.values) {
      const delta = round2(v - costPerTrade);
      balance = round2(balance + delta);
      pnl = round2(pnl + delta);
      low = Math.min(low, balance);
      count++;
      tradesUsed++;
      if (balance < floor - EPS) {
        breach = balance < plan.maxLossFloor - EPS ? "maxBreach" : "dailyBreach";
        break;
      }
    }
    dayResults.push(pnl);
    const day: ReplayDay = {
      index: days.length + 1,
      phaseDay: dayResults.length,
      phase,
      date: group.date,
      trades: count,
      pnl,
      startBalance,
      endBalance: balance,
      lowBalance: low,
      floor,
      binding,
      roomAtLow: round2(low - floor),
      event: breach,
    };
    days.push(day);
    if (breach) {
      outcome = breach;
      break;
    }
    const profit = round2(balance - start);
    if (profit >= target - EPS) {
      const consistency = checkConsistency(dayResults);
      if (dayResults.length >= plan.minDays && consistency.passes) {
        day.event = "phasePassed";
        phasesPassed++;
        if (phaseIndex === phases.length - 1) {
          outcome = "passed";
          break;
        }
        phaseIndex++;
        balance = start;
        dayResults = [];
        continue;
      }
      day.event = "targetWaiting";
    }
  }

  let progress: PhaseProgress | null = null;
  if (outcome === "unfinished") {
    const phase = phases[phaseIndex];
    progress = {
      phase,
      targetProfit: plan.phases[phase - 1].targetProfit,
      profit: round2(balance - start),
      tradingDays: dayResults.length,
      minDays: plan.minDays,
      consistency: checkConsistency(dayResults),
    };
  }

  const calm = days.filter((d) => d.event !== "dailyBreach" && d.event !== "maxBreach");
  const closestCall = calm.length ? calm.reduce((a, b) => (b.roomAtLow < a.roomAtLow ? b : a)) : null;

  return {
    outcome,
    phases,
    phasesPassed,
    days,
    finalDay: days.length ? days[days.length - 1] : null,
    tradesUsed,
    tradesTotal: input.trades.length,
    progress,
    closestCall,
  };
}

/** UTC offsets offered for "times in this file are in", in minutes. */
export const TIME_OFFSETS = [-480, -420, -360, -300, -240, -180, 0, 60, 120, 180, 240, 330, 480, 540, 600] as const;

export const offsetLabel = (minutes: number) => {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
};

/**
 * Clearly made-up dated results for trying the tool, from a $25,000 account
 * (closing times in UTC). Not real trades.
 */
export const EXAMPLE_DATED_RESULTS = [
  "Close time,Profit",
  "2026-10-05 08:40,-125",
  "2026-10-05 14:10,250",
  "2026-10-06 09:05,190",
  "2026-10-06 15:30,-120",
  "2026-10-07 10:20,-125",
  "2026-10-07 13:45,-130",
  "2026-10-08 08:15,310",
  "2026-10-08 16:00,95",
  "2026-10-09 09:30,-110",
  "2026-10-09 14:50,240",
  "2026-10-12 08:55,180",
  "2026-10-12 15:10,-125",
  "2026-10-13 09:40,260",
  "2026-10-14 10:05,-140",
  "2026-10-14 14:25,275",
  "2026-10-15 08:30,-125",
  "2026-10-15 13:15,230",
  "2026-10-16 09:50,190",
  "2026-10-19 10:35,-60",
  "2026-10-19 15:45,245",
].join("\n");

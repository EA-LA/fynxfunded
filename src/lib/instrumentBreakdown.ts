import type { Trade } from "@/lib/tradingData";
import { JOURNAL_SESSION_BANDS, type JournalSession } from "@/lib/tradingDayClock";

/**
 * Read-only regrouping of recorded closed trades by instrument and by the
 * journal's session label. Nothing here changes how an evaluation is scored.
 */

export const BREAKDOWN_SESSIONS: JournalSession[] = JOURNAL_SESSION_BANDS.map(b => b.session);

/** Smallest number of trades in a cell before it is called out as a strength or weakness. */
export const MIN_TRADES_FOR_HIGHLIGHT = 3;

export interface CellStats { count: number; pnl: number; wins: number; losses: number; winRate: number }
export interface InstrumentRow extends CellStats {
  symbol: string;
  average: number;
  best: number;
  worst: number;
  longs: number;
  shorts: number;
  sessions: Record<JournalSession, CellStats>;
}
export interface BreakdownHighlight { symbol: string; session: JournalSession; stats: CellStats }
export type BreakdownSort = "pnl" | "count" | "winRate" | "symbol";

const emptyCell = (): CellStats => ({ count: 0, pnl: 0, wins: 0, losses: 0, winRate: 0 });
const round = (v: number) => Math.round(v * 100) / 100;

function add(cell: CellStats, t: Trade) {
  cell.count += 1;
  cell.pnl += t.pnl;
  if (t.pnl > 0) cell.wins += 1;
  else if (t.pnl < 0) cell.losses += 1;
}
function finish(cell: CellStats) {
  cell.pnl = round(cell.pnl);
  cell.winRate = cell.count ? (cell.wins / cell.count) * 100 : 0;
}

/** One row per instrument with totals and a P/L cell for every journal session. */
export function instrumentBreakdown(trades: Trade[], sort: BreakdownSort = "pnl"): InstrumentRow[] {
  const rows = new Map<string, InstrumentRow>();
  for (const t of trades) {
    if (!Number.isFinite(t.pnl)) continue;
    const symbol = (t.symbol || "—").trim() || "—";
    let row = rows.get(symbol);
    if (!row) {
      row = {
        symbol, ...emptyCell(), average: 0, best: -Infinity, worst: Infinity, longs: 0, shorts: 0,
        sessions: Object.fromEntries(BREAKDOWN_SESSIONS.map(s => [s, emptyCell()])) as Record<JournalSession, CellStats>,
      };
      rows.set(symbol, row);
    }
    add(row, t);
    row.best = Math.max(row.best, t.pnl);
    row.worst = Math.min(row.worst, t.pnl);
    if (t.type === "Sell") row.shorts += 1; else row.longs += 1;
    const session = BREAKDOWN_SESSIONS.includes(t.session) ? t.session : "New York";
    add(row.sessions[session], t);
  }
  const list = [...rows.values()].map(row => {
    finish(row);
    BREAKDOWN_SESSIONS.forEach(s => finish(row.sessions[s]));
    row.average = row.count ? round(row.pnl / row.count) : 0;
    row.best = round(row.best);
    row.worst = round(row.worst);
    return row;
  });
  const bySymbol = (a: InstrumentRow, b: InstrumentRow) => a.symbol.localeCompare(b.symbol);
  const compare: Record<BreakdownSort, (a: InstrumentRow, b: InstrumentRow) => number> = {
    pnl: (a, b) => b.pnl - a.pnl || bySymbol(a, b),
    count: (a, b) => b.count - a.count || bySymbol(a, b),
    winRate: (a, b) => b.winRate - a.winRate || b.count - a.count || bySymbol(a, b),
    symbol: bySymbol,
  };
  return list.sort(compare[sort]);
}

/** Session totals across every instrument. */
export function sessionTotals(rows: InstrumentRow[]): Record<JournalSession, CellStats> {
  const totals = Object.fromEntries(BREAKDOWN_SESSIONS.map(s => [s, emptyCell()])) as Record<JournalSession, CellStats>;
  for (const row of rows) for (const s of BREAKDOWN_SESSIONS) {
    const c = row.sessions[s], t = totals[s];
    t.count += c.count; t.pnl += c.pnl; t.wins += c.wins; t.losses += c.losses;
  }
  BREAKDOWN_SESSIONS.forEach(s => finish(totals[s]));
  return totals;
}

/**
 * Strongest and weakest instrument + session combinations. Only cells with at
 * least MIN_TRADES_FOR_HIGHLIGHT trades count, and the strongest must be
 * positive and the weakest negative, so a thin sample is never called out.
 */
export function breakdownHighlights(rows: InstrumentRow[]): { strongest: BreakdownHighlight | null; weakest: BreakdownHighlight | null } {
  const cells: BreakdownHighlight[] = rows.flatMap(r => BREAKDOWN_SESSIONS.map(s => ({ symbol: r.symbol, session: s, stats: r.sessions[s] })))
    .filter(c => c.stats.count >= MIN_TRADES_FOR_HIGHLIGHT);
  const strongest = cells.filter(c => c.stats.pnl > 0).sort((a, b) => b.stats.pnl - a.stats.pnl)[0] ?? null;
  const weakest = cells.filter(c => c.stats.pnl < 0).sort((a, b) => a.stats.pnl - b.stats.pnl)[0] ?? null;
  return { strongest, weakest };
}

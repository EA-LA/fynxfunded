import type { Deal } from "@/engine/types";
import { findPair } from "./instruments";

/**
 * Account statement for the terminal's History tab: totals for the closed
 * trades on screen and a CSV with one row per trade, straight from the
 * trading server's records (no estimates).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StatementSummary {
  trades: number;
  wins: number;
  losses: number;
  /** Wins ÷ trades × 100, one decimal; null without trades. */
  winRate: number | null;
  /** Sum of winning trades' net results. */
  grossProfit: number;
  /** Sum of losing trades' net results (negative or 0). */
  grossLoss: number;
  /** Commission charged (positive = paid). */
  commission: number;
  /** Swap settled (negative = charged). */
  swap: number;
  net: number;
  /** grossProfit ÷ |grossLoss|, two decimals; null without losses. */
  profitFactor: number | null;
  lots: number;
  firstClosedAt: number | null;
  lastClosedAt: number | null;
}

export function statementSummary(deals: readonly Deal[]): StatementSummary {
  let grossProfit = 0, grossLoss = 0, commission = 0, swap = 0, net = 0, lots = 0, wins = 0, losses = 0;
  let first: number | null = null, last: number | null = null;
  for (const d of deals) {
    net += d.netProfit; commission += d.commission; swap += d.swap ?? 0; lots += d.lots;
    if (d.netProfit > 0) { wins++; grossProfit += d.netProfit; } else if (d.netProfit < 0) { losses++; grossLoss += d.netProfit; }
    first = first === null ? d.closedAt : Math.min(first, d.closedAt);
    last = last === null ? d.closedAt : Math.max(last, d.closedAt);
  }
  return {
    trades: deals.length, wins, losses,
    winRate: deals.length ? Math.round((wins / deals.length) * 1000) / 10 : null,
    grossProfit: round2(grossProfit), grossLoss: round2(grossLoss), commission: round2(commission), swap: round2(swap), net: round2(net),
    profitFactor: losses && grossLoss < 0 ? round2(grossProfit / -grossLoss) : null,
    lots: round2(lots), firstClosedAt: first, lastClosedAt: last,
  };
}

const REASONS: Record<string, string> = {
  manual: "Closed by you", stop_loss: "Stop loss", take_profit: "Take profit",
  daily_loss_limit: "Daily loss limit", maximum_loss_limit: "Maximum loss limit", target_reached: "Profit target reached",
};

/** Plain name for how a trade closed. */
export const reasonLabel = (reason: string) => REASONS[reason] ?? reason.replace(/_/g, " ");

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

/** One CSV field: quoted, quotes doubled, and text that a spreadsheet could run as a formula is prefixed with '. */
function field(v: string | number): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const STATEMENT_HEADERS = ["Deal", "Position", "Symbol", "Side", "Lots", "Open (UTC)", "Open price", "Close (UTC)", "Close price", "Gross P/L (USD)", "Commission (USD)", "Swap (USD)", "Net P/L (USD)", "Risk at entry (USD)", "Result (R)", "Closed by"];

/** CSV statement, oldest trade first, with the totals at the end. */
export function statementCsv(accountId: string, deals: readonly Deal[]): string {
  const sorted = [...deals].sort((a, b) => a.closedAt - b.closedAt || a.id.localeCompare(b.id));
  const digits = (sym: string) => findPair(sym)?.digits ?? 5;
  const rows: (string | number)[][] = [STATEMENT_HEADERS];
  for (const d of sorted) {
    const r = d.entryRisk && d.entryRisk.amount > 0 ? round2(d.netProfit / d.entryRisk.amount) : "";
    rows.push([d.id, d.positionId, d.symbol, d.side, d.lots, iso(d.openedAt), d.entryPrice.toFixed(digits(d.symbol)), iso(d.closedAt), d.exitPrice.toFixed(digits(d.symbol)), d.grossProfit, -d.commission, d.swap ?? 0, d.netProfit, d.entryRisk?.amount ?? "", r, reasonLabel(d.reason)]);
  }
  const s = statementSummary(sorted);
  rows.push([]);
  rows.push(["Account", accountId]);
  rows.push(["Trades", s.trades], ["Wins", s.wins], ["Losses", s.losses], ["Win rate (%)", s.winRate ?? ""]);
  rows.push(["Gross profit (USD)", s.grossProfit], ["Gross loss (USD)", s.grossLoss], ["Commission (USD)", -s.commission], ["Swap (USD)", s.swap], ["Net result (USD)", s.net]);
  rows.push(["Source", "FYNX Trade trading server records"]);
  return rows.map(r => r.map(field).join(",")).join("\r\n") + "\r\n";
}

/** File name like fynx-trade-statement-ACC123-2026-11-10.csv (account id cleaned for file systems). */
export function statementFileName(accountId: string, now: number): string {
  return `fynx-trade-statement-${accountId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "account"}-${new Date(now).toISOString().slice(0, 10)}.csv`;
}

import { validJournalEntry, type JournalEntry, type JournalKind } from "@/engine/journal";
import { csvField } from "./statement";

/** Journal tab filters: what each one shows. */
export type JournalFilter = "all" | "trading" | "refused" | "rules" | "alerts";
export const JOURNAL_FILTERS: { id: JournalFilter; label: string; kinds: readonly JournalKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "trading", label: "Orders & trades", kinds: ["order", "trade", "change", "cancel"] },
  { id: "refused", label: "Refused", kinds: ["refused"] },
  { id: "rules", label: "Rules & account", kinds: ["rule", "account"] },
  { id: "alerts", label: "Alerts", kinds: ["alert"] },
];

export const KIND_LABELS: Record<JournalKind, string> = {
  order: "Order", trade: "Trade", change: "Change", cancel: "Cancelled", refused: "Refused", rule: "Rule", alert: "Alert", account: "Account",
};

/**
 * The account journal from a snapshot, newest first. Entries come from the
 * trading server, so anything malformed is dropped rather than shown.
 */
export function readJournal(raw: unknown): JournalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(validJournalEntry).sort((a, b) => b.at - a.at);
}

export function filterJournal(entries: readonly JournalEntry[], filter: JournalFilter, symbol: string): JournalEntry[] {
  const kinds = JOURNAL_FILTERS.find(f => f.id === filter)?.kinds ?? null;
  return entries.filter(e => (!kinds || kinds.includes(e.kind)) && (!symbol || e.symbol === symbol));
}

export function journalCounts(entries: readonly JournalEntry[], symbol: string): Record<JournalFilter, number> {
  return Object.fromEntries(JOURNAL_FILTERS.map(f => [f.id, filterJournal(entries, f.id, symbol).length])) as Record<JournalFilter, number>;
}

/** Pairs that appear in the journal, A–Z, for the pair filter. */
export const journalSymbols = (entries: readonly JournalEntry[]) => [...new Set(entries.map(e => e.symbol).filter((s): s is string => !!s))].sort();

/** CSV of the shown entries, oldest first, formula-safe like the statement. */
export function journalCsv(accountId: string, entries: readonly JournalEntry[]): string {
  const rows: (string | number)[][] = [["Time (UTC)", "Type", "Pair", "Order/position", "Code", "What happened"]];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) rows.push([new Date(e.at).toISOString().replace(".000Z", "Z"), KIND_LABELS[e.kind], e.symbol ?? "", e.ref ?? "", e.code ?? "", e.text]);
  rows.push([], ["Account", accountId], ["Source", "FYNX Trade trading server journal"]);
  return rows.map(r => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function journalFileName(accountId: string, now: number): string {
  return `fynx-trade-journal-${accountId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "account"}-${new Date(now).toISOString().slice(0, 10)}.csv`;
}

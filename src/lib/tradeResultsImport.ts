/**
 * Reads a list of closed-trade results (profit or loss in dollars) that a
 * trader pastes or uploads on the Rules page, so the pass simulator can replay
 * them. Everything happens in the browser; nothing is saved or sent.
 *
 * Accepted:
 *  - one result per line, or several separated by spaces, tabs, semicolons or commas
 *    ("120", "-80.50", "+45", "$1,234.50", "-$80", "(80)" for a loss, "−80" with a typographic minus)
 *  - a CSV/TSV export with a header row: the first column whose name looks like
 *    profit / P/L / PnL / net profit / result is used and the other columns are ignored.
 */

export const MAX_TRADE_RESULTS = 5000;
/** Upload limit for a pasted or uploaded file, in bytes. */
export const MAX_TRADE_FILE_BYTES = 1_000_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface TradeResultsImport {
  /** Every result read, in order, including breakeven (0) trades. */
  values: number[];
  /** Pieces of text that were not a number (shown back to the trader). */
  skipped: string[];
  /** Name of the column used when the text had a header row. */
  column: string | null;
  /** Problem that stops the list being used at all (e.g. no profit column). */
  error: string | null;
  /** True when more than MAX_TRADE_RESULTS were found and the rest were ignored. */
  truncated: boolean;
}

/** Turns one piece of text into a dollar amount, or null when it is not one. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[−‒–—]/g, "-");
  // Optional sign and currency in either order: "-$80", "$-80", "+45", "USD 120", "80 USD".
  s = s.replace(/\s*(usd|us\$)\s*/gi, "").replace(/\$/g, "").trim();
  const sign = s.match(/^[+-]/);
  if (sign) {
    if (sign[0] === "-") negative = !negative;
    s = s.slice(1).trim();
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

const PROFIT_COLUMN = /^(net[\s_-]*)?(profit|p\s*\/\s*l|p&l|pnl|pl|result|gain|net)([\s_-]*(\(.*\)|usd|\$|amount))?$/i;

/** Splits one CSV/TSV line, keeping quoted fields (with "" escapes) together. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const pickDelimiter = (header: string) => {
  const counts = [",", "\t", ";"].map((d) => ({ d, n: splitDelimited(header, d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : null;
};

/** A header row has at least one field with letters that isn't a money amount. */
const looksLikeHeader = (line: string) => /[a-z]{2,}/i.test(line.replace(/usd/gi, ""));

/** Free list: commas inside "1,234.50" are thousand separators, other commas separate results. */
function listTokens(line: string): string[] {
  const tokens: string[] = [];
  for (const chunk of line.split(/[\s;]+/)) {
    if (!chunk) continue;
    if (/^\(?[+\-−]?\$?\d{1,3}(,\d{3})+(\.\d+)?\)?$/.test(chunk)) tokens.push(chunk);
    else tokens.push(...chunk.split(",").filter(Boolean));
  }
  return tokens;
}

export function parseTradeResults(text: string): TradeResultsImport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const result: TradeResultsImport = { values: [], skipped: [], column: null, error: null, truncated: false };
  if (!lines.length) return result;

  const push = (raw: string) => {
    const n = parseMoney(raw);
    if (n === null) {
      if (result.skipped.length < 50) result.skipped.push(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
      return;
    }
    if (result.values.length >= MAX_TRADE_RESULTS) {
      result.truncated = true;
      return;
    }
    result.values.push(n);
  };

  const delimiter = looksLikeHeader(lines[0]) ? pickDelimiter(lines[0]) : null;
  if (delimiter) {
    const header = splitDelimited(lines[0], delimiter);
    const index = header.findIndex((h) => PROFIT_COLUMN.test(h.replace(/^["']|["']$/g, "").trim()));
    if (index === -1) {
      const names = header.filter(Boolean).slice(0, 12).join(", ");
      result.error = `Couldn't find a profit column in the header row (${names}). Name the column "Profit" or "P/L", or paste just the results, one per line.`;
      return result;
    }
    result.column = header[index];
    for (const line of lines.slice(1)) {
      const cells = splitDelimited(line, delimiter);
      const cell = cells[index] ?? "";
      if (cell === "") continue; // Summary or blank rows in broker exports.
      push(cell);
    }
    return result;
  }

  // A single "Profit" header above a plain column of numbers.
  const body = PROFIT_COLUMN.test(lines[0]) ? lines.slice(1) : lines;
  if (body !== lines) result.column = lines[0];
  for (const line of body) {
    for (const token of listTokens(line)) push(token);
  }
  return result;
}

export interface TradeResultsSummary {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Wins ÷ (wins + losses), percent with 2 decimals. */
  winRate: number;
  avgWin: number;
  avgLoss: number;
  biggestWin: number;
  biggestLoss: number;
  net: number;
}

export function summarizeTradeResults(values: number[]): TradeResultsSummary {
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v < 0);
  const decisive = wins.length + losses.length;
  return {
    trades: values.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: values.length - decisive,
    winRate: decisive ? round2((wins.length / decisive) * 100) : 0,
    avgWin: wins.length ? round2(wins.reduce((s, v) => s + v, 0) / wins.length) : 0,
    avgLoss: losses.length ? round2(-losses.reduce((s, v) => s + v, 0) / losses.length) : 0,
    biggestWin: wins.length ? Math.max(...wins) : 0,
    biggestLoss: losses.length ? -Math.min(...losses) : 0,
    net: round2(values.reduce((s, v) => s + v, 0)),
  };
}

/** Results resized from the account they were made on to the simulated one (unchanged when the original size is unknown). */
export function resizeTradeResults(values: number[], recordedSize: number | null, chosenSize: number): number[] {
  const scale = recordedSize && recordedSize > 0 && chosenSize > 0 ? chosenSize / recordedSize : 1;
  return values.map((v) => round2(v * scale));
}

/**
 * A short list of clearly made-up results for trying the tool, sized for a
 * $25,000 account (about 0.5% risk, mixed wins and losses).
 */
export const EXAMPLE_TRADE_RESULTS = [
  "250", "-125", "-125", "190", "-130", "310", "-120", "-125", "240", "-110",
  "180", "-125", "-140", "260", "-125", "95", "-125", "275", "-60", "-125",
].join("\n");

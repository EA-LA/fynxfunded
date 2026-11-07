import { CONTRACT_SIZE, pipValueUsd, type ForexPair } from "./instruments";

export interface AccountRules {
  profit_target_percent: string;
  daily_loss_percent: string;
  max_loss_percent: string;
  min_trading_days: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (v: string) => { const n = Number.parseFloat(String(v).replace("%", "")); return Number.isFinite(n) ? n : null; };

/** Purchased rules in dollars for an account's starting balance. */
export function rulesInDollars(startingBalance: number, rules: AccountRules) {
  const target = pct(rules.profit_target_percent), daily = pct(rules.daily_loss_percent), max = pct(rules.max_loss_percent);
  const ok = Number.isFinite(startingBalance) && startingBalance > 0;
  return {
    targetAmount: ok && target !== null ? round2((startingBalance * target) / 100) : null,
    targetBalance: ok && target !== null ? round2(startingBalance * (1 + target / 100)) : null,
    dailyLossAmount: ok && daily !== null ? round2((startingBalance * daily) / 100) : null,
    maxLossAmount: ok && max !== null ? round2((startingBalance * max) / 100) : null,
    maxLossFloor: ok && max !== null ? round2(startingBalance * (1 - max / 100)) : null,
  };
}

export interface TicketInput {
  pair: ForexPair;
  lots: number | null;
  slPips: number | null;
  tpPips: number | null;
  balance?: number;
  dailyLossAmount?: number | null;
}

export interface TicketFigures {
  units: number | null;
  pipValue: number | null;
  risk: number | null;
  reward: number | null;
  riskPercent: number | null;
  /** Share of the daily loss allowance the stop would use (100 = all of it). */
  riskShareOfDaily: number | null;
  rewardRatio: number | null;
}

/** Order-ticket arithmetic. Dollar figures are only given when they don't depend on a live price. */
export function ticketFigures({ pair, lots, slPips, tpPips, balance, dailyLossAmount }: TicketInput): TicketFigures {
  const units = lots ? Math.round(lots * CONTRACT_SIZE) : null;
  const pipValue = lots ? pipValueUsd(pair, lots) : null;
  const sl = slPips && slPips > 0 ? slPips : null, tp = tpPips && tpPips > 0 ? tpPips : null;
  const risk = pipValue !== null && sl !== null ? round2(pipValue * sl) : null;
  const reward = pipValue !== null && tp !== null ? round2(pipValue * tp) : null;
  return {
    units,
    pipValue,
    risk,
    reward,
    riskPercent: risk !== null && balance && balance > 0 ? round2((risk / balance) * 100) : null,
    riskShareOfDaily: risk !== null && dailyLossAmount && dailyLossAmount > 0 ? Math.round((risk / dailyLossAmount) * 100) : null,
    rewardRatio: sl !== null && tp !== null ? round2(tp / sl) : null,
  };
}

/** Whole positive pips from a text field; null when empty or invalid. */
export function parsePips(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100_000 ? Math.round(n * 10) / 10 : null;
}

/**
 * Stop-loss / take-profit prices from distances in pips, measured from the
 * entry: the ask for market buys, the bid for market sells, or the order price
 * for pending orders.
 */
export function protectionPrices(side: "buy" | "sell", reference: number, slPips: number | null, tpPips: number | null, pipSize: number, digits: number) {
  const round = (v: number) => Number(v.toFixed(digits));
  const dir = side === "buy" ? 1 : -1;
  return {
    stopLoss: slPips ? round(reference - dir * slPips * pipSize) : undefined,
    takeProfit: tpPips ? round(reference + dir * tpPips * pipSize) : undefined,
  };
}

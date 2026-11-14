import Decimal from "decimal.js";
import { DEFAULT_NEAR_LIMIT_PERCENT, nearLimitPercent } from "@/engine/core";
import type { AccountMetrics, AccountState, NearLimitWarning } from "@/engine/types";

/** Distances offered in the Alerts tab (share of a loss allowance still left). */
export const NEAR_CHOICES: readonly number[] = [10, DEFAULT_NEAR_LIMIT_PERCENT, 50];

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const LIMIT_LABEL: Record<NearLimitWarning["limit"], string> = { daily: "Daily loss limit", maximum: "Maximum loss limit" };

export interface NearPreview {
  percent: number;
  /** Today's daily allowance in dollars (day's start balance minus the daily loss level). */
  dailyAllowance: number;
  /** Dollars left before the daily level at which the warning is sent. */
  warnAtRoom: number;
  /** Equity at which the warning is sent (daily limit). */
  warnAtEquity: number;
  /** Dollars left now before the daily level; null while equity is not complete. */
  roomNow: number | null;
}

/**
 * What the chosen distance means in dollars today for the daily loss limit.
 * Null when the account has no daily allowance (nothing to compare with).
 */
export function nearPreview(state: Pick<AccountState, "dayStartBalance" | "nearLimitPercent">, m: Pick<AccountMetrics, "equity" | "dailyLossFloor" | "unpriced">, percent = nearLimitPercent(state)): NearPreview | null {
  const allowance = new Decimal(state.dayStartBalance).minus(m.dailyLossFloor);
  if (!allowance.isFinite() || allowance.lte(0)) return null;
  const warnAtRoom = allowance.times(percent).div(100).toDecimalPlaces(2).toNumber();
  return {
    percent,
    dailyAllowance: allowance.toDecimalPlaces(2).toNumber(),
    warnAtRoom,
    warnAtEquity: new Decimal(m.dailyLossFloor).plus(warnAtRoom).toDecimalPlaces(2).toNumber(),
    roomNow: m.unpriced?.length || !Number.isFinite(m.equity) ? null : new Decimal(m.equity).minus(m.dailyLossFloor).toDecimalPlaces(2).toNumber(),
  };
}

/** Plain sentence for the settings box. */
export function previewSentence(p: NearPreview): string {
  return `With ${p.percent}%: you are warned once equity is ${usd(p.warnAtRoom)} or less above today's daily loss level (equity ${usd(p.warnAtEquity)} or lower, of a ${usd(p.dailyAllowance)} daily allowance). The same share applies to the maximum loss limit.`;
}

/** Warnings of the account's current trading day, newest first. */
export function todaysWarnings(state: Pick<AccountState, "nearWarnings" | "tradingDay">): NearLimitWarning[] {
  return (state.nearWarnings ?? []).filter(w => w.tradingDay === state.tradingDay);
}

export const warningKey = (w: Pick<NearLimitWarning, "tradingDay" | "limit">) => `${w.tradingDay}:${w.limit}`;

/** One line about a warning: "Daily loss limit: $120.00 left (24.0% of $500.00) at 14:05". */
export function warningSentence(w: NearLimitWarning, time: (ms: number) => string): string {
  return `${LIMIT_LABEL[w.limit]}: ${usd(w.room)} left (${w.roomPercent.toFixed(1)}% of ${usd(w.allowance)}) at ${time(w.at)}, equity ${usd(w.equity)}`;
}

/** Warnings not seen yet (for a pop-up while the terminal is open); marks them seen. */
export function newlyWarned(list: NearLimitWarning[] | undefined, seen: Set<string>): NearLimitWarning[] {
  const out = (list ?? []).filter(w => !seen.has(warningKey(w)));
  out.forEach(w => seen.add(warningKey(w)));
  return out;
}

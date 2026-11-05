/**
 * Dollar figures for a FYNX Trade account, derived only from the rule snapshot recorded with the purchase
 * and the balance the server returned. Display helpers: they never decide a breach or a pass.
 */
export interface RecordedRules { profit_target_percent: string; daily_loss_percent: string; max_loss_percent: string; min_trading_days: number }
export interface AccountLimits {
  targetProfit: number; targetBalance: number; dailyLossAllowance: number; maxLossAllowance: number;
  maxLossFloor: number; profitSoFar: number; targetProgress: number; roomToMaxFloor: number;
}

const pct = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};
const cents = (n: number) => Math.round(n * 100) / 100;

export function accountLimits(startingBalance: number, balance: number, rules: RecordedRules): AccountLimits | null {
  const target = pct(rules.profit_target_percent), daily = pct(rules.daily_loss_percent), max = pct(rules.max_loss_percent);
  if (!Number.isFinite(startingBalance) || startingBalance <= 0 || !Number.isFinite(balance) || target === null || daily === null || max === null) return null;
  const targetProfit = cents(startingBalance * target / 100), maxLossAllowance = cents(startingBalance * max / 100);
  const maxLossFloor = cents(startingBalance - maxLossAllowance), profitSoFar = cents(balance - startingBalance);
  return {
    targetProfit, targetBalance: cents(startingBalance + targetProfit),
    dailyLossAllowance: cents(startingBalance * daily / 100), maxLossAllowance, maxLossFloor, profitSoFar,
    targetProgress: targetProfit > 0 ? Math.min(1, Math.max(0, profitSoFar / targetProfit)) : 0,
    roomToMaxFloor: cents(balance - maxLossFloor),
  };
}

/** Plain-language version of a callable error. Private-testing gates get guidance instead of a raw code. */
export function tradeAccessError(error: unknown): { kind: 'private' | 'signin' | 'other'; message: string } {
  const e = error as { code?: string; message?: string } | undefined;
  const code = String(e?.code ?? '').replace('functions/', ''), message = String(e?.message ?? '');
  if (code === 'permission-denied' || /private testing/i.test(message)) return { kind: 'private', message: 'FYNX Trade is in private testing, so account access is limited to the testing team for now.' };
  if (code === 'unauthenticated') return { kind: 'signin', message: 'Your sign-in has expired. Sign out and sign back in to open your accounts.' };
  if (code === 'failed-precondition' && /two-factor/i.test(message)) return { kind: 'other', message };
  return { kind: 'other', message: message && !/^internal$/i.test(message) ? message.replace(/^FirebaseError:\s*/, '') : 'Account access could not be loaded. Please retry.' };
}

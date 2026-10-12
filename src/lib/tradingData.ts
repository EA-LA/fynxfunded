import type { DocumentData } from "firebase/firestore";

export interface Trade { id:string; accountId:string; challengeId:string; symbol:string; type:"Buy"|"Sell"; openTime:string; closeTime:string; lots:number; pnl:number; pips:number; duration:string; riskPercent:number; rr:number; session:"London"|"New York"|"Asia"; result:"Win"|"Loss"|"Breakeven" }
export interface AccountObjectives { profitTarget:{current:number;target:number}; dailyLoss:{current:number;limit:number}; maxLoss:{current:number;limit:number}; minTradingDays:{current:number;target:number}; consistency:{largestWinDay:number;threshold:number}|null }
export interface PayoutInfo { availableBalance:number; eligibleAmount:number; nextWindow:string; method:string; isEligible:boolean; ineligibleReason:string; history:PayoutRecord[] }
export interface PayoutRecord { id:string; date:string; amount:number; status:"Pending"|"Approved"|"Paid"|"Rejected"; method:string }
export interface TradingData { hasAccount:boolean; hasTrades:boolean; trades:Trade[]; objectives:AccountObjectives|null; payout:PayoutInfo|null; loading:boolean; error:string; accountName:string; accountSize:number; balance:number|null; equity:number|null; brokerConnected:boolean; evaluationAt:string }

export const numeric = (value: unknown): number | null => {
  if ((typeof value !== "number" && typeof value !== "string") || typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
export function timestamp(value: unknown): string {
  try {
    const date = value && typeof value === "object" && "toDate" in value
      ? (value as { toDate: () => Date }).toDate()
      : typeof value === "string" || value instanceof Date ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
  } catch { return ""; }
}

export function mapClosedTrade(id: string, data: DocumentData): Trade | null {
  // updatedAt is not evidence that an open position has closed.
  const closeTime = timestamp(data.closeTime ?? data.closedAt);
  const openTime = timestamp(data.openTime ?? data.openedAt);
  let pnl = numeric(data.netProfit ?? data.pnl ?? data.profit);
  const costs = [data.commission, data.swap, data.fees].map(value => value == null ? 0 : numeric(value));
  if (data.netProfit == null && data.pnlBasis !== "net") {
    if (costs.some(value => value === null)) return null;
    if (data.pnlBasis === "gross_signed_costs") pnl = pnl === null ? null : pnl + costs.reduce<number>((sum, value) => sum + value!, 0);
    else if (costs.some(value => value !== 0)) return null;
  }
  if (pnl !== null && !Number.isFinite(pnl)) return null;
  if (!closeTime || pnl === null || ["open", "pending", "cancelled", "canceled"].includes(String(data.status).toLowerCase())) return null;
  if (openTime && closeTime < openTime) return null;
  const minutes = openTime ? Math.round((Date.parse(closeTime) - Date.parse(openTime)) / 60000) : null;
  const hour = openTime ? new Date(openTime).getUTCHours() : new Date(closeTime).getUTCHours();
  const inferredSession = hour < 8 ? "Asia" : hour < 13 ? "London" : "New York";
  return {
    id, accountId: String(data.accountId ?? data.brokerAccountId ?? ""), challengeId: String(data.challengeId ?? ""),
    symbol: String(data.symbol ?? data.instrument ?? "—"), type: String(data.type ?? data.side).toLowerCase() === "sell" ? "Sell" : "Buy",
    openTime, closeTime, pnl, lots: numeric(data.lots ?? data.volume) ?? 0, pips: numeric(data.pips) ?? 0,
    duration: minutes === null ? "—" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
    riskPercent: numeric(data.riskPercent ?? data.riskPct) ?? 0, rr: numeric(data.rr ?? data.riskReward) ?? 0,
    session: ["Asia", "London", "New York"].includes(data.session) ? data.session : inferredSession,
    result: pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Breakeven",
  };
}

export function belongsToAccount(trade: Trade, challenge: DocumentData | undefined, account: DocumentData | undefined): boolean {
  const challengeId = challenge?.id ?? challenge?.challengeId;
  const accountIds = [account?.id, account?.accountId, account?.brokerAccountId, account?.login, challenge?.accountId, challenge?.brokerAccountId].filter(Boolean).map(String);
  if (trade.challengeId && challengeId && trade.challengeId !== challengeId) return false;
  if (trade.accountId) return accountIds.includes(trade.accountId);
  return Boolean(challengeId && trade.challengeId === challengeId);
}

export function recordedObjectives(challenge?: DocumentData): AccountObjectives | null {
  // Only the persisted versioned evaluation contains both the purchased rules
  // and equity-based metrics. Closed P/L alone cannot prove a risk allowance.
  const evaluation = challenge?.rulePolicyEvaluation, rule = evaluation?.rule, state = evaluation?.state, metrics = state?.metrics;
  if (!timestamp(challenge?.lastRuleEvaluationAt) || !rule || !metrics || evaluation.policy_version !== challenge?.rulePolicyVersion) return null;
  if (rule.name !== `${challenge?.rulePolicyVersion}:${challenge?.phase}:${challenge?.currentPhase ?? 1}` || rule.starting_balance !== String(challenge?.accountSize) || challenge?.rulePolicy?.phase !== (challenge?.currentPhase ?? 1)) return null;
  const size = numeric(rule.starting_balance), dailyLimit = numeric(rule.daily_loss_percent), maxLimit = numeric(rule.max_loss_percent);
  const profit = numeric(metrics.profit), target = numeric(rule.profit_target_percent), dailyUsed = numeric(metrics.daily_used_percent), maxUsed = numeric(metrics.max_used_percent), days = numeric(metrics.trading_days), minDays = numeric(rule.min_trading_days);
  if (size === null || size <= 0 || [dailyLimit, maxLimit, profit, target, dailyUsed, maxUsed, days, minDays].some(x => x === null)) return null;
  return {
    profitTarget: {current: profit! / size * 100, target: target!},
    dailyLoss: {current: dailyUsed! / 100 * dailyLimit!, limit: dailyLimit!},
    maxLoss: {current: maxUsed! / 100 * maxLimit!, limit: maxLimit!},
    minTradingDays: {current: days!, target: minDays!},
    consistency: numeric(metrics.consistency_share_percent) !== null && numeric(rule.consistency_percent) !== null
      ? {largestWinDay: numeric(metrics.consistency_share_percent)!, threshold: numeric(rule.consistency_percent)!} : null,
  };
}

export function selectTradingData(accounts: DocumentData[], challenges: DocumentData[], allTrades: Trade[], challengeId?: string): Omit<TradingData, "loading" | "error"> {
  const challenge = challengeId ? challenges.find(x => x.id === challengeId) : challenges.find(x => ["active", "passed", "funded"].includes(x.status)) ?? challenges[0];
  const boundAccount = challenge?.brokerAccountId || challenge?.accountId;
  const matches = challenge ? accounts.filter(x => (!x.challengeId || x.challengeId === challenge.id) && (boundAccount
    ? [x.id, x.accountId, x.brokerAccountId, x.login].filter(Boolean).map(String).includes(String(boundAccount))
    : x.challengeId === challenge.id)) : [];
  const account = matches.find(x => x.status === "active") ?? matches[0];
  const trades = allTrades.filter(t => belongsToAccount(t, challenge, account)).sort((a,b) => Date.parse(b.closeTime) - Date.parse(a.closeTime));
  return {
    hasAccount: Boolean(challenge || account), hasTrades: trades.length > 0, trades,
    objectives: recordedObjectives(challenge), payout: null,
    accountName: String(challenge?.name || account?.login || "No active challenge"),
    accountSize: numeric(challenge?.accountSize) ?? 0,
    balance: numeric(account?.balance), equity: numeric(account?.equity),
    // A login or historical trade does not establish current feed health.
    brokerConnected: false, evaluationAt: timestamp(challenge?.lastRuleEvaluationAt),
  };
}

export function computeAnalytics(trades: Trade[]) {
  if (!trades.length) return null;
  const ordered = [...trades].sort((a,b) => Date.parse(a.closeTime) - Date.parse(b.closeTime));
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const grossProfit = wins.reduce((sum,t) => sum + t.pnl, 0), grossLoss = -losses.reduce((sum,t) => sum + t.pnl, 0);
  const totalPnl = grossProfit - grossLoss;
  const sessions = {London: 0, "New York": 0, Asia: 0}, instruments: Record<string, {pnl:number;count:number}> = {};
  let maxConsWins = 0, maxConsLosses = 0, cw = 0, cl = 0, maxDrawdown = 0, peak = 0, runningPnl = 0;
  for (const trade of ordered) {
    cw = trade.pnl > 0 ? cw + 1 : 0; cl = trade.pnl < 0 ? cl + 1 : 0;
    maxConsWins = Math.max(maxConsWins, cw); maxConsLosses = Math.max(maxConsLosses, cl);
    runningPnl += trade.pnl; peak = Math.max(peak, runningPnl); maxDrawdown = Math.max(maxDrawdown, peak - runningPnl);
    sessions[trade.session] += trade.pnl;
    instruments[trade.symbol] ??= {pnl:0,count:0}; instruments[trade.symbol].pnl += trade.pnl; instruments[trade.symbol].count++;
  }
  const sorted = Object.entries(instruments).sort((a,b) => b[1].pnl - a[1].pnl);
  return {
    totalTrades: trades.length, totalPnl, winRate: wins.length / trades.length * 100,
    avgWin: wins.length ? grossProfit / wins.length : 0, avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    expectancy: totalPnl / trades.length, maxDrawdown, currentDrawdown: peak - runningPnl,
    avgRisk: trades.reduce((sum,t) => sum + t.riskPercent,0) / trades.length,
    avgRR: trades.reduce((sum,t) => sum + t.rr,0) / trades.length,
    maxConsWins, maxConsLosses, sessions, instruments: sorted,
    bestSession: Object.entries(sessions).sort((a,b) => b[1] - a[1])[0][0],
    bestPair: sorted[0]?.[0] ?? "—", worstPair: sorted[sorted.length - 1]?.[0] ?? "—",
  };
}

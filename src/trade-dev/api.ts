import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { TradeAccount } from '../../functions/src/tradeDev/engine';
import type { Quote, SymbolName } from '../../functions/src/tradeDev/market';
export interface Snapshot {
  environment: 'development'; serverTime: number;
  accounts: Pick<TradeAccount, 'accountId' | 'phase' | 'status' | 'balance' | 'equity'>[];
  account: TradeAccount | null; quotes: Record<SymbolName, Quote>;
  instruments: { symbol: SymbolName; name: string; assetClass: string; tickSize: number; contractSize: number; leverage: number; spreadTicks: number }[];
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  rules: { dailyLossPercent: number; maximumLossPercent: number; phaseOneTarget: number; phaseTwoTarget: number; minimumTradingDays: number };
  outbox: { accountId: string; type: string; subject: string; text?: string; status: string; createdAt: number }[];
}
export async function tradeCall<T = unknown>(data: Record<string, unknown>): Promise<T> {
  if (!import.meta.env.DEV || import.meta.env.VITE_FYNX_TRADE_DEV !== 'true' || !functions) throw Error('This terminal is available only in local development.');
  return (await httpsCallable(functions, 'fynxTradeDev')(data)).data as T;
}
export async function snapshot(accountId: string, symbol: SymbolName, timeframe: number) {
  const result = await tradeCall<Snapshot>({ action: 'snapshot', ...(accountId ? { accountId } : {}), symbol, timeframe });
  if (result?.environment !== 'development' || !Array.isArray(result.accounts) || !Array.isArray(result.candles)) throw Error('Could not confirm the development account.');
  return result;
}

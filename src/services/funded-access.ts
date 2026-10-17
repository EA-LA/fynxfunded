import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { parseOrderProgress, parseTradingAccess } from './funded-access-policy';
export interface OrderProgress { orderId: string; challengeId: string | null; accountId: string | null; state: string; title: string; message: string; paymentConfirmed: boolean; accountReady: boolean; checkedAt: string; paymentStatus: string; }
export interface TradingAccess { accountId: string; challengeId: string; userId: string; platform: string; server: string; login: string; password: string; tradingUrl: string | null; }
export async function fundedAccessCall<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const uid = auth?.currentUser?.uid;
  if (!uid || !functions) throw Error('Sign in to continue.');
  const result = await httpsCallable<Record<string, unknown>, T>(functions, name, { timeout: 30000 })(data);
  if (auth?.currentUser?.uid !== uid) throw Error('Your session changed. Open the account again.');
  return result.data;
}
export const getOrderProgress = async (orderId: string) => parseOrderProgress(await fundedAccessCall('fundedOrderStatus', { orderId }), orderId);
export const revealTradingAccess = async (accountId: string, challengeId: string) => {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw Error('Sign in to continue.');
  return parseTradingAccess(await fundedAccessCall('fundedTradingAccess', { action: 'reveal', accountId, challengeId }), uid, accountId, challengeId);
};

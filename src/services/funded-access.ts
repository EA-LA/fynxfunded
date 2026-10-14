import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
export interface OrderProgress { orderId: string; challengeId: string | null; accountId: string | null; state: string; title: string; message: string; paymentConfirmed: boolean; accountReady: boolean; checkedAt: string; paymentStatus: string; }
export interface TradingAccess { accountId: string; challengeId: string; userId: string; platform: string; server: string; login: string; password: string; tradingUrl: string | null; }
export async function fundedAccessCall<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const uid = auth?.currentUser?.uid;
  if (!uid || !functions) throw Error('Sign in to continue.');
  const result = await httpsCallable<Record<string, unknown>, T>(functions, name)(data);
  if (auth?.currentUser?.uid !== uid) throw Error('Your session changed. Open the account again.');
  return result.data;
}
export const getOrderProgress = (orderId: string) => fundedAccessCall<OrderProgress>('fundedOrderStatus', { orderId });
export const revealTradingAccess = (accountId: string, challengeId: string) => fundedAccessCall<TradingAccess>('fundedTradingAccess', { action: 'reveal', accountId, challengeId });

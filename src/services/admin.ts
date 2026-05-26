import { collection, getDocs, query, where, doc, updateDoc, addDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { dataService } from "@/services/database";
import { evaluateRules } from "@/services/rules-engine";
import type { Challenge, Order, PayoutRequest, TradingAccount, User } from "@/services/types";

export interface AdminOverview {
  users: User[];
  accounts: TradingAccount[];
  challenges: Challenge[];
  payouts: PayoutRequest[];
  orders: Order[];
  violations: any[];
  activity: any[];
}

async function getAllFirestore(col: string) {
  if (!db) return [];
  const snap = await getDocs(collection(db, col));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function getAdminOverview(): Promise<AdminOverview> {
  if (isFirebaseConfigured) {
    const [users, accounts, challenges, payouts, orders, violations, activity] = await Promise.all([
      getAllFirestore("users"), getAllFirestore("accounts"), getAllFirestore("challenges"), getAllFirestore("payouts"), getAllFirestore("orders"), getAllFirestore("violations"), getAllFirestore("audit_logs")
    ]);
    return { users: users as User[], accounts: accounts as TradingAccount[], challenges: challenges as Challenge[], payouts: payouts as PayoutRequest[], orders: orders as Order[], violations, activity };
  }

  const user = await dataService.getUser("local-user");
  const users = user ? [user] : [];
  const accounts = user ? await dataService.getAccounts(user.userId) : [];
  const challenges = user ? await dataService.getChallenges(user.userId) : [];
  const payouts = user ? await dataService.getPayouts(user.userId) : [];
  const orders = user ? await dataService.getOrders(user.userId) : [];
  return { users, accounts, challenges, payouts, orders, violations: [], activity: [] };
}

export async function updateAccountLifecycle(accountId: string, status: TradingAccount["status"], reason: string) {
  if (db && isFirebaseConfigured) {
    await updateDoc(doc(db, "accounts", accountId), { status, challengeStatus: status });
    await addDoc(collection(db, "violations"), { accountId, rule: reason, actionTaken: status === "breached" ? "auto close" : "warning", timestamp: new Date().toISOString() });
  }
}

export async function runRuleEngineOnAccount(account: TradingAccount) {
  if (!account.rules) return null;
  const result = await evaluateRules(account.accountId, {
    accountSize: account.rules.startingBalance,
    dailyLossPct: account.rules.dailyLossPct,
    maxLossPct: account.rules.maxLossPct,
    minTradingDays: account.rules.minTradingDays,
    profitTargetPct: account.rules.profitTargetPct,
  });
  if (result.violations.length) {
    await updateAccountLifecycle(account.accountId, "breached", result.violations.map((v) => v.rule).join(", "));
  }
  return result;
}

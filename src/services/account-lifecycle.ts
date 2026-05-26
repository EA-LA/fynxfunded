import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { challengeConfigs } from "@/lib/challengeConfig";
import type { Order } from "@/services/types";

export async function createAccountFromOrder(order: Order) {
  const size = order.accountSize;
  const cfg = challengeConfigs.find((c) => c.accountSize === size);
  const phase = (order.phase?.toLowerCase() || "2-phase") as "1-phase" | "2-phase" | "3-phase";
  const rules = cfg?.phases[phase];
  if (!db || !rules) return;

  const challengeRef = await addDoc(collection(db, "challenges"), {
    userId: order.userId, orderId: order.orderId, accountSize: size, phase: order.phase, style: order.style, status: "active", plan: order.challenge, startDate: new Date().toISOString(),
  });

  await addDoc(collection(db, "accounts"), {
    userId: order.userId, challengeId: challengeRef.id, plan: order.challenge, balance: size, equity: size, status: "active", challengeStatus: "active",
    rules: { startingBalance: size, profitTargetPct: Number(rules.profitTargets[0].replace('%','')), dailyLossPct: Number(rules.dailyLoss.replace('%','')), maxLossPct: Number(rules.maxLoss.replace('%','')), minTradingDays: rules.minDays },
    metrics: { dailyDrawdownPct: 0, maxDrawdownPct: 0, profitTargetPct: Number(rules.profitTargets[0].replace('%','')), profitPct: 0, tradingDays: 0, minTradingDays: rules.minDays },
  });

  await addDoc(collection(db, "audit_logs"), { action: "account_created", accountSize: size, orderId: order.orderId, userId: order.userId, timestamp: new Date().toISOString() });
}

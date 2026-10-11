import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, type DocumentData } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { mapClosedTrade, selectTradingData, type Trade, type TradingData } from "@/lib/tradingData";
export { computeAnalytics } from "@/lib/tradingData";
export type { Trade, TradingData, AccountObjectives, PayoutInfo, PayoutRecord } from "@/lib/tradingData";

type SnapshotState = { userId: string; accounts: DocumentData[]; challenges: DocumentData[]; trades: Trade[]; ready: string[]; error: string };
const empty = (userId = ""): SnapshotState => ({userId, accounts: [], challenges: [], trades: [], ready: [], error: ""});

export function useTradingData(challengeId?: string): TradingData {
  const { user } = useAuth();
  const userId = user?.userId ?? "";
  const [state, setState] = useState<SnapshotState>(() => empty());
  useEffect(() => {
    setState(empty(userId));
    if (!userId || !db) return;
    let active = true;
    const unsubscribe = (["accounts", "challenges", "trades"] as const).map(name =>
      onSnapshot(query(collection(db, name), where("userId", "==", userId)), snapshot => {
        if (!active) return;
        const rows = name === "trades"
          ? snapshot.docs.map(doc => mapClosedTrade(doc.id, doc.data())).filter((trade): trade is Trade => trade !== null)
          : snapshot.docs.map(doc => ({...doc.data(), id: doc.id}));
        setState(previous => ({...previous, [name]: rows, ready: [...new Set([...previous.ready, name])]}));
      }, () => {
        if (!active) return;
        setState(previous => ({...previous, [name]: [], error: "Trading records could not be loaded. Please retry or contact support.", ready: [...new Set([...previous.ready, name])]}));
      })
    );
    return () => { active = false; unsubscribe.forEach(stop => stop()); };
  }, [userId]);
  return useMemo(() => {
    // Never render the previous customer's records while listeners switch users.
    const current = state.userId === userId ? state : empty(userId);
    return {...selectTradingData(current.accounts, current.challenges, current.trades, challengeId), loading: Boolean(userId && db && current.ready.length < 3), error: current.error};
  }, [state, userId, challengeId]);
}

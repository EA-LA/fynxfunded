import { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { createGateway, type GatewayStatus, type TradingGateway } from "@/engine/gateway";
import type { Snapshot } from "@/engine/venue";

export interface EngineHandle {
  gateway: TradingGateway;
  status: GatewayStatus | null;
  snapshot: Snapshot | null;
  error: string;
  busy: boolean;
  /** Runs a gateway command and keeps the latest snapshot; returns false when it failed. */
  run: (fn: (g: TradingGateway) => Promise<Snapshot>) => Promise<boolean>;
}

/**
 * Connects the terminal to the trading engine. Without VITE_FYNX_TRADE_API_URL
 * the gateway is "disconnected" and nothing is sent anywhere.
 */
export function useEngine(accountId: string | null, gatewayOverride?: TradingGateway): EngineHandle {
  const gateway = useMemo(() => gatewayOverride ?? createGateway(import.meta.env.VITE_FYNX_TRADE_API_URL, async () => (await auth?.currentUser?.getIdToken()) ?? null), [gatewayOverride]);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    gateway.status().then(s => { if (active) setStatus(s); });
    return () => { active = false; };
  }, [gateway]);

  const connected = !!status?.connected;
  useEffect(() => {
    setSnapshot(null);
    if (!connected || !accountId) return;
    let active = true;
    const load = () => gateway.snapshot(accountId).then(s => { if (active) setSnapshot(s); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load the account."); });
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2000);
    return () => { active = false; window.clearInterval(t); };
  }, [gateway, connected, accountId]);

  const run = useCallback(async (fn: (g: TradingGateway) => Promise<Snapshot>) => {
    setBusy(true); setError("");
    try { setSnapshot(await fn(gateway)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "The request failed."); return false; }
    finally { setBusy(false); }
  }, [gateway]);

  return { gateway, status, snapshot, error, busy, run };
}

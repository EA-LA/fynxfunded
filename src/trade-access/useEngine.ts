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
export interface EngineOptions {
  /** How often the account snapshot is refreshed while the page is visible (ms). The terminal uses 2 s. */
  pollMs?: number;
  /** false: no status or account calls at all (e.g. the account is not on FYNX Trade). */
  enabled?: boolean;
}

export function useEngine(accountId: string | null, gatewayOverride?: TradingGateway, options: EngineOptions = {}): EngineHandle {
  const { pollMs = 2000, enabled = true } = options;
  const gateway = useMemo(() => gatewayOverride ?? createGateway(import.meta.env.VITE_FYNX_TRADE_API_URL, async () => (await auth?.currentUser?.getIdToken()) ?? null), [gatewayOverride]);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    if (!enabled) return;
    let active = true;
    const load = () => gateway.status().then(s => { if (active) setStatus(s); });
    void load();
    // Market hours and feed health come from status; refresh it so a reopen or holiday is picked up.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { active = false; window.clearInterval(t); };
  }, [gateway, enabled]);

  const connected = enabled && !!status?.connected;
  useEffect(() => {
    setSnapshot(null); setError("");
    if (!connected || !accountId) return;
    let active = true;
    const load = () => gateway.snapshot(accountId).then(s => { if (active) setSnapshot(s); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load the account."); });
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, pollMs);
    return () => { active = false; window.clearInterval(t); };
  }, [gateway, connected, accountId, pollMs]);

  const run = useCallback(async (fn: (g: TradingGateway) => Promise<Snapshot>) => {
    setBusy(true); setError("");
    try { setSnapshot(await fn(gateway)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "The request failed."); return false; }
    finally { setBusy(false); }
  }, [gateway]);

  return { gateway, status, snapshot, error, busy, run };
}

/** Short label for the engine status pill. The full sentence from the server is its tooltip. */
export function engineLabel(status: GatewayStatus | null): string {
  if (!status?.connected) return "Engine not connected";
  if (status.paused) return "Engine connected · new trading paused";
  if (status.execution) return "Trading engine live";
  return status.priceFeed ? "Engine connected · order checks paused" : "Engine connected · waiting for prices";
}

import { useEffect, useRef, useState } from "react";

/**
 * Official hosted TradingView display widget. Display only: never read its
 * prices into an execution engine. Loaded only after the viewer agrees, because
 * TradingView receives their connection details.
 */
export const LIVE_PRICES_KEY = "fynx-trade-live-prices";

export function readLiveConsent(): boolean {
  try { return localStorage.getItem(LIVE_PRICES_KEY) === "yes"; } catch { return false; }
}
export function saveLiveConsent(value: boolean) {
  try { if (value) localStorage.setItem(LIVE_PRICES_KEY, "yes"); else localStorage.removeItem(LIVE_PRICES_KEY); } catch { /* storage unavailable */ }
}

export default function TvWidget({ script, config, className, title }: { script: string; config: Record<string, unknown>; className?: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(config);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setFailed(false);
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    const tag = document.createElement("script");
    tag.src = `https://s3.tradingview.com/external-embedding/embed-widget-${script}.js`;
    tag.async = true;
    tag.textContent = key;
    tag.onerror = () => setFailed(true);
    container.append(widget, tag);
    return () => { tag.onerror = null; container.replaceChildren(); };
  }, [script, key]);
  return (
    <div className={className} aria-label={title} role="region">
      <div className="relative h-full w-full">
        <div ref={host} className="tradingview-widget-container h-full w-full" />
        {failed && <p role="alert" className="absolute inset-0 grid place-items-center bg-card p-3 text-center text-xs text-muted-foreground">{title} could not load. Check your connection and try again.</p>}
      </div>
    </div>
  );
}

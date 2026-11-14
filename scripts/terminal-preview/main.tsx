import "./clock";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "@/index.css";
import TradeAccess from "@/trade-access/TradeAccess";
import { LocalGatewayAdapter } from "@/engine/gateway";
import { buildSpecs, LocalVenue, MemoryStore, rulesFromPurchase, StaticQuoteFeed } from "@/engine/venue";
import { FOREX_PAIRS } from "@/trade-access/instruments";
import { account } from "./stubs";

// `?risk=1&demo=empty` previews the optional "maximum risk per trade" rule (1 %).
// Simulated prices (random walk) so every tab can be seen with live figures.
const base: Record<string, number> = { EURUSD: 1.1022, GBPUSD: 1.3124, USDJPY: 151.42, USDCHF: 0.8812, AUDUSD: 0.6611, USDCAD: 1.3874, NZDUSD: 0.6012, EURGBP: 0.8398, EURJPY: 166.9, GBPJPY: 198.7 };
const specs = buildSpecs(FOREX_PAIRS, { leverage: 100, commissionPerLotPerSide: 3.5, maxLots: 50 });
const venue = new LocalVenue(specs, new MemoryStore(), async () => rulesFromPurchase(account.startingBalance, { ...(account.rules as never), ...(new URLSearchParams(location.search).get("risk") ? { max_risk_per_trade_percent: new URLSearchParams(location.search).get("risk") } : {}) }), { maxQuoteAgeMs: 60_000 });
const feed = new StaticQuoteFeed(); venue.connect(feed);
const mids: Record<string, number> = {};
for (const p of FOREX_PAIRS) mids[p.symbol] = base[p.symbol] ?? (p.quote === "JPY" ? 120 + Math.random() * 60 : p.pipSize === 0.01 ? 20 + Math.random() * 40 : 0.6 + Math.random() * 1.2);
const push = () => { const t = Date.now(); for (const p of FOREX_PAIRS) { mids[p.symbol] += (Math.random() - 0.5) * p.pipSize * 4; const half = p.pipSize * (p.group === "Majors" ? 0.4 : p.group === "Minors" ? 0.9 : 6); feed.push({ symbol: p.symbol, bid: +(mids[p.symbol] - half).toFixed(p.digits), ask: +(mids[p.symbol] + half).toFixed(p.digits), time: t }); } };
push(); window.setInterval(push, 1000);
const gateway = new LocalGatewayAdapter(venue);
(async () => {
  const id = account.accountId; await venue.open(id);
  if (new URLSearchParams(location.search).get("demo") !== "empty") {
    await venue.place(id, { symbol: "EURUSD", side: "buy", type: "market", lots: 1, stopLoss: +(mids.EURUSD - 0.0025).toFixed(5), takeProfit: +(mids.EURUSD + 0.005).toFixed(5) });
    await venue.place(id, { symbol: "GBPJPY", side: "sell", type: "market", lots: 0.5 });
    const c = await venue.place(id, { symbol: "USDJPY", side: "buy", type: "market", lots: 2 });
    await venue.close(id, c.state.positions.find(p => p.symbol === "USDJPY")!.id);
    const d = await venue.place(id, { symbol: "AUDUSD", side: "sell", type: "market", lots: 1.5 });
    await venue.close(id, d.state.positions.find(p => p.symbol === "AUDUSD")!.id);
    await venue.place(id, { symbol: "EURUSD", side: "buy", type: "limit", lots: 0.5, price: +(mids.EURUSD - 0.004).toFixed(5) });
  }
  createRoot(document.getElementById("root")!).render(
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}><BrowserRouter><Routes><Route path="*" element={<TradeAccess gateway={gateway} />} /></Routes></BrowserRouter><Toaster /></ThemeProvider>);
})();

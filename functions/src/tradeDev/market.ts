/** Synthetic USD-quoted instruments. No exchange or broker data is used. */
export const instruments = [
  { symbol: 'EURUSD', name: 'Euro / US Dollar', assetClass: 'Forex', tickSize: 0.00001, contractSize: 100000, lotStep: 0.01, maxLots: 10, leverage: 30, base: 1.085, amplitude: 0.003, spreadTicks: 12 },
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', assetClass: 'Metals', tickSize: 0.01, contractSize: 100, lotStep: 0.01, maxLots: 10, leverage: 20, base: 2650, amplitude: 12, spreadTicks: 30 },
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', assetClass: 'Crypto', tickSize: 0.01, contractSize: 1, lotStep: 0.01, maxLots: 10, leverage: 2, base: 68000, amplitude: 500, spreadTicks: 2000 },
] as const;
export type SymbolName = typeof instruments[number]['symbol'];
export interface Quote { symbol: SymbolName; bid: number; ask: number; time: number; source: 'synthetic'; open: boolean }
export interface MarketDataAdapter { quote(symbol: SymbolName, now: number): Quote }
export function instrument(symbol: string) {
  const value = instruments.find(x => x.symbol === symbol);
  if (!value) throw Error('Instrument is unavailable in this development market.');
  return value;
}
export const syntheticMarket: MarketDataAdapter = {
  quote(symbol, now) {
    const spec = instrument(symbol), second = Math.floor(now / 1000);
    const midpoint = spec.base + spec.amplitude * (Math.sin(second / 97) * 0.65 + Math.sin(second / 19) * 0.25 + Math.cos(second / 7) * 0.1);
    const bidTicks = Math.round(midpoint / spec.tickSize - spec.spreadTicks / 2);
    return { symbol, bid: Number((bidTicks * spec.tickSize).toFixed(5)), ask: Number(((bidTicks + spec.spreadTicks) * spec.tickSize).toFixed(5)), time: second * 1000, source: 'synthetic', open: true };
  },
};
export const marketQuotes = (now: number) => Object.fromEntries(instruments.map(x => [x.symbol, syntheticMarket.quote(x.symbol, now)])) as Record<SymbolName, Quote>;
export function candles(symbol: SymbolName, timeframe: number, now: number) {
  if (![60, 300, 900].includes(timeframe)) throw Error('Choose a supported timeframe.');
  const end = Math.floor(now / 1000 / timeframe) * timeframe;
  return Array.from({ length: 120 }, (_, i) => {
    const time = end - (119 - i) * timeframe;
    const prices = Array.from({ length: Math.min(timeframe, Math.floor(now / 1000) - time + 1) }, (_, offset) => syntheticMarket.quote(symbol, (time + offset) * 1000).bid);
    return { time, open: prices[0], close: prices[prices.length - 1], high: Math.max(...prices), low: Math.min(...prices) };
  });
}

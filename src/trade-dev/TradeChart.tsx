import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { Snapshot } from './api';
export default function TradeChart({ candles, line, light, precision }: { precision: number; candles: Snapshot['candles']; line: boolean; light: boolean }) {
  const container = useRef<HTMLDivElement>(null), chart = useRef<IChartApi>(), series = useRef<ISeriesApi<'Candlestick' | 'Line'>>();
  const initialized = useRef(false), lastTime = useRef(0);
  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, {
      autoSize: true, height: 370,
      layout: { textColor: light ? '#57657c' : '#8492a9', background: { type: ColorType.Solid, color: light ? '#ffffff' : '#101722' }, attributionLogo: true },
      grid: { vertLines: { color: light ? '#eef1f6' : '#1b2534' }, horzLines: { color: light ? '#eef1f6' : '#1b2534' } },
      timeScale: { timeVisible: true, borderColor: '#344155' }, rightPriceScale: { borderColor: '#344155' },
    });
    chart.current = instance;
    series.current = line ? instance.addSeries(LineSeries, { color: '#36bfa1', lineWidth: 2, priceFormat: { type: "price", precision, minMove: 10 ** -precision } }) : instance.addSeries(CandlestickSeries, { upColor: '#36bfa1', downColor: '#f07684', borderVisible: false, wickUpColor: '#36bfa1', wickDownColor: '#f07684', priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    initialized.current = false; lastTime.current = 0;
    return () => { instance.remove(); chart.current = undefined; series.current = undefined; };
  }, [line, light, precision]);
  useEffect(() => {
    if (!series.current) return;
    const rows = candles.map(c => line ? { time: c.time as UTCTimestamp, value: c.close } : { ...c, time: c.time as UTCTimestamp });
    if (!lastTime.current) series.current.setData(rows);
    else rows.filter(row => Number(row.time) >= lastTime.current).forEach(row => series.current?.update(row));
    lastTime.current = candles[candles.length - 1]?.time ?? 0;
    if (!initialized.current && candles.length) { chart.current?.timeScale().fitContent(); initialized.current = true; }
  }, [candles, line, light, precision]);
  return <div ref={container} className="trade-chart" aria-label="Synthetic price chart" role="img" />;
}

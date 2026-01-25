import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

export default function CandlesChart({ symbol, interval, candles }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#10182b' },
        textColor: '#8b94a5'
      },
      grid: {
        vertLines: { color: '#1f2a44' },
        horzLines: { color: '#1f2a44' }
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      width: ref.current.clientWidth,
      height: 320
    });
    const series = chart.addCandlestickSeries({
      upColor: '#3fe38c',
      downColor: '#ff7676',
      wickUpColor: '#3fe38c',
      wickDownColor: '#ff7676',
      borderVisible: false
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const handleResize = () => {
      if (ref.current) {
        chart.applyOptions({ width: ref.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !candles) return;
    const data = (candles || []).map((c) => ({
      time: Math.floor((c.closeTime || c.openTime) / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    seriesRef.current.setData(data);
    if (chartRef.current && data.length) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>
        {symbol} · {interval} Candlesticks
      </h3>
      <div ref={ref} style={{ width: '100%', height: 340 }} />
      {!candles?.length && <p style={{ color: '#9aa3b5' }}>Waiting for data...</p>}
    </div>
  );
}

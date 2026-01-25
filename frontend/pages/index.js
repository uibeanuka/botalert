import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import SignalTable from '../components/SignalTable';
import AIAdvisor from '../components/AIAdvisor';
import { fetchSignals, fetchCandles, fetchMeta } from '../lib/api';
import { getSocket } from '../lib/socket';
import { registerPush } from '../lib/pushClient';

const CandlesChart = dynamic(() => import('../components/CandlesChart'), { ssr: false });

export default function Home() {
  const [signals, setSignals] = useState([]);
  const [candles, setCandles] = useState([]);
  const [symbols, setSymbols] = useState(['BTCUSDT']);
  const [intervals, setIntervals] = useState(['1m']);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('1m');

  useEffect(() => {
    (async () => {
      try {
        const meta = await fetchMeta();
        if (meta?.symbols?.length) {
          setSymbols(meta.symbols);
          setSelectedSymbol(meta.symbols[0]);
        }
        if (meta?.intervals?.length) {
          setIntervals(meta.intervals);
          setSelectedInterval(meta.intervals[0]);
        }
        const initialSignals = await fetchSignals();
        setSignals(initialSignals);
      } catch (error) {
        console.error('Failed to load signals', error);
      }
      refreshCandles(selectedSymbol, selectedInterval);
      registerPush();
    })();
  }, []);

  useEffect(() => {
    refreshCandles(selectedSymbol, selectedInterval);
  }, [selectedSymbol, selectedInterval]);

  useEffect(() => {
    const socket = getSocket();
    const onBootstrap = (payload) => {
        if (payload?.signals) setSignals(payload.signals);
        if (payload?.symbols?.length) setSymbols(payload.symbols);
        if (payload?.intervals?.length) setIntervals(payload.intervals);
    };
    const onSignal = (payload) => {
      setSignals((prev) => {
        const filtered = prev.filter((s) => !(s.symbol === payload.symbol && s.interval === payload.interval));
        return [payload, ...filtered].slice(0, 50);
      });
      if (payload.symbol === selectedSymbol && payload.interval === selectedInterval) {
        refreshCandles(payload.symbol, payload.interval);
      }
    };
    socket.on('bootstrap', onBootstrap);
    socket.on('signal', onSignal);
    return () => {
      socket.off('bootstrap', onBootstrap);
      socket.off('signal', onSignal);
    };
  }, [selectedSymbol, selectedInterval]);

  const selectedSignal = useMemo(
    () => signals.find((s) => s.symbol === selectedSymbol && s.interval === selectedInterval),
    [signals, selectedSymbol, selectedInterval]
  );

  async function refreshCandles(symbol, interval) {
    try {
      const data = await fetchCandles(symbol, interval);
      setCandles(data);
    } catch (error) {
      console.error('Failed to load candles', error);
      setCandles([]);
    }
  }

  return (
    <>
      <Head>
        <title>Binance Futures AI Alerts</title>
        <link rel="manifest" href="/manifest.json" />
      </Head>
      <main style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Binance Futures AI Alerts</h1>
            <p style={{ color: '#8b94a5', marginTop: 4 }}>
              Real-time RSI · MACD · KDJ · Breakouts · AI scoring · Push notifications
            </p>
          </div>
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: '#8b94a5', marginRight: 8 }}>Symbol</label>
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  style={{
                    background: '#10182b',
                    color: '#f2f4f7',
                    border: '1px solid #1f2a44',
                    borderRadius: 8,
                    padding: '8px 12px'
                  }}
                >
                  {symbols.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#8b94a5', marginRight: 8 }}>Interval</label>
                <select
                  value={selectedInterval}
                  onChange={(e) => setSelectedInterval(e.target.value)}
                  style={{
                    background: '#10182b',
                    color: '#f2f4f7',
                    border: '1px solid #1f2a44',
                    borderRadius: 8,
                    padding: '8px 12px'
                  }}
                >
                  {intervals.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        <div className="grid" style={{ marginTop: 16 }}>
          <CandlesChart symbol={selectedSymbol} interval={selectedInterval} candles={candles} />
          <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
            <SignalTable signals={signals} />
            <AIAdvisor signals={signals} />
            <IndicatorSummary signal={selectedSignal} />
          </div>
        </div>
      </main>
    </>
  );
}

function IndicatorSummary({ signal }) {
  if (!signal) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Indicator Snapshot</h3>
        <p style={{ color: '#9aa3b5' }}>Waiting for data...</p>
      </div>
    );
  }

  const { indicators } = signal;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Indicator Snapshot</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Stat label="RSI" value={indicators?.rsi} suffix="" />
        <Stat label="MACD hist" value={indicators?.macd?.histogram} />
        <Stat label="KDJ J" value={indicators?.kdj?.j} />
        <Stat label="Volume spike" value={indicators?.volumeSpike ? 'Yes' : 'No'} />
        <Stat label="Breakout" value={indicators?.breakout?.direction || 'None'} />
        <Stat label="Patterns" value={(indicators?.patterns || []).join(', ') || 'None'} />
      </div>
    </div>
  );
}

function Stat({ label, value, suffix }) {
  const text =
    value === undefined || value === null
      ? '–'
      : typeof value === 'number'
      ? Number(value).toFixed(2)
      : String(value);
  return (
    <div style={{ padding: 8, border: '1px solid #1f2a44', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#8b94a5' }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{text + (suffix || '')}</div>
    </div>
  );
}

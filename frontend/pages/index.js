import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import SignalTable from '../components/SignalTable';
import AIAdvisor from '../components/AIAdvisor';
import ChatWidget from '../components/ChatWidget';
import BottomNav from '../components/BottomNav';
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
  const [isConnected, setIsConnected] = useState(false);

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
        setIsConnected(true);
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
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onBootstrap = (payload) => {
      if (payload?.signals) setSignals(payload.signals);
      if (payload?.symbols?.length) setSymbols(payload.symbols);
      if (payload?.intervals?.length) setIntervals(payload.intervals);
    };
    const onSignal = (payload) => {
      setSignals((prev) => {
        const filtered = prev.filter((s) => !(s.symbol === payload.symbol && s.interval === payload.interval));
        return [payload, ...filtered].slice(0, 100);
      });
      if (payload.symbol === selectedSymbol && payload.interval === selectedInterval) {
        refreshCandles(payload.symbol, payload.interval);
      }
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('bootstrap', onBootstrap);
    socket.on('signal', onSignal);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('bootstrap', onBootstrap);
      socket.off('signal', onSignal);
    };
  }, [selectedSymbol, selectedInterval]);

  const selectedSignal = useMemo(
    () => signals.find((s) => s.symbol === selectedSymbol && s.interval === selectedInterval),
    [signals, selectedSymbol, selectedInterval]
  );

  const topSignals = useMemo(() => {
    return [...signals]
      .filter((s) => s.ai?.confidence >= 0.6)
      .sort((a, b) => (b.ai?.confidence || 0) - (a.ai?.confidence || 0))
      .slice(0, 10);
  }, [signals]);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1]?.close : null;
  const priceChange = candles.length > 1
    ? ((candles[candles.length - 1]?.close - candles[0]?.open) / candles[0]?.open) * 100
    : 0;

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
    <div className="page with-bottom-nav">
      <Head>
        <title>FuturesAI - Trading Signals</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="description" content="Real-time Binance Futures AI trading signals" />
        <meta name="theme-color" content="#0a0e17" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FuturesAI" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
      </Head>

      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo">
              <div className="logo-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <span>FuturesAI</span>
            </div>
            <div className="status-badge">
              <span className="status-dot"></span>
              {isConnected ? 'Live' : 'Connecting...'}
            </div>
          </div>
          <div className="header-right">
            <div className="select-group">
              <span className="select-label">Pair</span>
              <select
                className="select"
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
              >
                {symbols.map((s) => (
                  <option key={s} value={s}>{s.replace('USDT', '/USDT')}</option>
                ))}
              </select>
            </div>
            <div className="select-group">
              <span className="select-label">TF</span>
              <select
                className="select"
                value={selectedInterval}
                onChange={(e) => setSelectedInterval(e.target.value)}
              >
                {intervals.map((i) => (
                  <option key={i} value={i}>{i.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Dashboard */}
      <div className="dashboard">
        <div className="main-content">
          {/* Chart Section */}
          <div className="chart-container">
            <div className="chart-header">
              <div className="chart-title">
                <span className="chart-symbol">{selectedSymbol.replace('USDT', '/USDT')}</span>
                <span className="signal-interval">{selectedInterval.toUpperCase()}</span>
                {selectedSignal && (
                  <span className={`tag tag-${selectedSignal.signal?.toLowerCase() || 'neutral'}`}>
                    {selectedSignal.signal}
                  </span>
                )}
              </div>
              <div className="chart-price">
                {currentPrice && (
                  <>
                    <span className="chart-price-value">
                      ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className={`chart-price-change ${priceChange >= 0 ? 'positive' : 'negative'}`}>
                      {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="chart-body">
              <CandlesChart symbol={selectedSymbol} interval={selectedInterval} candles={candles} />
            </div>
          </div>

          {/* Indicators Panel */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Technical Indicators</span>
              {selectedSignal?.ai && (
                <span className={`tag tag-${selectedSignal.signal?.toLowerCase() || 'neutral'}`}>
                  {(selectedSignal.ai.confidence * 100).toFixed(0)}% Confidence
                </span>
              )}
            </div>
            <div className="stats-grid">
              <StatItem
                label="RSI (14)"
                value={selectedSignal?.indicators?.rsi}
                format="number"
                status={getRsiStatus(selectedSignal?.indicators?.rsi)}
              />
              <StatItem
                label="MACD Histogram"
                value={selectedSignal?.indicators?.macd?.histogram}
                format="number"
                status={selectedSignal?.indicators?.macd?.histogram > 0 ? 'positive' : 'negative'}
              />
              <StatItem
                label="KDJ J-Line"
                value={selectedSignal?.indicators?.kdj?.j}
                format="number"
                status={getKdjStatus(selectedSignal?.indicators?.kdj?.j)}
              />
              <StatItem
                label="Volume Spike"
                value={selectedSignal?.indicators?.volumeSpike ? 'Detected' : 'Normal'}
                status={selectedSignal?.indicators?.volumeSpike ? 'positive' : 'neutral'}
              />
              <StatItem
                label="Breakout"
                value={selectedSignal?.indicators?.breakout?.direction || 'None'}
                status={selectedSignal?.indicators?.breakout?.direction ? 'positive' : 'neutral'}
              />
              <StatItem
                label="Bollinger %B"
                value={selectedSignal?.indicators?.bollinger?.pb}
                format="percent"
                status={getBollingerStatus(selectedSignal?.indicators?.bollinger?.pb)}
              />
            </div>
          </div>

          {/* Signal Feed */}
          <SignalTable signals={signals} selectedSymbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} />
        </div>

        {/* Sidebar */}
        <div className="sidebar">
          <AIAdvisor signals={topSignals} />

          {/* Quick Stats */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Market Overview</span>
            </div>
            <div className="stats-grid">
              <StatItem label="Total Pairs" value={symbols.length} />
              <StatItem label="Active Signals" value={signals.length} />
              <StatItem
                label="Long Signals"
                value={signals.filter(s => s.signal === 'LONG').length}
                status="positive"
              />
              <StatItem
                label="Short Signals"
                value={signals.filter(s => s.signal === 'SHORT').length}
                status="negative"
              />
            </div>
          </div>

          {/* Trade Levels Panel */}
          {selectedSignal?.ai?.trade && (
            <div className="card trade-levels-card">
              <div className="card-header">
                <div className="ai-header">
                  <div className="ai-icon" style={{ background: selectedSignal.ai.trade.type === 'LONG' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {selectedSignal.ai.trade.type === 'LONG' ? '↑' : '↓'}
                  </div>
                  <span className="card-title">{selectedSignal.ai.trade.type} Trade Setup</span>
                </div>
                <span className={`tag ${selectedSignal.ai.trade.type === 'LONG' ? 'tag-long' : 'tag-short'}`}>
                  R:R {selectedSignal.ai.trade.rewardRatio}
                </span>
              </div>

              <div className="trade-levels">
                <div className="trade-level entry">
                  <span className="trade-level-label">Entry</span>
                  <span className="trade-level-value">${formatPrice(selectedSignal.ai.trade.entry)}</span>
                </div>
                <div className="trade-level stop-loss">
                  <span className="trade-level-label">Stop Loss</span>
                  <span className="trade-level-value">${formatPrice(selectedSignal.ai.trade.stopLoss)}</span>
                  <span className="trade-level-risk">-{selectedSignal.ai.trade.riskPercent}%</span>
                </div>
                <div className="trade-level-divider"></div>
                <div className="trade-level tp">
                  <span className="trade-level-label">TP1</span>
                  <span className="trade-level-value">${formatPrice(selectedSignal.ai.trade.takeProfit?.[0])}</span>
                </div>
                <div className="trade-level tp">
                  <span className="trade-level-label">TP2</span>
                  <span className="trade-level-value">${formatPrice(selectedSignal.ai.trade.takeProfit?.[1])}</span>
                </div>
                <div className="trade-level tp">
                  <span className="trade-level-label">TP3</span>
                  <span className="trade-level-value">${formatPrice(selectedSignal.ai.trade.takeProfit?.[2])}</span>
                </div>
              </div>

              <div className="trade-meta">
                <div className="trade-meta-item">
                  <span>ATR</span>
                  <span>${formatPrice(selectedSignal.ai.trade.atr)} ({selectedSignal.ai.trade.atrPercent}%)</span>
                </div>
                <div className="trade-meta-item">
                  <span>Position</span>
                  <span className={`position-size ${selectedSignal.ai.trade.positionSize}`}>
                    {selectedSignal.ai.trade.positionSize?.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* AI Reasons for Selected */}
          {selectedSignal?.ai?.reasons?.length > 0 && (
            <div className="card ai-card">
              <div className="card-header">
                <div className="ai-header">
                  <div className="ai-icon">AI</div>
                  <span className="card-title">Signal Reasoning</span>
                </div>
              </div>
              <div className="ai-reasons" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedSignal.ai.reasons.map((reason, i) => (
                  <div key={i} className="ai-reason" style={{ padding: '8px 12px', fontSize: '0.8125rem' }}>
                    {reason}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ChatWidget />
      <BottomNav />
    </div>
  );
}

function StatItem({ label, value, format, status }) {
  let displayValue = '—';

  if (value !== undefined && value !== null) {
    if (format === 'number' && typeof value === 'number') {
      displayValue = value.toFixed(2);
    } else if (format === 'percent' && typeof value === 'number') {
      displayValue = (value * 100).toFixed(1) + '%';
    } else {
      displayValue = String(value);
    }
  }

  return (
    <div className="stat-item">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${status || ''}`}>{displayValue}</div>
    </div>
  );
}

function getRsiStatus(rsi) {
  if (!rsi) return 'neutral';
  if (rsi < 30) return 'positive';
  if (rsi > 70) return 'negative';
  return 'neutral';
}

function getKdjStatus(j) {
  if (j === undefined || j === null) return 'neutral';
  if (j < 20) return 'positive';
  if (j > 80) return 'negative';
  return 'neutral';
}

function getBollingerStatus(pb) {
  if (pb === undefined || pb === null) return 'neutral';
  if (pb < 0.2) return 'positive';
  if (pb > 0.8) return 'negative';
  return 'neutral';
}

function formatPrice(value) {
  if (value === undefined || value === null) return '—';
  if (value >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

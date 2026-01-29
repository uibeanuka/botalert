import { useEffect, useState } from 'react';
import Head from 'next/head';
import BottomNav from '../components/BottomNav';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export default function AIInsights() {
  const [insights, setInsights] = useState(null);
  const [mlStats, setMlStats] = useState(null);
  const [riskStatus, setRiskStatus] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [fullAnalysis, setFullAnalysis] = useState(null);
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedSymbol) {
      loadSymbolAnalysis(selectedSymbol);
    }
  }, [selectedSymbol]);

  async function loadData() {
    try {
      const [insightsRes, mlRes, riskRes] = await Promise.all([
        fetch(`${API_BASE}/api/ai/learning`).then(r => r.json()),
        fetch(`${API_BASE}/api/ai/ml-stats`).then(r => r.json()),
        fetch(`${API_BASE}/api/ai/risk-status`).then(r => r.json())
      ]);
      setInsights(insightsRes);
      setMlStats(mlRes);
      setRiskStatus(riskRes);
    } catch (err) {
      console.error('Failed to load AI data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSymbolAnalysis(symbol) {
    try {
      const [analysisRes, patternsRes] = await Promise.all([
        fetch(`${API_BASE}/api/ai/full-analysis/${symbol}`).then(r => r.json()),
        fetch(`${API_BASE}/api/ai/patterns/${symbol}`).then(r => r.json())
      ]);
      setFullAnalysis(analysisRes);
      setPatterns(patternsRes);
    } catch (err) {
      console.error('Failed to load symbol analysis:', err);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <Head><title>AI Insights | BotAlert</title></Head>
        <div className="loading">Loading AI Insights...</div>
        <BottomNav />
        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="container">
      <Head><title>AI Insights | BotAlert</title></Head>

      <header className="header">
        <h1>AI Trading Insights</h1>
        <div className="tabs">
          <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Overview</button>
          <button className={activeTab === 'analysis' ? 'active' : ''} onClick={() => setActiveTab('analysis')}>Analysis</button>
          <button className={activeTab === 'learning' ? 'active' : ''} onClick={() => setActiveTab('learning')}>Learning</button>
          <button className={activeTab === 'risk' ? 'active' : ''} onClick={() => setActiveTab('risk')}>Risk</button>
        </div>
      </header>

      <main className="main">
        {activeTab === 'overview' && (
          <div className="overview-grid">
            {/* Risk Status Card */}
            <div className="card risk-card">
              <h3>Risk Status</h3>
              <div className={`risk-level ${riskStatus?.riskLevel?.toLowerCase()}`}>
                {riskStatus?.riskLevel || 'UNKNOWN'}
              </div>
              <div className="risk-stats">
                <div className="stat">
                  <span className="label">Trading</span>
                  <span className={riskStatus?.tradingAllowed ? 'value green' : 'value red'}>
                    {riskStatus?.tradingAllowed ? 'ALLOWED' : 'BLOCKED'}
                  </span>
                </div>
                <div className="stat">
                  <span className="label">Daily P&L</span>
                  <span className={`value ${riskStatus?.currentState?.dailyPnL >= 0 ? 'green' : 'red'}`}>
                    {riskStatus?.currentState?.dailyPnL?.toFixed(2)}%
                  </span>
                </div>
                <div className="stat">
                  <span className="label">Drawdown</span>
                  <span className="value">{riskStatus?.currentState?.currentDrawdown?.toFixed(2)}%</span>
                </div>
                <div className="stat">
                  <span className="label">Trades Today</span>
                  <span className="value">{riskStatus?.currentState?.todayTrades} / {riskStatus?.limits?.maxDailyTrades}</span>
                </div>
              </div>
            </div>

            {/* ML Model Card */}
            <div className="card ml-card">
              <h3>ML Model Performance</h3>
              <div className="ml-stats">
                <div className="stat">
                  <span className="label">Accuracy</span>
                  <span className="value">{mlStats?.stats?.performance?.accuracy || 0}%</span>
                </div>
                <div className="stat">
                  <span className="label">Precision</span>
                  <span className="value">{mlStats?.stats?.performance?.precision || 0}%</span>
                </div>
                <div className="stat">
                  <span className="label">F1 Score</span>
                  <span className="value">{mlStats?.stats?.performance?.f1Score || 0}%</span>
                </div>
                <div className="stat">
                  <span className="label">Training Samples</span>
                  <span className="value">{mlStats?.stats?.trainingDataSize || 0}</span>
                </div>
              </div>
            </div>

            {/* Learning Stats Card */}
            <div className="card learning-card">
              <h3>AI Learning</h3>
              <div className="learning-stats">
                <div className="stat">
                  <span className="label">Total Learnings</span>
                  <span className="value">{insights?.totalLearnings || 0}</span>
                </div>
                <div className="stat">
                  <span className="label">Best Hours (UTC)</span>
                  <span className="value">{insights?.optimalHours?.join(', ') || 'N/A'}</span>
                </div>
                <div className="stat">
                  <span className="label">Best Days</span>
                  <span className="value">{insights?.optimalDays?.slice(0, 2).join(', ') || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Top Signals Performance */}
            <div className="card signals-card">
              <h3>Signal Performance</h3>
              <div className="signal-list">
                {insights?.signalPerformance?.map((sig, i) => (
                  <div key={i} className="signal-item">
                    <span className={`signal-type ${sig.signal.includes('LONG') ? 'long' : 'short'}`}>
                      {sig.signal}
                    </span>
                    <span className="win-rate">{sig.winRate}% win</span>
                    <span className="trades">{sig.trades} trades</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            <div className="card recommendations-card full-width">
              <h3>AI Recommendations</h3>
              <div className="recommendations">
                {insights?.recommendations?.map((rec, i) => (
                  <div key={i} className={`recommendation ${rec.priority || rec.type?.toLowerCase()}`}>
                    <span className="type">{rec.type}</span>
                    <span className="message">{rec.message}</span>
                  </div>
                ))}
                {riskStatus?.recommendations?.map((rec, i) => (
                  <div key={`risk-${i}`} className={`recommendation ${rec.type?.toLowerCase()}`}>
                    <span className="type">{rec.type}</span>
                    <span className="message">{rec.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="analysis-section">
            <div className="symbol-selector">
              <label>Symbol:</label>
              <input
                type="text"
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
                placeholder="BTCUSDT"
              />
              <button onClick={() => loadSymbolAnalysis(selectedSymbol)}>Analyze</button>
            </div>

            {fullAnalysis && (
              <div className="analysis-grid">
                {/* Consensus */}
                <div className="card consensus-card">
                  <h3>AI Consensus</h3>
                  <div className={`consensus-direction ${fullAnalysis.consensus?.direction?.toLowerCase()}`}>
                    {fullAnalysis.consensus?.direction}
                  </div>
                  <div className="consensus-stats">
                    <div className="stat">
                      <span className="label">Agreement</span>
                      <span className="value">{fullAnalysis.consensus?.agreement}</span>
                    </div>
                    <div className="stat">
                      <span className="label">Confidence</span>
                      <span className="value">{fullAnalysis.consensus?.avgConfidence}%</span>
                    </div>
                    <div className="stat">
                      <span className="label">Bullish Votes</span>
                      <span className="value green">{fullAnalysis.consensus?.bullishVotes}</span>
                    </div>
                    <div className="stat">
                      <span className="label">Bearish Votes</span>
                      <span className="value red">{fullAnalysis.consensus?.bearishVotes}</span>
                    </div>
                  </div>
                </div>

                {/* Individual Analyses */}
                <div className="card">
                  <h3>Standard AI</h3>
                  <div className={`signal ${fullAnalysis.analysis?.standard?.signal?.includes('LONG') ? 'long' : 'short'}`}>
                    {fullAnalysis.analysis?.standard?.signal}
                  </div>
                  <div className="confidence">{(fullAnalysis.analysis?.standard?.confidence * 100).toFixed(0)}%</div>
                  <ul className="reasons">
                    {fullAnalysis.analysis?.standard?.reasons?.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>

                <div className="card">
                  <h3>ML Signal</h3>
                  <div className={`signal ${fullAnalysis.analysis?.ml?.signal?.includes('LONG') ? 'long' : 'short'}`}>
                    {fullAnalysis.analysis?.ml?.signal}
                  </div>
                  <div className="confidence">{(fullAnalysis.analysis?.ml?.confidence * 100).toFixed(0)}%</div>
                  <div className="features">
                    {fullAnalysis.analysis?.ml?.topFeatures?.map((f, i) => (
                      <div key={i} className="feature">
                        {f.feature}: {f.contribution > 0 ? '+' : ''}{f.contribution}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <h3>Sniper Analysis</h3>
                  <div className="sniper-status">
                    {fullAnalysis.analysis?.sniper?.hasSetup ? 'SETUP DETECTED' : 'NO SETUP'}
                  </div>
                  {fullAnalysis.analysis?.sniper?.best && (
                    <div className="sniper-details">
                      <div>Type: {fullAnalysis.analysis.sniper.best.type}</div>
                      <div>Confidence: {fullAnalysis.analysis.sniper.best.confidence}%</div>
                      <div>Entry: ${fullAnalysis.analysis.sniper.best.entry}</div>
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3>Chart Patterns</h3>
                  <div className="patterns-count">
                    {fullAnalysis.analysis?.patterns?.detected || 0} patterns detected
                  </div>
                  {fullAnalysis.analysis?.patterns?.best && (
                    <div className="pattern-best">
                      <div className={`pattern-type ${fullAnalysis.analysis.patterns.direction}`}>
                        {fullAnalysis.analysis.patterns.best.type}
                      </div>
                      <div>Target: ${fullAnalysis.analysis.patterns.best.target}</div>
                      <div>Stop: ${fullAnalysis.analysis.patterns.best.stopLoss}</div>
                    </div>
                  )}
                </div>

                {/* Trade Levels */}
                {fullAnalysis.tradeLevels && (
                  <div className="card trade-levels full-width">
                    <h3>Trade Levels</h3>
                    <div className="levels-grid">
                      <div className="level">
                        <span className="label">Entry</span>
                        <span className="value">${fullAnalysis.tradeLevels.entry}</span>
                      </div>
                      <div className="level">
                        <span className="label">Stop Loss</span>
                        <span className="value red">${fullAnalysis.tradeLevels.stopLoss}</span>
                      </div>
                      <div className="level">
                        <span className="label">Take Profit</span>
                        <span className="value green">
                          ${fullAnalysis.tradeLevels.takeProfit?.join(' / $')}
                        </span>
                      </div>
                      <div className="level">
                        <span className="label">Risk</span>
                        <span className="value">{fullAnalysis.tradeLevels.riskPercent}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Chart Patterns Details */}
            {patterns?.patterns?.length > 0 && (
              <div className="patterns-section">
                <h3>Detected Patterns</h3>
                <div className="patterns-grid">
                  {patterns.patterns.map((p, i) => (
                    <div key={i} className={`pattern-card ${p.direction}`}>
                      <div className="pattern-name">{p.type}</div>
                      <div className="pattern-confidence">{p.confidence}% confidence</div>
                      {p.target && <div className="pattern-target">Target: ${p.target}</div>}
                      {p.stopLoss && <div className="pattern-sl">Stop: ${p.stopLoss}</div>}
                      {p.entry && <div className="pattern-entry">Entry: ${p.entry}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'learning' && (
          <div className="learning-section">
            {/* Indicator Effectiveness */}
            <div className="card full-width">
              <h3>Indicator Effectiveness</h3>
              <div className="indicator-grid">
                {insights?.indicatorEffectiveness?.map((ind, i) => (
                  <div key={i} className="indicator-item">
                    <span className="name">{ind.indicator.toUpperCase()}</span>
                    <div className="accuracy-bar">
                      <div className="fill" style={{ width: `${ind.accuracy}%` }}></div>
                    </div>
                    <span className="accuracy">{ind.accuracy}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Market Regimes */}
            <div className="card">
              <h3>Market Regime Performance</h3>
              <div className="regime-list">
                {insights?.marketRegimes?.map((reg, i) => (
                  <div key={i} className="regime-item">
                    <span className="regime-name">{reg.regime}</span>
                    <span className="win-rate">{reg.winRate}% win rate</span>
                    <span className="avg-return">{reg.avgReturn > 0 ? '+' : ''}{reg.avgReturn}% avg</span>
                    <span className="trades">{reg.trades} trades</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Performing Symbols */}
            <div className="card">
              <h3>Top Performing Symbols</h3>
              <div className="symbol-list">
                {insights?.topSymbols?.slice(0, 10).map((sym, i) => (
                  <div key={i} className="symbol-item" onClick={() => setSelectedSymbol(sym.symbol)}>
                    <span className="symbol-name">{sym.symbol}</span>
                    <span className={`win-rate ${sym.winRate >= 50 ? 'green' : 'red'}`}>
                      {sym.winRate}%
                    </span>
                    <span className="avg-return">{sym.avgReturn > 0 ? '+' : ''}{sym.avgReturn}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ML Feature Importance */}
            <div className="card">
              <h3>ML Feature Importance</h3>
              <div className="feature-list">
                {mlStats?.stats?.topWeights?.map((w, i) => (
                  <div key={i} className="feature-item">
                    <span className="feature-name">{w.feature}</span>
                    <span className={`weight ${w.weight > 0 ? 'bullish' : 'bearish'}`}>
                      {w.weight > 0 ? '+' : ''}{w.weight}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="risk-section">
            <div className="card full-width">
              <h3>Risk Management Dashboard</h3>
              <div className={`risk-banner ${riskStatus?.riskLevel?.toLowerCase()}`}>
                <span className="level">{riskStatus?.riskLevel}</span>
                <span className="status">{riskStatus?.tradingAllowed ? 'Trading Allowed' : riskStatus?.reason}</span>
              </div>
            </div>

            <div className="risk-grid">
              <div className="card">
                <h3>Current State</h3>
                <div className="state-list">
                  <div className="state-item">
                    <span className="label">Daily P&L</span>
                    <span className={`value ${riskStatus?.currentState?.dailyPnL >= 0 ? 'green' : 'red'}`}>
                      {riskStatus?.currentState?.dailyPnL?.toFixed(2)}%
                    </span>
                  </div>
                  <div className="state-item">
                    <span className="label">Weekly P&L</span>
                    <span className={`value ${riskStatus?.currentState?.weeklyPnL >= 0 ? 'green' : 'red'}`}>
                      {riskStatus?.currentState?.weeklyPnL?.toFixed(2)}%
                    </span>
                  </div>
                  <div className="state-item">
                    <span className="label">Monthly P&L</span>
                    <span className={`value ${riskStatus?.currentState?.monthlyPnL >= 0 ? 'green' : 'red'}`}>
                      {riskStatus?.currentState?.monthlyPnL?.toFixed(2)}%
                    </span>
                  </div>
                  <div className="state-item">
                    <span className="label">Current Drawdown</span>
                    <span className="value">{riskStatus?.currentState?.currentDrawdown?.toFixed(2)}%</span>
                  </div>
                  <div className="state-item">
                    <span className="label">Consecutive Losses</span>
                    <span className={`value ${riskStatus?.currentState?.consecutiveLosses > 2 ? 'red' : ''}`}>
                      {riskStatus?.currentState?.consecutiveLosses}
                    </span>
                  </div>
                  <div className="state-item">
                    <span className="label">Consecutive Wins</span>
                    <span className="value green">{riskStatus?.currentState?.consecutiveWins}</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Limits</h3>
                <div className="limits-list">
                  <div className="limit-item">
                    <span className="label">Daily Loss Limit</span>
                    <span className="value">{riskStatus?.limits?.dailyLossLimit}%</span>
                    <div className="progress-bar">
                      <div className="fill" style={{
                        width: `${Math.min(100, Math.abs(riskStatus?.currentState?.dailyPnL || 0) / riskStatus?.limits?.dailyLossLimit * 100)}%`,
                        backgroundColor: riskStatus?.currentState?.dailyPnL < 0 ? '#ff4444' : '#44ff44'
                      }}></div>
                    </div>
                  </div>
                  <div className="limit-item">
                    <span className="label">Max Drawdown</span>
                    <span className="value">{riskStatus?.limits?.maxDrawdown}%</span>
                    <div className="progress-bar">
                      <div className="fill red" style={{
                        width: `${Math.min(100, (riskStatus?.currentState?.currentDrawdown || 0) / riskStatus?.limits?.maxDrawdown * 100)}%`
                      }}></div>
                    </div>
                  </div>
                  <div className="limit-item">
                    <span className="label">Daily Trades</span>
                    <span className="value">{riskStatus?.currentState?.todayTrades} / {riskStatus?.limits?.maxDailyTrades}</span>
                    <div className="progress-bar">
                      <div className="fill" style={{
                        width: `${(riskStatus?.currentState?.todayTrades || 0) / riskStatus?.limits?.maxDailyTrades * 100}%`
                      }}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Historical Stats</h3>
                <div className="stats-list">
                  <div className="stat-item">
                    <span className="label">Win Rate</span>
                    <span className="value">{riskStatus?.stats?.winRate}%</span>
                  </div>
                  <div className="stat-item">
                    <span className="label">Avg Win</span>
                    <span className="value green">{riskStatus?.stats?.avgWin}%</span>
                  </div>
                  <div className="stat-item">
                    <span className="label">Avg Loss</span>
                    <span className="value red">{riskStatus?.stats?.avgLoss}%</span>
                  </div>
                  <div className="stat-item">
                    <span className="label">Kelly Optimal</span>
                    <span className="value">{riskStatus?.stats?.kellyOptimal}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomNav />

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .container {
    min-height: 100vh;
    background: var(--bg-dark, #0a0e17);
    color: var(--text-white, #ffffff);
    padding: 1rem;
    padding-bottom: 80px;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 50vh;
    font-size: 1.2rem;
    color: #888;
  }

  .header {
    margin-bottom: 1.5rem;
  }

  .header h1 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
  }

  .tabs button {
    padding: 0.5rem 1rem;
    background: #1a1f2e;
    border: none;
    border-radius: 8px;
    color: #888;
    cursor: pointer;
    white-space: nowrap;
  }

  .tabs button.active {
    background: #2962ff;
    color: white;
  }

  .main {
    max-width: 1200px;
    margin: 0 auto;
  }

  .card {
    background: #1a1f2e;
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .card h3 {
    font-size: 1rem;
    margin-bottom: 0.75rem;
    color: #888;
  }

  .full-width {
    grid-column: 1 / -1;
  }

  .overview-grid, .analysis-grid, .risk-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .risk-level {
    font-size: 1.5rem;
    font-weight: bold;
    text-align: center;
    padding: 0.5rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .risk-level.normal { background: #1b5e20; }
  .risk-level.elevated { background: #f57f17; }
  .risk-level.high { background: #e65100; }
  .risk-level.critical { background: #b71c1c; }
  .risk-level.stopped { background: #424242; }

  .stat, .state-item, .limit-item, .stat-item {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid #2a2f3e;
  }

  .stat:last-child, .state-item:last-child {
    border-bottom: none;
  }

  .label {
    color: #888;
  }

  .value {
    font-weight: 600;
  }

  .value.green { color: #4caf50; }
  .value.red { color: #f44336; }

  .signal-item, .regime-item, .symbol-item, .feature-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: 6px;
    margin-bottom: 0.5rem;
    background: #0a0e17;
  }

  .symbol-item {
    cursor: pointer;
  }

  .symbol-item:hover {
    background: #2a2f3e;
  }

  .signal-type, .signal {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .signal-type.long, .signal.long { background: #1b5e20; }
  .signal-type.short, .signal.short { background: #b71c1c; }

  .win-rate { flex: 1; text-align: right; }
  .trades { color: #888; font-size: 0.85rem; }

  .recommendation {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 8px;
    margin-bottom: 0.5rem;
    background: #0a0e17;
  }

  .recommendation .type {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .recommendation.high .type, .recommendation.warning .type { background: #f57f17; color: #000; }
  .recommendation.medium .type, .recommendation.caution .type { background: #1976d2; }
  .recommendation.info .type, .recommendation.ok .type { background: #388e3c; }
  .recommendation.alert .type { background: #d32f2f; }

  .symbol-selector {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .symbol-selector input {
    flex: 1;
    padding: 0.5rem;
    border-radius: 8px;
    border: 1px solid #2a2f3e;
    background: #0a0e17;
    color: white;
  }

  .symbol-selector button {
    padding: 0.5rem 1rem;
    background: #2962ff;
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
  }

  .consensus-direction {
    font-size: 2rem;
    font-weight: bold;
    text-align: center;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .consensus-direction.long { background: #1b5e20; }
  .consensus-direction.short { background: #b71c1c; }
  .consensus-direction.hold { background: #424242; }

  .confidence {
    font-size: 1.5rem;
    font-weight: bold;
    text-align: center;
    color: #2962ff;
  }

  .reasons, .features {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: #888;
  }

  .reasons li {
    margin: 0.25rem 0;
  }

  .feature {
    padding: 0.25rem 0;
  }

  .levels-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .level {
    text-align: center;
  }

  .level .label {
    display: block;
    margin-bottom: 0.25rem;
  }

  .level .value {
    font-size: 1.1rem;
  }

  .patterns-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .pattern-card {
    background: #0a0e17;
    padding: 1rem;
    border-radius: 8px;
    border-left: 4px solid #888;
  }

  .pattern-card.bullish { border-left-color: #4caf50; }
  .pattern-card.bearish { border-left-color: #f44336; }

  .pattern-name {
    font-weight: bold;
    margin-bottom: 0.5rem;
  }

  .pattern-confidence {
    color: #2962ff;
    margin-bottom: 0.5rem;
  }

  .indicator-grid {
    display: grid;
    gap: 0.75rem;
  }

  .indicator-item {
    display: grid;
    grid-template-columns: 100px 1fr 50px;
    align-items: center;
    gap: 0.5rem;
  }

  .accuracy-bar, .progress-bar {
    height: 8px;
    background: #2a2f3e;
    border-radius: 4px;
    overflow: hidden;
  }

  .accuracy-bar .fill, .progress-bar .fill {
    height: 100%;
    background: #2962ff;
    border-radius: 4px;
  }

  .progress-bar .fill.red {
    background: #f44336;
  }

  .risk-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-radius: 8px;
    font-size: 1.1rem;
  }

  .risk-banner.normal { background: #1b5e20; }
  .risk-banner.elevated { background: #f57f17; color: #000; }
  .risk-banner.high { background: #e65100; }
  .risk-banner.critical { background: #b71c1c; }
  .risk-banner.stopped { background: #424242; }

  .weight.bullish { color: #4caf50; }
  .weight.bearish { color: #f44336; }

  @media (max-width: 600px) {
    .levels-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .overview-grid, .analysis-grid, .risk-grid {
      grid-template-columns: 1fr;
    }
  }
`;

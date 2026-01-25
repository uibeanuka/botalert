export default function AIAdvisor({ signals }) {
  const topSignals = signals.slice(0, 5);

  return (
    <div className="card ai-card">
      <div className="card-header">
        <div className="ai-header">
          <div className="ai-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 16a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1-5.5a1 1 0 0 1-2 0v-4a1 1 0 1 1 2 0z"/>
            </svg>
          </div>
          <span className="card-title">Top AI Signals</span>
        </div>
        <span style={{ fontSize: '0.6875rem', color: 'var(--accent-green)' }}>
          High Confidence
        </span>
      </div>

      {topSignals.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Analyzing market data...</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {topSignals.map((s, index) => (
            <div key={`${s.symbol}-${s.interval}-${index}`} className="ai-signal">
              <div className="ai-signal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="ai-signal-symbol">{s.symbol.replace('USDT', '')}</span>
                  <span className="signal-interval">{s.interval}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: s.ai?.confidence >= 0.7 ? 'var(--accent-green)' : 'var(--accent-yellow)'
                  }}>
                    {Math.round((s.ai?.confidence || 0) * 100)}%
                  </span>
                  <span className={`tag ${getTagClass(s.signal)}`}>
                    {getSignalIcon(s.signal)} {s.signal}
                  </span>
                </div>
              </div>

              {s.ai?.trade && (
                <div className="ai-trade-mini">
                  <div className="ai-trade-row">
                    <span className="ai-trade-label">Entry</span>
                    <span className="ai-trade-value">${formatPrice(s.ai.trade.entry)}</span>
                  </div>
                  <div className="ai-trade-row">
                    <span className="ai-trade-label stop">SL</span>
                    <span className="ai-trade-value stop">${formatPrice(s.ai.trade.stopLoss)}</span>
                  </div>
                  <div className="ai-trade-row">
                    <span className="ai-trade-label tp">TP1</span>
                    <span className="ai-trade-value tp">${formatPrice(s.ai.trade.takeProfit?.[0])}</span>
                  </div>
                </div>
              )}

              {s.ai?.reasons?.length > 0 && (
                <div className="ai-reasons">
                  {s.ai.reasons.slice(0, 2).map((reason, i) => (
                    <span key={i} className="ai-reason">{reason}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getSignalIcon(signal) {
  if (signal?.includes('LONG') || signal?.includes('UP')) return '↑';
  if (signal?.includes('SHORT') || signal?.includes('DOWN')) return '↓';
  return '→';
}

function getTagClass(signal) {
  if (signal?.includes('LONG') || signal?.includes('UP')) return 'tag-long';
  if (signal?.includes('SHORT') || signal?.includes('DOWN')) return 'tag-short';
  return 'tag-neutral';
}

function formatPrice(value) {
  if (value === undefined || value === null) return '—';
  if (value >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

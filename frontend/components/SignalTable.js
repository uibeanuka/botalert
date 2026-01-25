export default function SignalTable({ signals, selectedSymbol, onSelectSymbol }) {
  const sortedSignals = [...signals].sort((a, b) => {
    const confA = a.ai?.confidence || 0;
    const confB = b.ai?.confidence || 0;
    return confB - confA;
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Signal Feed</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {signals.length} active
        </span>
      </div>

      {signals.length === 0 ? (
        <div className="empty-state">
          <div className="spinner"></div>
          <p style={{ marginTop: '12px' }}>Waiting for signals...</p>
        </div>
      ) : (
        <div className="signal-list">
          {sortedSignals.slice(0, 50).map((s) => (
            <div
              key={`${s.symbol}-${s.interval}-${s.timestamp}`}
              className={`signal-card ${s.symbol === selectedSymbol ? 'active' : ''}`}
              onClick={() => onSelectSymbol?.(s.symbol)}
            >
              <div className="signal-info">
                <div>
                  <div className="signal-symbol">{s.symbol.replace('USDT', '')}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <span className="signal-interval">{s.interval}</span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                      RSI {formatNumber(s.indicators?.rsi)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="signal-meta">
                <div>
                  <ConfidenceBar confidence={s.ai?.confidence || 0} />
                  <div className="confidence-value" style={{ marginTop: '4px' }}>
                    {Math.round((s.ai?.confidence || 0) * 100)}%
                  </div>
                </div>
                <span className={`tag ${tagClass(s.signal)}`}>
                  {getSignalIcon(s.signal)} {s.signal}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ confidence }) {
  const percent = Math.min(100, Math.max(0, confidence * 100));
  const level = confidence >= 0.7 ? 'high' : confidence >= 0.55 ? 'medium' : 'low';

  return (
    <div className="confidence-bar">
      <div
        className={`confidence-fill ${level}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function getSignalIcon(signal) {
  if (signal?.includes('LONG') || signal?.includes('UP')) return '↑';
  if (signal?.includes('SHORT') || signal?.includes('DOWN')) return '↓';
  return '→';
}

function tagClass(signal) {
  if (signal?.includes('LONG') || signal?.includes('UP')) return 'tag-long';
  if (signal?.includes('SHORT') || signal?.includes('DOWN')) return 'tag-short';
  return 'tag-neutral';
}

function formatNumber(value) {
  if (value === undefined || value === null) return '–';
  return Number(value).toFixed(1);
}

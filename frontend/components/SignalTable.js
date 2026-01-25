export default function SignalTable({ signals }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Live Signals</h3>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {signals.length === 0 && <p style={{ color: '#9aa3b5' }}>Waiting for signals...</p>}
        {signals.map((s) => (
          <div
            key={`${s.symbol}-${s.interval}-${s.timestamp}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid #1f2a44'
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{s.symbol}</div>
              <div style={{ fontSize: 12, color: '#8b94a5' }}>
                {s.interval} · RSI {formatNumber(s.indicators?.rsi)} · MACD {formatNumber(s.indicators?.macd?.histogram)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={`tag ${tagClass(s.signal)}`}>{s.signal}</span>
              <div style={{ fontSize: 12, color: '#8b94a5' }}>
                AI {Math.round((s.ai?.confidence || 0) * 100)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tagClass(signal) {
  if (signal?.includes('LONG') || signal?.includes('UP')) return 'tag-long';
  if (signal?.includes('SHORT') || signal?.includes('DOWN')) return 'tag-short';
  return 'tag-neutral';
}

function formatNumber(value) {
  if (value === undefined || value === null) return '–';
  return Number(value).toFixed(2);
}

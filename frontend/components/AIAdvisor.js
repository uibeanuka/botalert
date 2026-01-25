export default function AIAdvisor({ signals }) {
  const top = [...signals]
    .filter((s) => s.signal && s.ai?.confidence)
    .sort((a, b) => b.ai.confidence - a.ai.confidence)
    .slice(0, 3);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>AI Suggestions</h3>
      {top.length === 0 && <p style={{ color: '#9aa3b5' }}>No strong suggestions yet.</p>}
      {top.map((s) => (
        <div key={`${s.symbol}-${s.timestamp}`} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700 }}>{s.symbol}</div>
            <span className={`tag ${s.signal.includes('LONG') ? 'tag-long' : 'tag-short'}`}>{s.signal}</span>
          </div>
          <div style={{ fontSize: 12, color: '#8b94a5' }}>
            Confidence {Math.round((s.ai?.confidence || 0) * 100)}% · Reasons: {(s.ai?.reasons || []).join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
}

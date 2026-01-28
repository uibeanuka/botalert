import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import BottomNav from '../components/BottomNav';
import ChatWidget from '../components/ChatWidget';
import { fetchDcaPlan } from '../lib/api';

const TARGET_SYMBOLS = [
  { symbol: 'ASTERUSDC', category: 'spot' },
  { symbol: 'GIGGLEUSDC', category: 'spot' },
  { symbol: 'ORDIUSDC', category: 'spot' },
  { symbol: 'FARTCOINUSDC', category: 'alpha' },
  { symbol: 'TRADOORUSDC', category: 'alpha' },
  { symbol: '1000BONKUSDC', category: 'alpha' }
];

const INTERVAL_OPTIONS = ['1h', '4h', '1d'];

export default function DcaPage() {
  const [plan, setPlan] = useState(null);
  const [budget, setBudget] = useState(100);
  const [interval, setDcaInterval] = useState('1h');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPlan = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await fetchDcaPlan({
        interval,
        budget
      });
      setPlan(data);
    } catch (err) {
      setError('Failed to load DCA plan.');
    } finally {
      setIsLoading(false);
    }
  }, [interval, budget]);

  useEffect(() => {
    loadPlan();
    const timer = setInterval(loadPlan, 60_000);
    return () => clearInterval(timer);
  }, [loadPlan]);

  const updatedAt = useMemo(() => {
    if (!plan?.updatedAt) return '—';
    return new Date(plan.updatedAt).toLocaleTimeString();
  }, [plan]);

  const dailyBudget = useMemo(() => {
    const weekly = Number(budget);
    if (!Number.isFinite(weekly)) return 0;
    return weekly / 7;
  }, [budget]);

  return (
    <div className="page with-bottom-nav">
      <Head>
        <title>FuturesAI - Spot &amp; Alpha DCA Planner</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="description" content="Spot &amp; Alpha DCA planner with market flow signals." />
        <meta name="theme-color" content="#0a0e17" />
      </Head>

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
              Spot &amp; Alpha DCA
            </div>
          </div>
          <div className="header-right">
            <div className="select-group">
              <span className="select-label">TF</span>
              <select className="select" value={interval} onChange={(e) => setDcaInterval(e.target.value)}>
                {INTERVAL_OPTIONS.map((tf) => (
                  <option key={tf} value={tf}>{tf.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard dca-dashboard">
        <div className="main-content">
          <div className="card dca-controls">
            <div className="card-header">
              <span className="card-title">DCA Budget</span>
              <span className={`tag ${isLoading ? 'tag-neutral' : 'tag-long'}`}>
                {isLoading ? 'Updating' : 'Live Plan'}
              </span>
            </div>
            <div className="dca-controls-grid">
              <div className="dca-control">
                <span className="dca-control-label">Weekly USDC budget</span>
                <input
                  className="input"
                  type="number"
                  min="10"
                  step="1"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value || 0))}
                />
                <span className="dca-control-meta">Daily: ${formatMoney(dailyBudget)}</span>
              </div>
              <div className="dca-control">
                <span className="dca-control-label">Last update</span>
                <div className="dca-control-value">{updatedAt}</div>
                <span className="dca-control-meta">Interval: {interval.toUpperCase()}</span>
              </div>
              <div className="dca-control">
                <span className="dca-control-label">Strategy</span>
                <div className="dca-control-value">Trend + candle flow</div>
                <span className="dca-control-meta">Spot + Alpha • USDC reserve active</span>
              </div>
            </div>
            {error && <div className="dca-error">{error}</div>}
          </div>

          {plan?.items?.some((item) => item.category === 'spot') && (
            <>
              <div className="dca-section-header">
                <span className="dca-section-title">Spot Holdings</span>
                <span className="tag tag-neutral">SPOT</span>
              </div>
              <div className="dca-grid">
                {plan.items.filter((item) => item.category === 'spot').map((item) => (
                  <DcaCoinCard key={item.symbol} item={item} />
                ))}
              </div>
            </>
          )}

          {plan?.items?.some((item) => item.category === 'alpha') && (
            <>
              <div className="dca-section-header">
                <span className="dca-section-title">Alpha Holdings</span>
                <span className="tag tag-short">ALPHA</span>
              </div>
              <div className="dca-grid">
                {plan.items.filter((item) => item.category === 'alpha').map((item) => (
                  <DcaCoinCard key={item.symbol} item={item} />
                ))}
              </div>
            </>
          )}

          {!plan && !isLoading && (
            <div className="card dca-card">
              <div className="dca-empty">No plan yet. Adjust budget or refresh.</div>
            </div>
          )}
        </div>

        <div className="sidebar">
          <div className="card">
            <div className="card-header">
              <span className="card-title">USDC Reserve</span>
              <span className="tag tag-neutral">Hold</span>
            </div>
            <div className="dca-reserve">
              <div className="dca-reserve-item">
                <span>Allocation</span>
                <span>{plan?.reserve?.allocationPct ?? 0}%</span>
              </div>
              <div className="dca-reserve-item">
                <span>Weekly</span>
                <span>${formatMoney(plan?.reserve?.weeklyAmount)}</span>
              </div>
              <div className="dca-reserve-item">
                <span>Daily</span>
                <span>${formatMoney(plan?.reserve?.dailyAmount)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Automation</span>
              {plan?.spotDca?.enabled && (
                <span className={`tag ${plan.spotDca.dryRun ? 'tag-neutral' : 'tag-long'}`}>
                  {plan.spotDca.dryRun ? 'Dry Run' : 'Live'}
                </span>
              )}
            </div>
            <div className="dca-note">
              {plan?.spotDca?.enabled ? (
                plan.spotDca.dryRun ? (
                  <>Spot DCA engine active (dry-run mode). Orders are logged but not executed.</>
                ) : (
                  <>Spot DCA engine active. Auto-buys on ACCUMULATE, auto-sells on SWAP_TO_USDC.</>
                )
              ) : (
                <>Spot DCA engine disabled. Set SPOT_DCA_ENABLED=true to activate auto-execution.</>
              )}
            </div>
            {plan?.spotDca?.enabled && (
              <div className="dca-reserve">
                <div className="dca-reserve-item">
                  <span>Sniper Entry</span>
                  <span>{plan.spotDca.sniperEnabled ? 'ON' : 'OFF'}</span>
                </div>
                <div className="dca-reserve-item">
                  <span>Smart Exit</span>
                  <span>{plan.spotDca.smartExitEnabled ? 'ON' : 'OFF'}</span>
                </div>
                <div className="dca-reserve-item">
                  <span>Min Trade</span>
                  <span>${plan.spotDca.minTrade} USDC</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ChatWidget />
      <BottomNav />
    </div>
  );
}

function DcaCoinCard({ item }) {
  const actionLabel = getActionLabel(item.action);
  const tagClass = getActionTag(item.action);
  const price = formatPrice(item.price);

  return (
    <div className="card dca-card">
      <div className="dca-card-header">
        <div className="dca-coin">
          <span className="dca-symbol">{item.base}</span>
          <span className="dca-pair">/USDC</span>
        </div>
        <span className={`tag ${tagClass}`}>{actionLabel}</span>
      </div>

      <div className="dca-price-row">
        <span className="dca-price">${price}</span>
        <span className={`dca-trend ${getTrendClass(item.trend)}`}>{item.trend || '—'}</span>
      </div>

      <div className="dca-metrics">
        <div>
          <span>Weekly</span>
          <strong>${formatMoney(item.weeklyAmount)}</strong>
        </div>
        <div>
          <span>Daily</span>
          <strong>${formatMoney(item.dailyAmount)}</strong>
        </div>
        <div>
          <span>Alloc</span>
          <strong>{item.allocationPct ?? 0}%</strong>
        </div>
        <div>
          <span>Cadence</span>
          <strong>{item.cadence?.toUpperCase() || '—'}</strong>
        </div>
      </div>

      {item.reasons?.length > 0 && (
        <div className="dca-reasons">
          {item.reasons.map((reason, index) => (
            <span key={index}>{reason}</span>
          ))}
        </div>
      )}

      {item.reentrySuggested && (
        <div className="dca-reentry">Re-entry signal: trend flip after pullback</div>
      )}
    </div>
  );
}

function getActionLabel(action) {
  if (action === 'ACCUMULATE') return 'BUY / DCA';
  if (action === 'SWAP_TO_USDC') return 'SWAP TO USDC';
  if (action === 'WAIT') return 'WAIT';
  return 'NO DATA';
}

function getActionTag(action) {
  if (action === 'ACCUMULATE') return 'tag-long';
  if (action === 'SWAP_TO_USDC') return 'tag-short';
  return 'tag-neutral';
}

function getTrendClass(trend) {
  if (!trend) return '';
  if (trend.includes('UP')) return 'positive';
  if (trend.includes('DOWN')) return 'negative';
  return '';
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1) {
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 0.01) {
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

import axios from 'axios';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export async function fetchSignals() {
  const res = await axios.get(`${backendUrl}/api/signals`);
  return res.data.signals || [];
}

export async function fetchCandles(symbol, interval) {
  const res = await axios.get(`${backendUrl}/api/candles/${symbol}`, {
    params: { interval }
  });
  return res.data.candles || [];
}

export async function fetchMeta() {
  const res = await axios.get(`${backendUrl}/api/meta`);
  return res.data;
}

export async function subscribeToAlerts(subscription) {
  return axios.post(`${backendUrl}/api/subscribe`, subscription);
}

export async function fetchDcaPlan({ symbols, interval, budget }) {
  const res = await axios.get(`${backendUrl}/api/dca-plan`, {
    params: {
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      interval,
      budget
    }
  });
  return res.data;
}

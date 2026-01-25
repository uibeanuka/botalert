# DECODE — Binance Futures AI Alert (Next.js + Node.js)

Full-stack template for real-time Binance futures alerts with RSI/MACD/KDJ/Bollinger, breakout & pattern detection, AI-style scoring, WebSocket streaming, and web push notifications (iPhone/Safari compatible).

## Contents
- `backend/`: Express + Socket.io server, Binance fetcher, indicators, AI scoring, push subscriptions.
- `frontend/`: Next.js dashboard with candlestick chart, live signal feed, AI suggestions, and push registration.

## Quickstart
1) Backend
```
cd backend
cp .env.example .env          # Fill VAPID keys if you want push
npm install
npm start
```
- Generate VAPID keys (once) with `npx web-push generate-vapid-keys` and place them in `.env`.
- Tweak `SYMBOLS`, `BINANCE_INTERVAL`, `POLL_MS` as needed.

2) Frontend
```
cd frontend
cp .env.local.example .env.local   # Set NEXT_PUBLIC_BACKEND_URL to your backend (e.g., http://192.168.1.X:5000)
npm install
npm run dev
```
- Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to match backend `.env`.
- Open `http://localhost:3000` (or your LAN IP) on desktop/iPhone. Add to Home Screen for PWA feel.

## What’s included
- Futures data from Binance (PERPETUAL symbols configured via env).
- Indicators: RSI, MACD, KDJ (J line), Bollinger Bands, volume spike, breakout detection, simple candlestick patterns.
- AI scoring (heuristic) to propose LONG/SHORT/BREAKOUT + confidence and reasons.
- WebSocket streaming of signals; REST endpoints for candles and latest signals.
- Web push subscription endpoint + service worker for notifications.
- Next.js UI: candlestick chart, live signal list, AI suggestions, indicator snapshot, dark theme.

## Repo & deployment checklist
1. Initialize repo locally: `git init && git add . && git commit -m "feat: initial DECODE stack"`.
2. Create remote (GitHub/GitLab/Bitbucket) and push: `git remote add origin <your-repo-url> && git push -u origin main`.
3. Frontend deploy (web/PWA): Vercel/Netlify/Fly — set `NEXT_PUBLIC_BACKEND_URL` to your backend HTTPS URL and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
4. Backend deploy: Render/Fly/Heroku/Dokku — set envs from `.env.example` (include VAPID keys).
5. iPhone PWA: open the deployed frontend URL in Safari, tap Share → Add to Home Screen; push works on iOS 16.4+ with VAPID keys set.
6. TestFlight (optional wrapper): wrap the frontend in a lightweight WebView (e.g., Capacitor or Expo WebView) pointing to the deployed URL, then archive in Xcode and distribute via TestFlight. Keep associated domains if you later add native push.

### Railway deploy (monorepo)
- Two Dockerfiles included (`backend/Dockerfile`, `frontend/Dockerfile`).
- Create two Railway services from this repo:
  - Backend: root path `backend`, Dockerfile `backend/Dockerfile`, set `PORT=5000`, `BINANCE_INTERVAL`, `POLL_INTERVALS`, `BINANCE_LIMIT`, `PUSH_CONTACT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optional `SYMBOLS`.
  - Frontend: root path `frontend`, Dockerfile `frontend/Dockerfile`, set `NEXT_PUBLIC_BACKEND_URL` to the Railway backend public URL and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to match the backend VAPID public key.
- Expose ports: backend 5000, frontend 3000 (Railway assigns externals automatically).
- After deploy, open the frontend URL on iPhone and enable notifications.

## Endpoints (backend)
- `GET /api/signals` – latest signals per symbol.
- `GET /api/candles/:symbol?interval=1m` – latest fetched candles for interval.
- `GET /api/markets` – list of tradable USDT perpetual markets (filtered from exchangeInfo).
- `POST /api/subscribe` – web push subscription (send the PushManager subscription JSON).
- `GET /api/meta` – returns current symbols + intervals being tracked.
- `GET/POST /api/tracking` – read/update tracked symbols/intervals (JSON body `{ symbols: [], intervals: [] }`).
- `GET /health` – health check.

## Notes
- Subscriptions are kept in memory for simplicity; wire to a database for persistence.
- If `SYMBOLS` is empty, the backend auto-discovers all perpetual futures symbols from Binance and tracks them on the intervals from `POLL_INTERVALS`.
- If Binance is blocked in your region, set `BINANCE_API_FALLBACK` to a proxy (e.g., Cloudflare Worker forwarding to `https://fapi.binance.com`) and keep a modest `MAX_SYMBOLS` (10–25) and limited `POLL_INTERVALS` to reduce errors.
- AI scoring is heuristic; replace `backend/src/ai.js` with your trained model/API for better predictions.
- Icons are placeholders (1x1 PNG) under `frontend/public/`; replace with real branding for production.

## iPhone push
1. Generate VAPID keys and set them in both backend `.env` and frontend `.env.local`.
2. Serve the frontend over your LAN (or HTTPS in production).
3. Allow notifications when prompted; alerts fire when confidence ≥ 70% by default.

## Scripts
- Backend: `npm start`
- Frontend: `npm run dev` | `npm run build` | `npm start`

Happy trading and stay safe with risk management!

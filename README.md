# DeFi Radar Mini (Telegram Mini App) — deployable on Railway

This is a minimal **Telegram Mini App (WebApp)** + **Bot** MVP:
- Read-only portfolio by public address (EVM: ETH, BTC, Solana: SOL)
- Earn opportunities (static catalog)
- Alerts (price / APY) stored in SQLite (demo)
- Telegram bot notifications via webhook

> ⚠️ Note on persistence: SQLite on Railway filesystem can reset on redeploy/restart.
> For a serious setup, swap DB layer to Railway Postgres. For MVP/demo it’s OK.

---

## 1) Local run

1. Install dependencies:
```bash
npm i
```

2. Create `.env` from `.env.example` and fill:
- `BOT_TOKEN`
- `JWT_SECRET`
- `APP_URL` (for local: https via tunnel, or just http://localhost:3000 for dev)

3. Start:
```bash
npm run dev
```

Open: `http://localhost:3000`

If you open in a normal browser (not inside Telegram), the app uses **dev auth**:
- set `ALLOW_DEV_AUTH=true` in `.env`

---

## 2) Telegram bot setup (required for real Telegram auth + notifications)

1. Create bot via @BotFather and get `BOT_TOKEN`.

2. In @BotFather:
- Set your bot **domain** (Mini App requires HTTPS).
- Add a **Menu Button** (or Inline keyboard) with your Mini App URL:
  - `https://<your-app-domain>/`

3. Deploy to Railway (next section), then set webhook:

```bash
curl -s "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -d "url=$APP_URL/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN"
```

4. Open your bot chat and send `/start`.
This allows the backend to map your `user_id -> chat_id` and send alerts/digests.

---

## 3) Deploy to Railway

**Option A (recommended): GitHub**
1. Push this repo to GitHub.
2. Railway → New Project → Deploy from GitHub repo.
3. Add environment variables:
- `BOT_TOKEN`
- `JWT_SECRET`
- `APP_URL` (Railway public URL)
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` (any random string)
- `ALLOW_DEV_AUTH=false` (recommended for prod)

Railway will run `npm start` automatically.

**Option B: railway CLI**
```bash
railway up
```

---

## 4) How “Open in wallet” works in MVP

We don’t execute transactions inside the Mini App.
Instead we open a recommended DeFi URL inside wallet in-app browsers:

- MetaMask: `https://link.metamask.io/dapp/{dappUrl}`
- Phantom: `https://phantom.app/ul/browse/<url>?ref=<ref>`
- Telegram Wallet: opens `https://t.me/wallet` (fallback) and provides Copy details

---


## TON portfolio support

This build supports TON native balance via TON Center API v2 `getAddressBalance`.
Requests without API key are limited to ~1 request per second; for higher limits set `TONCENTER_API_KEY`.

## 5) API quick reference

- `POST /api/auth/telegram` { initData }
- `GET /api/portfolio?chain=evm|btc|sol&address=...`
- `GET /api/opportunities?chain=evm|sol|ton`
- `GET /api/alerts`, `POST /api/alerts`, `PATCH /api/alerts/:id`, `DELETE /api/alerts/:id`
- `POST /api/telegram/webhook` — Telegram webhook

Health: `GET /health`

---

## 6) Troubleshooting

- **initData invalid**: make sure you open inside Telegram + correct `BOT_TOKEN`.
- **no notifications**: send `/start` to bot after webhook is set.
- **deeplinks don’t open**: use fallback “Copy details” (mobile OS limitations vary).


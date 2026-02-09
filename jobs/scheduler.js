const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const { getEnabledAlerts, markAlertTriggered } = require("../lib/db");
const { getPricesUsd } = require("../lib/portfolio");
const { sendAlertMessage } = require("../lib/telegramBot");

function loadOpportunities() {
  const p = path.join(process.cwd(), "data", "opportunities.json");
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
}

function shouldTrigger({ condition, current, threshold }) {
  if (current == null) return false;
  if (condition === "above") return current > threshold;
  if (condition === "below") return current < threshold;
  return false;
}

function cooldownPassed(lastTriggeredAt, cooldownMinutes) {
  if (!lastTriggeredAt) return true;
  const diffMs = Date.now() - Number(lastTriggeredAt);
  return diffMs >= (cooldownMinutes * 60 * 1000);
}

async function checkAlertsOnce() {
  const alerts = getEnabledAlerts();
  if (!alerts.length) return;

  const prices = await getPricesUsd();
  const opp = loadOpportunities();
  const oppByAssetChain = new Map();
  for (const it of (opp.items || [])) {
    oppByAssetChain.set(`${it.asset}:${it.chain}`, it);
  }

  const appUrl = process.env.APP_URL;

  for (const a of alerts) {
    if (!a.chat_id) continue; // user did not /start the bot yet
    if (!cooldownPassed(a.last_triggered_at, a.cooldown_minutes)) continue;

    let current = null;
    if (a.type === "price") {
      if (a.asset === "ETH") current = prices.ETH;
      if (a.asset === "BTC") current = prices.BTC;
      if (a.asset === "SOL") current = prices.SOL;
        if (a.asset === "TON") current = prices.TON;
    } else if (a.type === "apy") {
      const o = oppByAssetChain.get(`${a.asset}:${a.chain}`);
      current = o ? Number(o.apy) : null;
    }

    const threshold = Number(a.threshold);
    if (!Number.isFinite(threshold)) continue;

    if (shouldTrigger({ condition: a.condition, current, threshold })) {
      const text = a.type === "price"
        ? `🔔 Price alert: ${a.asset} is ${a.condition} ${threshold} (now ~${current})`
        : `🔔 APY alert: ${a.asset} (${a.chain}) APY is ${a.condition} ${threshold}% (now ~${current}%)`;

      try {
        await sendAlertMessage({ chatId: a.chat_id, text, appUrl });
        markAlertTriggered({ alertId: a.id });
      } catch (e) {
        // swallow to keep scheduler alive
        console.error("Failed to send alert:", e.message);
      }
    }
  }
}

function startSchedulers() {
  if (process.env.ENABLE_JOBS === "false") return;
  // Every 2 minutes
  cron.schedule("*/2 * * * *", () => {
    checkAlertsOnce().catch((e) => console.error("checkAlertsOnce error:", e.message));
  });
}

module.exports = { startSchedulers };

\
const path = require("path");
require("dotenv").config();

const express = require("express");
const { z } = require("zod");
const fs = require("fs");

const { validateInitData } = require("./lib/telegram");
const { signSessionToken, authMiddleware } = require("./lib/jwt");
const {
  initDb,
  upsertUser,
  setChatId,
  getUser,
  saveActiveWallet,
  getActiveWallet,
  listAlerts,
  createAlert,
  updateAlertEnabled,
  deleteAlert
} = require("./lib/db");
const { portfolioQuerySchema, buildPortfolio } = require("./lib/portfolio");
const { startSchedulers } = require("./jobs/scheduler");

initDb();

const app = express();
app.use(express.json({ limit: "1mb" }));

// Serve static mini app
app.use(express.static(path.join(__dirname, "public")));

// Healthcheck
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Auth: Telegram WebApp initData -> JWT
 */
app.post("/api/auth/telegram", (req, res) => {
  try {
    const bodySchema = z.object({ initData: z.string().min(10) });
    const { initData } = bodySchema.parse(req.body);

    const maxAge = Number(process.env.MAX_AUTH_AGE_SECONDS || 86400);
    const { user } = validateInitData(initData, process.env.BOT_TOKEN, maxAge);
    if (!user?.id) {
      return res.status(400).json({ error: "Missing Telegram user info" });
    }

    const locale = user?.language_code || "en";
    upsertUser({ tgUserId: user.id, locale });

    const token = signSessionToken({ tgUserId: user.id, locale });
    return res.json({ token, user: { id: user.id, locale } });
  } catch (e) {
    return res.status(401).json({ error: e.message || "Auth failed" });
  }
});

/**
 * Dev auth for testing outside Telegram (disable in prod)
 */
app.post("/api/auth/dev", (req, res) => {
  try {
    if (process.env.ALLOW_DEV_AUTH !== "true") {
      return res.status(403).json({ error: "Dev auth disabled" });
    }
    const bodySchema = z.object({
      userId: z.string().min(1).default("dev_user"),
      locale: z.string().default("en")
    });
    const { userId, locale } = bodySchema.parse(req.body || {});
    upsertUser({ tgUserId: userId, locale });
    const token = signSessionToken({ tgUserId: userId, locale });
    return res.json({ token, user: { id: userId, locale } });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// Me
app.get("/api/me", authMiddleware, (req, res) => {
  const user = getUser({ tgUserId: req.user.tgUserId });
  res.json({ user: { id: req.user.tgUserId, locale: req.user.locale, chatId: user?.chat_id || null } });
});

// Save active wallet (optional helper for the UI)
app.post("/api/wallet/active", authMiddleware, (req, res) => {
  try {
    const schema = z.object({
      chain: z.enum(["evm", "btc", "sol"]),
      address: z.string().min(4)
    });
    const { chain, address } = schema.parse(req.body);
    saveActiveWallet({ tgUserId: req.user.tgUserId, chain, address });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/wallet/active", authMiddleware, (req, res) => {
  const w = getActiveWallet({ tgUserId: req.user.tgUserId });
  res.json({ wallet: w ? { chain: w.chain, address: w.address } : null });
});

// Opportunities (static catalog)
app.get("/api/opportunities", authMiddleware, (req, res) => {
  const chain = String(req.query.chain || "");
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "opportunities.json"), "utf-8");
  const data = JSON.parse(raw);
  const items = Array.isArray(data.items) ? data.items : [];
  const filtered = chain ? items.filter((x) => x.chain === chain) : items;
  res.json({ items: filtered, updatedAt: data.updatedAt });
});

app.get("/api/opportunities/:id", authMiddleware, (req, res) => {
  const id = req.params.id;
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "opportunities.json"), "utf-8");
  const data = JSON.parse(raw);
  const items = Array.isArray(data.items) ? data.items : [];
  const found = items.find((x) => x.id === id);
  if (!found) return res.status(404).json({ error: "Not found" });
  res.json(found);
});

// Portfolio
app.get("/api/portfolio", authMiddleware, async (req, res) => {
  try {
    const parsed = portfolioQuerySchema.parse({
      chain: req.query.chain,
      address: req.query.address
    });
    const portfolio = await buildPortfolio(parsed);
    res.json(portfolio);
  } catch (e) {
    res.status(400).json({ error: e.message || "Bad request" });
  }
});

// Alerts CRUD
app.get("/api/alerts", authMiddleware, (req, res) => {
  const items = listAlerts({ tgUserId: req.user.tgUserId }).map((a) => ({
    id: a.id,
    type: a.type,
    chain: a.chain,
    asset: a.asset,
    condition: a.condition,
    threshold: a.threshold,
    frequency: a.frequency,
    enabled: !!a.enabled,
    lastTriggeredAt: a.last_triggered_at || null
  }));
  res.json({ items });
});

app.post("/api/alerts", authMiddleware, (req, res) => {
  try {
    const schema = z.object({
      type: z.enum(["price", "apy"]),
      chain: z.enum(["evm", "btc", "sol", "ton"]).default("evm"),
      asset: z.string().min(1),
      condition: z.enum(["above", "below"]),
      threshold: z.number(),
      frequency: z.enum(["instant", "daily", "weekly"]).default("instant")
    });
    const body = schema.parse(req.body);

    const id = createAlert({ tgUserId: req.user.tgUserId, ...body });
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/alerts/:id", authMiddleware, (req, res) => {
  try {
    const schema = z.object({ enabled: z.boolean() });
    const { enabled } = schema.parse(req.body);
    updateAlertEnabled({ tgUserId: req.user.tgUserId, alertId: req.params.id, enabled });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/alerts/:id", authMiddleware, (req, res) => {
  deleteAlert({ tgUserId: req.user.tgUserId, alertId: req.params.id });
  res.json({ ok: true });
});

/**
 * Telegram Bot webhook (store chat_id mapping when user sends /start)
 * Security: validate secret token header if TELEGRAM_WEBHOOK_SECRET_TOKEN is set
 */
app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
    if (expected) {
      const got = req.header("x-telegram-bot-api-secret-token");
      if (got !== expected) return res.status(401).json({ ok: false });
    }

    const update = req.body || {};
    const msg = update.message;
    if (msg && msg.from && msg.chat) {
      const tgUserId = String(msg.from.id);
      const chatId = String(msg.chat.id);
      // Create user row if absent
      upsertUser({ tgUserId, locale: msg.from.language_code || "en" });
      if (msg.text && msg.text.startsWith("/start")) {
        setChatId({ tgUserId, chatId });
      }
    }
    // Always respond quickly
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: true });
  }
});

// Single-page app fallback (optional)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`DeFi Radar Mini listening on :${port}`);
  startSchedulers();
});

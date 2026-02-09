const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.sqlite");
const db = new Database(DB_PATH);

function initDb() {
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_user_id TEXT PRIMARY KEY,
      chat_id TEXT,
      locale TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_user_id TEXT NOT NULL,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (tg_user_id) REFERENCES users(tg_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(tg_user_id);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_user_id TEXT NOT NULL,
      type TEXT NOT NULL,           -- price | apy
      chain TEXT NOT NULL,          -- evm | sol | btc | ton
      asset TEXT NOT NULL,          -- ETH | BTC | SOL | USDC...
      condition TEXT NOT NULL,      -- above | below
      threshold REAL NOT NULL,
      frequency TEXT NOT NULL,      -- instant | daily | weekly
      enabled INTEGER NOT NULL DEFAULT 1,
      last_triggered_at INTEGER,
      cooldown_minutes INTEGER NOT NULL DEFAULT 60,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (tg_user_id) REFERENCES users(tg_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(tg_user_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alerts(enabled);
  `);
}

function upsertUser({ tgUserId, locale }) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO users (tg_user_id, locale, created_at, updated_at)
    VALUES (@tgUserId, @locale, @now, @now)
    ON CONFLICT(tg_user_id) DO UPDATE SET
      locale=excluded.locale,
      updated_at=excluded.updated_at
  `);
  stmt.run({ tgUserId: String(tgUserId), locale: locale || "en", now });
}

function setChatId({ tgUserId, chatId }) {
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE users SET chat_id=@chatId, updated_at=@now WHERE tg_user_id=@tgUserId
  `);
  stmt.run({ tgUserId: String(tgUserId), chatId: String(chatId), now });
}

function getUser({ tgUserId }) {
  const stmt = db.prepare(`SELECT * FROM users WHERE tg_user_id=?`);
  return stmt.get(String(tgUserId)) || null;
}

function saveActiveWallet({ tgUserId, chain, address }) {
  const now = Date.now();
  // Deactivate others
  db.prepare(`UPDATE wallets SET is_active=0 WHERE tg_user_id=?`).run(String(tgUserId));
  // Insert new active
  db.prepare(`
    INSERT INTO wallets (tg_user_id, chain, address, is_active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(String(tgUserId), chain, address, now);
}

function getActiveWallet({ tgUserId }) {
  const stmt = db.prepare(`SELECT * FROM wallets WHERE tg_user_id=? AND is_active=1 ORDER BY id DESC LIMIT 1`);
  return stmt.get(String(tgUserId)) || null;
}

function listAlerts({ tgUserId }) {
  const stmt = db.prepare(`SELECT * FROM alerts WHERE tg_user_id=? ORDER BY id DESC`);
  return stmt.all(String(tgUserId));
}

function createAlert({ tgUserId, type, chain, asset, condition, threshold, frequency }) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO alerts (tg_user_id, type, chain, asset, condition, threshold, frequency, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const info = stmt.run(String(tgUserId), type, chain, asset, condition, threshold, frequency, now);
  return info.lastInsertRowid;
}

function updateAlertEnabled({ tgUserId, alertId, enabled }) {
  const stmt = db.prepare(`UPDATE alerts SET enabled=? WHERE id=? AND tg_user_id=?`);
  stmt.run(enabled ? 1 : 0, Number(alertId), String(tgUserId));
}

function deleteAlert({ tgUserId, alertId }) {
  const stmt = db.prepare(`DELETE FROM alerts WHERE id=? AND tg_user_id=?`);
  stmt.run(Number(alertId), String(tgUserId));
}

function getEnabledAlerts() {
  const stmt = db.prepare(`
    SELECT a.*, u.chat_id
    FROM alerts a
    JOIN users u ON u.tg_user_id = a.tg_user_id
    WHERE a.enabled=1
  `);
  return stmt.all();
}

function markAlertTriggered({ alertId }) {
  const now = Date.now();
  db.prepare(`UPDATE alerts SET last_triggered_at=? WHERE id=?`).run(now, Number(alertId));
}

module.exports = {
  db,
  initDb,
  upsertUser,
  setChatId,
  getUser,
  saveActiveWallet,
  getActiveWallet,
  listAlerts,
  createAlert,
  updateAlertEnabled,
  deleteAlert,
  getEnabledAlerts,
  markAlertTriggered
};

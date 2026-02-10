  const crypto = require("crypto");

  function timingSafeEqualHex(aHex, bHex) {
    try {
      const a = Buffer.from(aHex, "hex");
      const b = Buffer.from(bHex, "hex");
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Validates Telegram WebApp initData string (querystring) per official algorithm.
   * Throws on invalid.
   */
  function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
    if (!initData || typeof initData !== "string") {
      throw new Error("Missing initData");
    }
    if (!botToken) {
      throw new Error("Missing BOT_TOKEN");
    }

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) throw new Error("initData missing hash");

    // Optional freshness check
    const authDateStr = params.get("auth_date");
    if (authDateStr) {
      const authDate = Number(authDateStr);
      if (!Number.isFinite(authDate)) throw new Error("Invalid auth_date");
      const now = Math.floor(Date.now() / 1000);
      if (now - authDate > maxAgeSeconds) {
        throw new Error("initData expired");
      }
    }

    // Build data-check-string: key=value sorted by key, excluding hash
    const pairs = [];
    for (const [key, value] of params.entries()) {
      if (key === "hash") continue;
      pairs.push([key, value]);
    }
    pairs.sort((a, b) => a[0].localeCompare(b[0]));

    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

    // secretKey = HMAC_SHA256(key="WebAppData", msg=botToken)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // calculatedHash = HMAC_SHA256(key=secretKey, msg=dataCheckString).hex
    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (!timingSafeEqualHex(calculatedHash, hash)) {
      throw new Error("initData hash mismatch");
    }

    // Parse user JSON if present
    const userRaw = params.get("user");
    let user = null;
    if (userRaw) {
      try {
        user = JSON.parse(userRaw);
      } catch {
        user = null;
      }
    }
    return { user, authDate: authDateStr ? Number(authDateStr) : null, params };
  }

  module.exports = { validateInitData };

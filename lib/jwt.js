const jwt = require("jsonwebtoken");

function signSessionToken({ tgUserId, locale }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET");
  const token = jwt.sign(
    { locale: locale || "en" },
    secret,
    { subject: String(tgUserId), expiresIn: "7d" }
  );
  return token;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { tgUserId: payload.sub, locale: payload.locale || "en" };
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { signSessionToken, authMiddleware };

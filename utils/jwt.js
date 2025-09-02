// backend/utils/jwt.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = (process.env.JWT_SECRET || 'dev-secret').trim();

function sign(payload, opts = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: opts.expiresIn || '7d' });
}
function verify(token) {
  return jwt.verify(token, JWT_SECRET);
}
function decode(token) {
  try { return jwt.decode(token, { complete: true }) || null; } catch { return null; }
}
function secretFingerprint() {
  return crypto.createHash('sha256').update(JWT_SECRET).digest('hex').slice(0, 12);
}

module.exports = { sign, verify, decode, JWT_SECRET, secretFingerprint };

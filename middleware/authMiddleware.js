// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

/* IMPORTANT : même secret que dans routes/auth.js */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function extractToken(req) {
  // 1) Authorization: Bearer xxx
  let authz = req.headers.authorization || req.headers.Authorization || '';
  if (typeof authz === 'string' && authz.toLowerCase().startsWith('bearer ')) {
    return authz.slice(7).trim().replace(/^"|"$/g, '');
  }
  // 2) x-access-token / x-auth-token
  const hat = req.headers['x-access-token'] || req.headers['x-auth-token'];
  if (hat) return String(hat).trim().replace(/^"|"$/g, '');
  // 3) query/body token
  if (req.query && req.query.token) return String(req.query.token).trim().replace(/^"|"$/g, '');
  if (req.body && req.body.token) return String(req.body.token).trim().replace(/^"|"$/g, '');
  // 4) cookie=token=...
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]).trim().replace(/^"|"$/g, '');
  return null;
}

module.exports = async function auth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
    }

    const payload = jwt.verify(token, JWT_SECRET);

    const tokenTv =
      typeof payload.tv === 'number' ? payload.tv
      : typeof payload.tokenVersion === 'number' ? payload.tokenVersion
      : undefined;

    let account = null;

    if (payload.id) {
      account = await User.findById(payload.id)
        .select('isActive tokenVersion role email communeId communeName');
      if (!account && Admin) {
        account = await Admin.findById(payload.id)
          .select('isActive tokenVersion role email communeId communeName');
      }
    }
    if (!account && payload.email) {
      account = await User.findOne({ email: payload.email })
        .select('isActive tokenVersion role email communeId communeName');
      if (!account && Admin) {
        account = await Admin.findOne({ email: payload.email })
          .select('isActive tokenVersion role email communeId communeName');
      }
    }

    if (!account) return res.status(401).json({ message: 'Utilisateur introuvable' });
    if (account.isActive === false) return res.status(403).json({ message: 'Compte désactivé' });

    const currentTv = typeof account.tokenVersion === 'number' ? account.tokenVersion : 0;
    if (typeof tokenTv === 'number' && tokenTv !== currentTv) {
      return res.status(401).json({ message: 'Session expirée (déconnexion forcée)' });
    }

    req.user = {
      id: String(account._id),
      email: account.email,
      role: account.role,
      communeId: account.communeId || '',
      communeName: account.communeName || '',
      tv: currentTv,
      impersonated: !!payload.impersonated,
      origUserId: payload.origUserId ? String(payload.origUserId) : undefined,
    };

    next();
  } catch (e) {
    const msg = e && e.name === 'TokenExpiredError' ? 'Session expirée' : 'Token invalide';
    return res.status(401).json({ message: msg });
  }
};

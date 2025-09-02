// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

/* IMPORTANT : même secret que dans routes/auth.js */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function extractBearerToken(req) {
  // 1) Header standard
  let tok =
    req.headers.authorization ||
    req.headers.Authorization ||
    req.headers['x-access-token'] ||
    req.headers['x-token'] ||
    req.headers['x-auth-token'];

  // 2) Query / Body (fallbacks)
  if (!tok && req.query && req.query.token) tok = req.query.token;
  if (!tok && req.body && req.body.token) tok = req.body.token;

  if (!tok) return null;
  if (typeof tok === 'string' && tok.toLowerCase().startsWith('bearer ')) {
    return tok.slice(7).trim();
  }
  return String(tok).trim();
}

module.exports = async function auth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ message: 'Accès non autorisé - token manquant' });
    }

    const payload = jwt.verify(token, JWT_SECRET);

    const tokenTv =
      typeof payload.tv === 'number'
        ? payload.tv
        : typeof payload.tokenVersion === 'number'
        ? payload.tokenVersion
        : undefined;

    let account = null;

    // Recherche par id, puis par email, sur User puis Admin (si modèle Admin existe)
    if (payload.id) {
      account = await User.findById(payload.id).select(
        'isActive tokenVersion role email communeId communeName'
      );
      if (!account && Admin) {
        account = await Admin.findById(payload.id).select(
          'isActive tokenVersion role email communeId communeName'
        );
      }
    }
    if (!account && payload.email) {
      account = await User.findOne({ email: payload.email }).select(
        'isActive tokenVersion role email communeId communeName'
      );
      if (!account && Admin) {
        account = await Admin.findOne({ email: payload.email }).select(
          'isActive tokenVersion role email communeId communeName'
        );
      }
    }

    if (!account)
      return res.status(401).json({ message: 'Utilisateur introuvable' });
    if (account.isActive === false)
      return res.status(403).json({ message: 'Compte désactivé' });

    const currentTv =
      typeof account.tokenVersion === 'number' ? account.tokenVersion : 0;
    if (typeof tokenTv === 'number' && tokenTv !== currentTv) {
      return res
        .status(401)
        .json({ message: 'Session expirée (déconnexion forcée)' });
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
    const msg =
      e && e.name === 'TokenExpiredError'
        ? 'Session expirée'
        : 'Token invalide';
    return res.status(401).json({ message: msg });
  }
};

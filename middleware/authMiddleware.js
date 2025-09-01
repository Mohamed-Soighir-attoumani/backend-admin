// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}
const logger = require('../logger');
const JWT_SECRET = require('../config/jwt'); // ✅ centralisé

module.exports = async function auth(req, res, next) {
  try {
    const authz = String(req.headers.authorization || '');
    let token = null;

    if (authz.toLowerCase().startsWith('bearer ')) {
      token = authz.slice(7).trim();
    }

    // Option de secours: si un client met le token entre guillemets
    if (token && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) {
      token = token.slice(1, -1);
    }

    if (!token) {
      return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // Expiration → message distinct, sinon “token invalide”
      if (e && e.name === 'TokenExpiredError') {
        logger.warn('JWT expiré', { at: 'authMiddleware', error: e.message });
        return res.status(401).json({ message: 'Session expirée' });
      }
      logger.warn('JWT invalide', { at: 'authMiddleware', error: e.message });
      return res.status(401).json({ message: 'Token invalide' });
    }

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
    logger.error('Erreur middleware auth', { error: e.stack });
    return res.status(401).json({ message: 'Token invalide' });
  }
};

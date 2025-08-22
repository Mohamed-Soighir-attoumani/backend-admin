// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

module.exports = async function auth(req, res, next) {
  try {
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
    if (!token) return res.status(401).json({ message: 'Accès non autorisé - token manquant' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Supporter à la fois payload.tv et payload.tokenVersion
    const tokenTv =
      typeof payload.tv === 'number' ? payload.tv
      : typeof payload.tokenVersion === 'number' ? payload.tokenVersion
      : undefined;

    // Chercher le compte dans User puis Admin (par id, puis fallback email)
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

    // Infos fiables issues de la DB (pas du token)
    req.user = {
      id: String(account._id),
      email: account.email,
      role: account.role,
      communeId: account.communeId || '',
      communeName: account.communeName || '',
      tv: currentTv,
      // flags d’impersonation conservés si présents
      impersonated: !!payload.impersonated,
      origUserId: payload.origUserId ? String(payload.origUserId) : undefined,
    };

    next();
  } catch (e) {
    const msg = e && e.name === 'TokenExpiredError' ? 'Session expirée' : 'Token invalide';
    return res.status(401).json({ message: msg });
  }
};

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

/** IMPORTANT : même secret que dans routes/auth.js */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const norm = (v) => String(v || '').trim().toLowerCase();

module.exports = async function auth(req, res, next) {
  try {
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
    if (!token) return res.status(401).json({ message: 'Accès non autorisé - token manquant' });

    // vérif signature + exp
    const payload = jwt.verify(token, JWT_SECRET);

    const tokenTv =
      typeof payload.tv === 'number' ? payload.tv
      : typeof payload.tokenVersion === 'number' ? payload.tokenVersion
      : undefined;

    let account = null;

    // 1) par id si plausible
    if (payload.id && mongoose.Types.ObjectId.isValid(String(payload.id))) {
      const id = String(payload.id);
      account = await User.findById(id)
        .select('_id isActive tokenVersion role email communeId communeName');
      if (!account && Admin) {
        account = await Admin.findById(id)
          .select('_id isActive tokenVersion role email communeId communeName');
      }
    }

    // 2) fallback par email
    if (!account && payload.email) {
      const email = norm(payload.email);
      account = await User.findOne({ email })
        .select('_id isActive tokenVersion role email communeId communeName');
      if (!account && Admin) {
        account = await Admin.findOne({ email })
          .select('_id isActive tokenVersion role email communeId communeName');
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

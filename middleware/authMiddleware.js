const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Accès non autorisé - token manquant' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Vérification dans la base
    const u = await User.findById(payload.id).select('isActive tokenVersion role email communeId communeName');
    if (!u) return res.status(401).json({ message: 'Utilisateur introuvable' });
    if (!u.isActive) return res.status(403).json({ message: 'Compte désactivé' });
    if (typeof payload.tokenVersion === 'number' && u.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({ message: 'Session expirée (déconnexion forcée)' });
    }

    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Token invalide' });
  }
};

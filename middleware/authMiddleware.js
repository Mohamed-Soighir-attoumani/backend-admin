// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/jwt');

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const userId = decoded.id || decoded._id || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }
    req.user = decoded; // { id, role, email, ... }
    req.userId = userId;
    req.userRole = decoded.role || null;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

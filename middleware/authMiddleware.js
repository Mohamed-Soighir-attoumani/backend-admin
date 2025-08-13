// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/jwt');

module.exports = function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret());
    // On attend au minimum un id OU un email
    if (!decoded?.id && !decoded?.email) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }

    req.user = decoded; // { id, email, role, ... }
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

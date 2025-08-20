// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET non défini côté serveur');
  return s;
}

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || (!decoded.id && !decoded.email)) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }
    req.user = decoded; // { id, email, role, communeId, communeName, src, ... }
    next();
  } catch (err) {
    console.error('❌ authMiddleware:', err.message);
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

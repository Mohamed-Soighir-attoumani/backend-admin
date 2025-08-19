// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error('JWT_SECRET non défini côté serveur');
  }
  return s;
}

/**
 * Exige Authorization: Bearer <token>
 * Décode le token et remplit req.user = { id, email, role }
 */
module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const id = decoded.id || decoded._id || decoded.sub;
    if (!id) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }
    req.user = {
      id,
      email: decoded.email || null,
      role: decoded.role || 'user',
    };
    next();
  } catch (err) {
    console.error('❌ authMiddleware:', err.message);
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

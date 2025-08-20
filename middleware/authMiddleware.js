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
 * Décode le token et remplit req.user = { id, email, role, src, ... }
 */
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
    // log léger pour aider au debug en prod (ne contient pas de secret)
    // console.log('[auth] token ok', { id: decoded.id, email: decoded.email, role: decoded.role, src: decoded.src });
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ authMiddleware:', err.message);
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    // On fail fast en dev/hébergement pour éviter des tokens invalides silencieux
    throw new Error('JWT_SECRET non défini côté serveur');
  }
  return s;
}

/**
 * Exige un header Authorization: Bearer <token>
 * Décode le token et remplit req.user = { id, role, email, ... }
 */
module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded?.id) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }
    req.user = decoded; // { id, role, email, iat, exp }
    next();
  } catch (err) {
    console.error('❌ authMiddleware:', err.message);
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

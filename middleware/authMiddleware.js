// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

/**
 * Middleware d'authentification JWT pour routes protégées (admin).
 * - Exige un header "Authorization: Bearer <token>"
 * - Vérifie le token avec JWT_SECRET (doit être le même que celui utilisé au login)
 * - Attache { id, role, ... } à req.user
 */
module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // On force la configuration pour éviter les surprises "secret123" d’un autre fichier
      return res.status(500).json({ message: 'JWT_SECRET non défini côté serveur' });
    }

    const decoded = jwt.verify(token, secret);

    // On attend au minimum un id et un role=admin
    if (!decoded || !decoded.id) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }

    // Optionnel : si tu veux restreindre cette route aux admins seulement :
    if (decoded.role && decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Accès interdit - rôle non autorisé' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error('Erreur authMiddleware :', err.message);
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

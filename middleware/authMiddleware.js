// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Important de le savoir en dev si on oublie la variable
    return res.status(500).json({ message: 'JWT_SECRET non défini côté serveur' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    // On attend au minimum un id dans le payload
    if (!decoded?.id) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }
    req.user = decoded; // { id, role, ... }
    next();
  } catch (err) {
    // expiré ou signature invalide
    return res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

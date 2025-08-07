const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Vérifie la présence d'un header "Authorization: Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé - token manquant' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // On injecte l'utilisateur décodé dans la requête
    req.user = decoded;

    // Si besoin : vérifier qu'un champ id est bien présent dans le token
    if (!req.user || !req.user.id) {
      return res.status(403).json({ message: 'Token invalide - identifiant manquant' });
    }

    next();
  } catch (err) {
    console.error("Erreur authMiddleware :", err.message);
    res.status(403).json({ message: 'Token invalide ou expiré' });
  }
};

module.exports = authMiddleware;

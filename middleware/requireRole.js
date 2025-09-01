// backend/middleware/requireRole.js
module.exports = function requireRole(required) {
  const needed = Array.isArray(required) ? required : [required];

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });

    // superadmin a tous les droits
    if (req.user.role === 'superadmin') return next();

    if (!needed.includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès refusé' });
    }
    next();
  };
};

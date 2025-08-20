// backend/middleware/scopeByCommune.js
// Pour les routes multi-ressources : force un filtre par commune pour les non-superadmin
module.exports = function scopeByCommune(field = 'communeId') {
  return (req, _res, next) => {
    if (req.user?.role !== 'superadmin') {
      req.scope = req.scope || {};
      req.scope[field] = req.user?.communeId || ''; // si pas d’id, on force '' (aucun mélange)
    }
    next();
  };
};

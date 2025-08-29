// backend/middleware/requireCommuneAccess.js
const Admin = require('../models/Admin');

module.exports = function requireCommuneAccess() {
  return async (req, res, next) => {
    // superadmin => accès global
    if (req.user?.role === 'superadmin') return next();

    const cid = req.communeId;
    if (!cid) return res.status(400).json({ message: 'communeId requis' });

    const me = await Admin.findById(req.user.id).select('role communeId');
    if (!me) return res.status(403).json({ message: 'Compte introuvable' });

    // Admin simple : doit matcher la communeId
    if (String(me.communeId || '') !== String(cid)) {
      return res.status(403).json({ message: 'Accès interdit à cette commune' });
    }
    next();
  };
};

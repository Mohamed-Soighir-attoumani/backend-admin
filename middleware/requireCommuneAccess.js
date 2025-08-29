// backend/middleware/requireCommuneAccess.js
module.exports = function requireCommuneAccess() {
  return (req, res, next) => {
    // superadmin => accès global
    if (req.user?.role === 'superadmin') return next();

    const cid = req.communeId;
    if (!cid) return res.status(400).json({ message: 'communeId requis' });

    // Admin simple : doit matcher sa commune
    if (String(req.user?.communeId || '') !== String(cid)) {
      return res.status(403).json({ message: 'Accès interdit à cette commune' });
    }
    next();
  };
};

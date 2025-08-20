// backend/middleware/ensureSelfOrRole.js
module.exports = function ensureSelfOrRole(...roles) {
  return (req, res, next) => {
    const isSelf = req.user?.id && req.params?.id && String(req.user.id) === String(req.params.id);
    if (isSelf) return next();
    const r = req.user?.role;
    if (!r || !roles.includes(r)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }
    next();
  };
};

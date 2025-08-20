// backend/middleware/requireRole.js
module.exports = function requireRole(...roles) {
  return (req, res, next) => {
    const r = req.user?.role;
    if (!r || !roles.includes(r)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }
    next();
  };
};

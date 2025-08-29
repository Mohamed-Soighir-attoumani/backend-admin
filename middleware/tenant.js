// backend/middleware/tenant.js
module.exports = function tenant(options = { require: true }) {
  return (req, res, next) => {
    const cid = String(
      req.header('x-commune-id') ||
      req.query.communeId ||
      (req.body && req.body.communeId) ||
      ''
    ).trim();

    if (options.require && !cid) {
      return res.status(400).json({ message: 'communeId requis' });
    }
    req.communeId = cid || null;
    next();
  };
};

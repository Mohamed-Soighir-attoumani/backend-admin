// middleware/auth.js
module.exports = {
  verifyToken: (req, res, next) => {
    // TODO: vérifier le JWT dans Authorization: Bearer <token>
    next();
  },
  isAdmin: (req, res, next) => {
    // TODO: vérifier que l'utilisateur a role === 'admin'
    next();
  },
};

// backend/utils/jwt.js
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET non défini dans l’environnement');
  }
  return secret;
}

module.exports = { getJwtSecret };

// backend/utils/jwt.js
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET non défini dans les variables d’environnement');
  }
  return secret;
};

module.exports = { getJwtSecret };

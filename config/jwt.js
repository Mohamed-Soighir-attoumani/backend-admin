// backend/config/jwt.js
// Centralise le secret JWT et élimine les espaces/retours/ch guillemets accidentels.
let secret = (process.env.JWT_SECRET || 'dev-secret').trim();
// Si quelqu'un a mis des guillemets dans Render par erreur:
if (secret.startsWith('"') && secret.endsWith('"')) secret = secret.slice(1, -1);
if (secret.startsWith("'") && secret.endsWith("'")) secret = secret.slice(1, -1);

module.exports = secret;

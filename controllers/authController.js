// backend/controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET non défini côté serveur');
  return s;
}

/**
 * POST /api/login
 * Body: { email, password }
 * Retourne: { token }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    // on doit sélectionner explicitement password car select: false
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const payload = { id: user._id.toString(), email: user.email, role: user.role };
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });

    return res.json({ token });
  } catch (e) {
    console.error('❌ login:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};

module.exports = { login };

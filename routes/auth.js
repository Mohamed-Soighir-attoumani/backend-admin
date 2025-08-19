// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let Admin = null;
try {
  // Optionnel si tu as encore le modèle Admin pour anciens comptes
  Admin = require('../models/Admin');
} catch (_) {
  // pas grave si le modèle n'existe plus
}

const router = express.Router();

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET non défini côté serveur');
  return s;
}

/**
 * POST /api/login
 * Body: { email, password }
 * Retour: { token }
 * - Auth standard sur User (email)
 * - Fallback sur Admin si User inexistant (compat héritage)
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    // User d'abord (password est select:false dans le schema proposé)
    let doc = await User.findOne({ email }).select('+password role email');
    let model = 'User';

    // Fallback sur Admin si pas de User
    if (!doc && Admin) {
      // selon ton schema Admin, ajuste select si besoin
      doc = await Admin.findOne({ email }).select('+password role email');
      model = doc ? 'Admin' : model;
    }

    if (!doc) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const ok = await bcrypt.compare(password, doc.password);
    if (!ok) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const payload = {
      id: doc._id.toString(),
      email: doc.email,
      role: doc.role || 'admin',
      // Optionnel: source du compte pour debug
      src: model,
    };

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });
    return res.json({ token });
  } catch (e) {
    console.error('❌ /login:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

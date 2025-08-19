// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET non défini côté serveur');
  return s;
}

/**
 * POST /api/login
 * Body: { email, password }
 * - Auth sur User (email), fallback sur Admin si non trouvé.
 * - Signe un token contenant { id, email, role }.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    let doc = await User.findOne({ email }).select('+password email role');
    let src = 'User';

    if (!doc && Admin) {
      doc = await Admin.findOne({ email }).select('+password email role');
      if (doc) src = 'Admin';
    }

    if (!doc) return res.status(401).json({ message: 'Identifiants invalides' });

    const ok = await bcrypt.compare(password, doc.password);
    if (!ok) return res.status(401).json({ message: 'Identifiants invalides' });

    const payload = { id: doc._id.toString(), email: doc.email, role: doc.role || 'admin', src };
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });

    return res.json({ token });
  } catch (e) {
    console.error('❌ /login:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const TOKEN_EXPIRES_IN = '7d';

router.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email et mot de passe requis.' });
    }

    const emailNorm = email.trim().toLowerCase();
    const baseSelect = '+password email role isActive tokenVersion';

    // 1) Chercher d’abord un User, puis un Admin
    let doc = await User.findOne({ email: emailNorm }).select(baseSelect);
    if (!doc && Admin) {
      doc = await Admin.findOne({ email: emailNorm }).select(baseSelect);
    }
    if (!doc) {
      // même message pour éviter le leakage d’infos
      return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // 2) Vérif compte actif (si le champ existe)
    if (typeof doc.isActive === 'boolean' && !doc.isActive) {
      return res.status(403).json({ message: 'Compte désactivé. Contactez un administrateur.' });
    }

    // 3) Comparer le mot de passe (doc.password est disponible grâce à .select('+password'))
    const ok = await bcrypt.compare(password, doc.password || '');
    if (!ok) {
      return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // 4) Générer le token
    const payload = {
      id: String(doc._id),
      email: doc.email,
      role: doc.role || 'user',
      tv: typeof doc.tokenVersion === 'number' ? doc.tokenVersion : 0, // token version
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });

    return res.json({
      token,
      user: {
        id: String(doc._id),
        email: doc.email,
        name: doc.name || '',
        role: doc.role || 'user',
        communeId: doc.communeId || '',
        communeName: doc.communeName || '',
        photo: doc.photo || '',
      },
    });
  } catch (e) {
    console.error('❌ POST /auth/login error:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur.' });
  }
});

module.exports = router;

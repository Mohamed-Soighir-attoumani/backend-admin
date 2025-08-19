// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

// Préflight (OPTIONS) pour /api/change-password
router.options('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  return res.sendStatus(204);
});

// GET informatif
router.get('/', (_req, res) => {
  return res.json({
    ok: true,
    route: '/api/change-password',
    howTo: 'POST /api/change-password avec Authorization: Bearer <token> et body { oldPassword, newPassword }'
  });
});

// POST /api/change-password
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const authUser = req.user || {};

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Champs requis manquants' });
    }

    let doc = null;

    // 1) Recherche par id (nouveaux tokens)
    if (authUser.id && isValidObjectId(authUser.id)) {
      doc = await User.findById(authUser.id).select('+password email role');
      if (!doc && Admin) doc = await Admin.findById(authUser.id).select('+password email role');
    }

    // 2) Fallback par email
    if (!doc && authUser.email) {
      doc = await User.findOne({ email: authUser.email }).select('+password email role');
      if (!doc && Admin) doc = await Admin.findOne({ email: authUser.email }).select('+password email role');
    }

    // 3) Legacy: username=admin -> ADMIN_EMAIL
    if (!doc && authUser.username === 'admin') {
      const legacyEmail = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
      doc = await User.findOne({ email: legacyEmail }).select('+password email role');
      if (!doc && Admin) doc = await Admin.findOne({ email: legacyEmail }).select('+password email role');
    }

    if (!doc) {
      console.warn('⚠️ change-password: utilisateur introuvable', { tokenUser: authUser });
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const ok = await bcrypt.compare(oldPassword, doc.password);
    if (!ok) return res.status(400).json({ message: 'Ancien mot de passe incorrect' });

    doc.password = await bcrypt.hash(newPassword, 10);
    await doc.save();

    return res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('❌ /change-password:', err);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

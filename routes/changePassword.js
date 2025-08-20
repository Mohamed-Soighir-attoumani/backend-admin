// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

// Préflight + Ping (debug)
router.options('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  return res.sendStatus(204);
});

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    route: '/api/change-password',
    howTo: 'POST /api/change-password avec Authorization: Bearer <token> et body { oldPassword, newPassword }'
  });
});

// POST /api/change-password
router.post('/', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Champs requis manquants' });
    }

    const u = req.user || {}; // { id, email, role, ... }
    let doc = null;

    // 1) par id
    if (u.id && isValidObjectId(u.id)) {
      doc = await User.findById(u.id).select('+password email role');
      if (!doc && Admin) doc = await Admin.findById(u.id).select('+password email role');
    }
    // 2) fallback par email
    if (!doc && u.email) {
      doc = await User.findOne({ email: u.email }).select('+password email role');
      if (!doc && Admin) doc = await Admin.findOne({ email: u.email }).select('+password email role');
    }

    if (!doc) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const ok = await bcrypt.compare(oldPassword, doc.password);
    if (!ok) return res.status(400).json({ message: 'Ancien mot de passe incorrect' });

    doc.password = await bcrypt.hash(newPassword, 10);
    await doc.save();

    return res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (e) {
    console.error('❌ POST /change-password:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

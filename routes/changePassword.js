// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

let Admin = null;
try {
  Admin = require('../models/Admin'); // ok si absent
} catch (_) {}

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id || '');
}

/** 
 * Aides debug/infra
 * - OPTIONS: pour préflight CORS (évite 404)
 * - GET /change-password/ping: pour vérifier que la route est bien montée en prod
 */
router.options('/change-password', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  return res.sendStatus(204);
});

router.get('/change-password/ping', (req, res) => {
  return res.json({ ok: true, route: '/api/change-password', hint: 'Route montée ✅' });
});

/**
 * POST /api/change-password
 * Header: Authorization: Bearer <token>
 * Body: { oldPassword, newPassword }
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const authUser = req.user || {};

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Champs requis manquants' });
    }

    let doc = null;

    // 1) par id
    if (authUser.id && isValidObjectId(authUser.id)) {
      doc = await User.findById(authUser.id).select('+password email role');
      if (!doc && Admin) {
        doc = await Admin.findById(authUser.id).select('+password email role');
      }
    }

    // 2) par email
    if (!doc && authUser.email) {
      doc = await User.findOne({ email: authUser.email }).select('+password email role');
      if (!doc && Admin) {
        doc = await Admin.findOne({ email: authUser.email }).select('+password email role');
      }
    }

    // 3) legacy username=admin → ADMIN_EMAIL
    if (!doc && authUser.username) {
      const legacyEmail = (authUser.username === 'admin') ? (process.env.ADMIN_EMAIL || 'admin@mairie.fr') : null;
      if (legacyEmail) {
        doc = await User.findOne({ email: legacyEmail }).select('+password email role');
        if (!doc && Admin) {
          doc = await Admin.findOne({ email: legacyEmail }).select('+password email role');
        }
      }
    }

    if (!doc) {
      console.warn('⚠️ change-password: utilisateur introuvable', { tokenUser: authUser });
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const ok = await bcrypt.compare(oldPassword, doc.password);
    if (!ok) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    doc.password = await bcrypt.hash(newPassword, salt);
    await doc.save();

    return res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('❌ /change-password:', err);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

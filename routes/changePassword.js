// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

let Admin = null;
try {
  // Optionnel si tu as encore le modèle Admin pour anciens comptes
  Admin = require('../models/Admin');
} catch (_) {
  // pas grave si le modèle n'existe plus
}

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id || '');
}

/**
 * POST /api/change-password
 * Header: Authorization: Bearer <token>
 * Body: { oldPassword, newPassword }
 * - Cherche d'abord via req.user.id dans User, puis Admin
 * - Fallback via email (ou username→email) si id manquant (anciens tokens)
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = (req.body || {});
  const authUser = req.user || {}; // attendu: { id, email, role }

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Champs requis manquants' });
  }

  try {
    let doc = null;

    // 1) Recherche par id (nouveaux tokens)
    if (authUser.id && isValidObjectId(authUser.id)) {
      doc = await User.findById(authUser.id).select('+password email role');
      if (!doc && Admin) {
        doc = await Admin.findById(authUser.id).select('+password email role');
      }
    }

    // 2) Fallback: par email (anciens tokens qui embarquent l'email)
    if (!doc && authUser.email) {
      doc = await User.findOne({ email: authUser.email }).select('+password email role');
      if (!doc && Admin) {
        doc = await Admin.findOne({ email: authUser.email }).select('+password email role');
      }
    }

    // 3) Fallback ultime: si token ancien contient username=admin (très vieux flux)
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

    const isMatch = await bcrypt.compare(oldPassword, doc.password);
    if (!isMatch) {
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

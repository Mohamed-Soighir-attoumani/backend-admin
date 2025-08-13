// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * POST /api/change-password
 * Header: Authorization: Bearer <token>
 * Body: { oldPassword, newPassword }
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const authUser = req.user; // { id, role, email }

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Champs requis manquants' });
  }

  try {
    // 1) On tente ID depuis le token
    let admin = null;
    if (authUser?.id) {
      admin = await Admin.findById(authUser.id);
    }

    // 2) Fallback par email si besoin (utile si ancien token ou incohérence)
    if (!admin && authUser?.email) {
      admin = await Admin.findOne({ email: authUser.email });
    }

    if (!admin) {
      console.warn('⚠️ change-password: admin introuvable', { tokenUser: authUser });
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect' });
    }

    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();

    return res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('❌ /change-password:', err);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * POST /api/change-password
 * Header: Authorization: Bearer <token>
 * Body: { oldPassword, newPassword }
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const authUser = req.user; // { id, email, role }

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Champs requis manquants' });
  }

  try {
    // Récupération de l'utilisateur authentifié avec le hash
    const user = await User.findById(authUser.id).select('+password');
    if (!user) {
      console.warn('⚠️ change-password: user introuvable', { tokenUser: authUser });
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('❌ /change-password:', err);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

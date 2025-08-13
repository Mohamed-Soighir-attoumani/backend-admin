// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * POST /api/change-password
 * Body: { oldPassword, newPassword }
 * Auth: Bearer <JWT>
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  // On récupère ce que le token contient
  const adminIdFromToken = req.user?.id;
  const emailFromToken = req.user?.email;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Champs requis manquants' });
  }

  try {
    let admin = null;

    // 1) On tente par id si présent
    if (adminIdFromToken) {
      admin = await Admin.findById(adminIdFromToken);
    }

    // 2) Back-up : si pas trouvé par id, on tente par email
    if (!admin && emailFromToken) {
      admin = await Admin.findOne({ email: emailFromToken });
    }

    if (!admin) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Vérif de l’ancien mot de passe
    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect' });
    }

    // Met à jour le mot de passe
    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();

    return res.status(200).json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('Erreur lors du changement de mot de passe :', err);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

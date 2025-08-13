// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const adminId = req.userId; // fixé par le middleware

  try {
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Champs manquants' });
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const ok = await bcrypt.compare(oldPassword, admin.password);
    if (!ok) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect' });
    }

    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();

    return res.status(200).json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('Erreur /change-password :', err);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

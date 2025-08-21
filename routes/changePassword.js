// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

const MIN_LEN = 8;
const hasUpper = (s) => /[A-Z]/.test(s);
const hasDigit = (s) => /\d/.test(s);
const hasSpecial = (s) => /[!@#$%^&*(),.?":{}|<>_\-\[\]\\;/+=`~'€£§%]/.test(s);

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    route: '/api/change-password',
    howTo: 'POST Authorization: Bearer <token> body { oldPassword, newPassword }'
  });
});

router.post('/', auth, async (req, res) => {
  try {
    let { oldPassword, newPassword } = req.body || {};
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ message: 'Champs requis manquants' });
    }
    oldPassword = oldPassword.trim();
    newPassword = newPassword.trim();

    // Validations côté serveur
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Champs requis manquants' });
    }
    if (newPassword.length < MIN_LEN) {
      return res.status(400).json({ message: `Le nouveau mot de passe doit contenir au moins ${MIN_LEN} caractères.` });
    }
    if (!hasUpper(newPassword) || !hasDigit(newPassword) || !hasSpecial(newPassword)) {
      return res.status(400).json({ message: 'Le nouveau mot de passe doit contenir une majuscule, un chiffre et un caractère spécial.' });
    }
    if (newPassword === oldPassword) {
      return res.status(400).json({ message: "Le nouveau mot de passe doit être différent de l'ancien." });
    }

    // Qui est connecté ?
    const u = req.user || {};
    if (!u.id && !u.email) {
      return res.status(401).json({ message: 'Non authentifié' });
    }

    // Récupération de l’utilisateur (User OU Admin) avec +password
    let doc = null;
    if (u.id && isValidObjectId(u.id)) {
      doc = await User.findById(u.id).select('+password email role');
      if (!doc && Admin) doc = await Admin.findById(u.id).select('+password email role');
    }
    if (!doc && u.email) {
      doc = await User.findOne({ email: u.email }).select('+password email role');
      if (!doc && Admin) doc = await Admin.findOne({ email: u.email }).select('+password email role');
    }

    if (!doc) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Vérification de l’ancien mot de passe
    const ok = await bcrypt.compare(oldPassword, doc.password || '');
    if (!ok) {
      return res.status(400).json({ message: 'Ancien mot de passe incorrect' });
    }

    // Empêcher de remettre le même hash (par sécurité supplémentaire)
    const sameAsOld = await bcrypt.compare(newPassword, doc.password || '');
    if (sameAsOld) {
      return res.status(400).json({ message: "Le nouveau mot de passe ne doit pas être identique à l'ancien." });
    }

    // Hash & save
    const salt = await bcrypt.genSalt(10);
    doc.password = await bcrypt.hash(newPassword, salt);
    await doc.save();

    return res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (e) {
    console.error('❌ POST /api/change-password error:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

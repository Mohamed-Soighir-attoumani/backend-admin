// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User'); // ✅ unifié: on utilise le modèle User

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Crée un compte admin si aucun admin n'existe.
 * - Utilise ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME si présents,
 *   sinon des valeurs par défaut.
 * - Ne log jamais le mot de passe en clair.
 */
router.get('/setup-admin', async (req, res) => {
  try {
    // S'il y a déjà AU MOINS un utilisateur admin, on ne recrée pas
    const existingAdmin = await User.findOne({ role: 'admin' }).lean();
    if (existingAdmin) {
      return res.json({ ok: true, created: false, message: 'Un admin existe déjà.' });
    }

    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';
    const name  = process.env.ADMIN_NAME || 'Administrateur';

    // Si un user avec le même email existe déjà (mais pas admin),
    // on peut l'élever en admin après vérification si tu veux.
    const existingByEmail = await User.findOne({ email }).select('_id role').lean();
    if (existingByEmail) {
      // Ici, on choisit de ne PAS écraser son mot de passe.
      // On met juste son rôle à admin (si tu veux écraser le mdp, fais un update avec hash).
      await User.updateOne({ _id: existingByEmail._id }, { $set: { role: 'admin' } });
      return res.json({
        ok: true,
        created: false,
        message: 'Un utilisateur existant a été promu admin.',
      });
    }

    const hash = await bcrypt.hash(plain, 10);

    const admin = await User.create({
      email,
      password: hash,
      role: 'admin',
      // Si tu veux stocker le nom, ajoute un champ "name" dans le schema User
      // name,
    });

    return res.json({
      ok: true,
      created: true,
      admin: { id: admin._id, email: admin.email, role: admin.role },
      hint: 'Admin de base créé. Pense à changer le mot de passe rapidement.',
    });
  } catch (e) {
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({ ok: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

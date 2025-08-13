// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Crée un compte admin si aucun n'existe.
 * - Utilise les variables d'env ADMIN_EMAIL / ADMIN_PASSWORD si présentes
 *   sinon des valeurs par défaut.
 * - NE LOGUE JAMAIS le mot de passe en clair en prod.
 */
router.get('/setup-admin', async (req, res) => {
  try {
    const count = await Admin.countDocuments();
    if (count > 0) {
      return res.json({ ok: true, created: false, message: 'Un admin existe déjà.' });
    }

    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';
    const name  = process.env.ADMIN_NAME || 'Administrateur';

    const hash = await bcrypt.hash(plain, 10);

    const admin = await Admin.create({
      name,
      email,
      password: hash,
      role: 'admin',
    });

    return res.json({
      ok: true,
      created: true,
      admin: { id: admin._id, email: admin.email, name: admin.name },
      // ⚠️ Ne renvoie pas le mot de passe hashé ni le clair en prod
      hint: 'Admin de base créé. Change le mot de passe rapidement.',
    });
  } catch (e) {
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({ ok: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

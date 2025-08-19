// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Crée/assure un compte admin dans User, et (si modèle présent) dans Admin.
 * - Utilise ADMIN_EMAIL / ADMIN_PASSWORD si définis, sinon valeurs par défaut.
 */
router.get('/setup-admin', async (req, res) => {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';

    const hash = await bcrypt.hash(plain, 10);

    // 1) User
    let user = await User.findOne({ email }).select('+password');
    if (!user) {
      user = await User.create({ email, password: hash, role: 'admin' });
    } else {
      // s’assure du rôle
      if (user.role !== 'admin') {
        user.role = 'admin';
        await user.save();
      }
    }

    // 2) Admin (si modèle disponible)
    let admin = null;
    if (Admin) {
      admin = await Admin.findOne({ email }).select('+password');
      if (!admin) {
        admin = await Admin.create({ name: 'Administrateur', email, password: hash, role: 'admin' });
      } else {
        if (admin.role !== 'admin') {
          admin.role = 'admin';
          await admin.save();
        }
      }
    }

    return res.json({
      ok: true,
      ensured: {
        user: { id: user._id, email: user.email, role: user.role },
        admin: admin ? { id: admin._id, email: admin.email, role: admin.role } : null
      },
      hint: 'Connecte-toi avec ADMIN_EMAIL/ADMIN_PASSWORD puis change le mot de passe.'
    });
  } catch (e) {
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({ ok: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

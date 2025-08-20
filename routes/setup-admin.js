// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Crée/assure un superadmin par défaut (ou admin selon vars env).
 * Vars: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_COMMUNE_ID, ADMIN_COMMUNE
 */
router.get('/setup-admin', async (_req, res) => {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';
    const name = process.env.ADMIN_NAME || 'Super Admin';
    const communeId = process.env.ADMIN_COMMUNE_ID || '';
    const communeName = process.env.ADMIN_COMMUNE || '';

    // Superadmin de démarrage
    let user = await User.findOne({ email }).select('_id email role');
    if (!user) {
      const hash = await bcrypt.hash(plain, 10);
      user = await User.create({
        email,
        password: hash,
        role: 'superadmin',
        name,
        communeId,
        communeName,
      });
    } else if (user.role !== 'superadmin') {
      user.role = 'superadmin';
      await user.save();
    }

    // miroir dans Admin si modèle présent
    let admin = null;
    if (Admin) {
      admin = await Admin.findOne({ email }).select('_id email role');
      if (!admin) {
        const hash = await bcrypt.hash(plain, 10);
        admin = await Admin.create({
          email,
          password: hash,
          role: 'superadmin',
          name,
          communeId,
          communeName,
        });
      } else if (admin.role !== 'superadmin') {
        admin.role = 'superadmin';
        await admin.save();
      }
    }

    return res.json({
      ok: true,
      ensured: {
        user: user ? { id: user._id, email: user.email, role: user.role } : null,
        admin: admin ? { id: admin._id, email: admin.email, role: admin.role } : null,
      },
      hint: 'Superadmin prêt. Utilise /api/admins (superadmin) pour gérer les admins de communes.',
    });
  } catch (e) {
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({ ok: false, message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

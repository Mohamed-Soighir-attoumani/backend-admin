// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Assure l’existence d’un superadmin (via SUPERADMIN_EMAIL/PASSWORD) + d’un admin “classique” (via ADMIN_EMAIL/PASSWORD) si tu veux.
 * - Ne remplace JAMAIS un mot de passe existant.
 */
router.get('/setup-admin', async (req, res) => {
  try {
    // --- SUPERADMIN ---
    const superEmail = process.env.SUPERADMIN_EMAIL || 'superadmin@mairie.fr';
    const superPlain = process.env.SUPERADMIN_PASSWORD || 'ChangeMoi!2025';

    let superU = await User.findOne({ email: superEmail }).select('_id email role');
    if (!superU) {
      const hash = await bcrypt.hash(superPlain, 10);
      await User.updateOne(
        { email: superEmail },
        { $setOnInsert: { email: superEmail, password: hash, role: 'superadmin', name: 'Super Admin' } },
        { upsert: true }
      );
      superU = await User.findOne({ email: superEmail }).select('_id email role');
    } else if (superU.role !== 'superadmin') {
      superU.role = 'superadmin';
      await superU.save();
    }

    // --- (Optionnel) ADMIN de base ---
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const adminPlain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';

    let adminU = await User.findOne({ email: adminEmail }).select('_id email role');
    if (!adminU) {
      const hash = await bcrypt.hash(adminPlain, 10);
      await User.updateOne(
        { email: adminEmail },
        { $setOnInsert: { email: adminEmail, password: hash, role: 'admin', name: 'Administrateur' } },
        { upsert: true }
      );
      adminU = await User.findOne({ email: adminEmail }).select('_id email role');
    } else if (adminU.role !== 'admin') {
      adminU.role = 'admin';
      await adminU.save();
    }

    return res.json({
      ok: true,
      ensured: {
        superadmin: superU ? { id: superU._id, email: superU.email, role: superU.role } : null,
        admin: adminU ? { id: adminU._id, email: adminU.email, role: adminU.role } : null,
      },
      hint: 'Connecte-toi avec SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD pour voir le menu superadmin.',
    });
  } catch (e) {
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({
      ok: false,
      name: e.name,
      code: e.code || null,
      message: e.message,
    });
  }
});

module.exports = router;

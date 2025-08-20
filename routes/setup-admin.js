// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Assure un admin (User) et (si modèle présent) un Admin.
 * - N’écrase pas un mot de passe existant.
 * - Remplit éventuellement name/communeName via ADMIN_NAME / ADMIN_COMMUNE.
 */
router.get('/setup-admin', async (_req, res) => {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';
    const adminName = process.env.ADMIN_NAME || 'Administrateur';
    const adminCommune = process.env.ADMIN_COMMUNE || '';

    // USER
    let user = await User.findOne({ email }).select('_id email role name communeName');
    if (!user) {
      const hash = await bcrypt.hash(plain, 10);
      await User.updateOne(
        { email },
        { $setOnInsert: { email, password: hash, role: 'admin', name: adminName, communeName: adminCommune } },
        { upsert: true }
      );
      user = await User.findOne({ email }).select('_id email role name communeName');
    } else {
      let changed = false;
      if (user.role !== 'admin') { user.role = 'admin'; changed = true; }
      if (!user.name && adminName) { user.name = adminName; changed = true; }
      if (!user.communeName && adminCommune) { user.communeName = adminCommune; changed = true; }
      if (changed) await user.save();
    }

    // ADMIN (si présent)
    let admin = null;
    if (Admin) {
      admin = await Admin.findOne({ email }).select('_id email role name communeName');
      if (!admin) {
        const hash = await bcrypt.hash(plain, 10);
        await Admin.updateOne(
          { email },
          { $setOnInsert: { name: adminName, email, password: hash, role: 'admin', communeName: adminCommune } },
          { upsert: true }
        );
        admin = await Admin.findOne({ email }).select('_id email role name communeName');
      } else {
        let changed = false;
        if (admin.role !== 'admin') { admin.role = 'admin'; changed = true; }
        if (!admin.name && adminName) { admin.name = adminName; changed = true; }
        if (!admin.communeName && adminCommune) { admin.communeName = adminCommune; changed = true; }
        if (changed) await admin.save();
      }
    }

    return res.json({
      ok: true,
      email,
      ensured: {
        user: user ? { id: user._id, email: user.email, role: user.role, name: user.name || '', communeName: user.communeName || '' } : null,
        admin: admin ? { id: admin._id, email: admin.email, role: admin.role, name: admin.name || '', communeName: admin.communeName || '' } : null,
      },
      hint: 'Connecte-toi avec ADMIN_EMAIL/ADMIN_PASSWORD puis change le mot de passe.',
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

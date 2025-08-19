// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Assure un admin dans User ET (si modèle présent) dans Admin (upsert, sans écraser un mot de passe existant).
 * - En cas d'erreur, renvoie name/code/message (sans secrets) pour diagnostic.
 */
router.get('/setup-admin', async (req, res) => {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';

    // USER
    let user = await User.findOne({ email }).select('_id email role');
    if (!user) {
      const hash = await bcrypt.hash(plain, 10);
      await User.updateOne(
        { email },
        { $setOnInsert: { email, password: hash, role: 'admin' } },
        { upsert: true }
      );
      user = await User.findOne({ email }).select('_id email role');
    } else if (user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    // ADMIN (si modèle existant)
    let admin = null;
    if (Admin) {
      admin = await Admin.findOne({ email }).select('_id email role');
      if (!admin) {
        const hash = await bcrypt.hash(plain, 10);
        await Admin.updateOne(
          { email },
          { $setOnInsert: { name: 'Administrateur', email, password: hash, role: 'admin' } },
          { upsert: true }
        );
        admin = await Admin.findOne({ email }).select('_id email role');
      } else if (admin.role !== 'admin') {
        admin.role = 'admin';
        await admin.save();
      }
    }

    return res.json({
      ok: true,
      email,
      ensured: {
        user: user ? { id: user._id, email: user.email, role: user.role } : null,
        admin: admin ? { id: admin._id, email: admin.email, role: admin.role } : null,
      },
      hint: 'Connecte-toi avec ADMIN_EMAIL/ADMIN_PASSWORD puis change le mot de passe.',
    });
  } catch (e) {
    // 🔍 DIAGNOSTIC détaillé côté client (safe)
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({
      ok: false,
      name: e.name,
      code: e.code || null,
      message: e.message,
      // stack non renvoyée côté client pour éviter d'exposer des chemins
    });
  }
});

module.exports = router;

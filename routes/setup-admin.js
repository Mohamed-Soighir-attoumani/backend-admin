// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

/**
 * GET /api/setup-admin
 * - Assure la présence d'un admin dans User ET (si modèle présent) dans Admin.
 * - Utilise ADMIN_EMAIL / ADMIN_PASSWORD si fournis, sinon valeurs par défaut.
 * - N'écrase pas un mot de passe existant.
 */
router.get('/setup-admin', async (req, res) => {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
    const plain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';

    // 1) USER: upsert sans écraser le password existant
    //    - si l'utilisateur n'existe pas, on insère avec le hash
    //    - s'il existe, on ne change rien ici (pas d'overwrite password)
    const userExists = await User.findOne({ email }).select('_id email role');
    let ensuredUser;

    if (!userExists) {
      const hash = await bcrypt.hash(plain, 10);
      await User.updateOne(
        { email },
        { $setOnInsert: { email, password: hash, role: 'admin' } },
        { upsert: true }
      );
      ensuredUser = await User.findOne({ email }).select('_id email role');
    } else {
      // s'assure du rôle admin
      if (userExists.role !== 'admin') {
        userExists.role = 'admin';
        await userExists.save();
      }
      ensuredUser = userExists;
    }

    // 2) ADMIN (optionnel): même logique si le modèle est présent
    let ensuredAdmin = null;
    if (Admin) {
      const adminExists = await Admin.findOne({ email }).select('_id email role');
      if (!adminExists) {
        const hash = await bcrypt.hash(plain, 10);
        await Admin.updateOne(
          { email },
          { $setOnInsert: { name: 'Administrateur', email, password: hash, role: 'admin' } },
          { upsert: true }
        );
        ensuredAdmin = await Admin.findOne({ email }).select('_id email role');
      } else {
        if (adminExists.role !== 'admin') {
          adminExists.role = 'admin';
          await adminExists.save();
        }
        ensuredAdmin = adminExists;
      }
    }

    return res.json({
      ok: true,
      email,
      ensured: {
        user: ensuredUser ? { id: ensuredUser._id, email: ensuredUser.email, role: ensuredUser.role } : null,
        admin: ensuredAdmin ? { id: ensuredAdmin._id, email: ensuredAdmin.email, role: ensuredAdmin.role } : null,
      },
      hint: 'Connecte-toi avec ADMIN_EMAIL/ADMIN_PASSWORD puis change le mot de passe.'
    });
  } catch (e) {
    // Log côté serveur pour voir la vraie cause dans Render → Logs
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({ ok: false, message: 'Erreur serveur (voir logs Render pour la stack exacte)' });
  }
});

module.exports = router;

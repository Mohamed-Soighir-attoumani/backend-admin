// backend/routes/changePassword.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');

let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

// --------- Aide CORS + Ping ----------
router.options('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  return res.sendStatus(204);
});

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    route: '/api/change-password',
    howTo: 'POST /api/change-password avec Authorization: Bearer <token> et body { oldPassword, newPassword }'
  });
});

// ---------- DEBUG: qui suis-je ? ----------
router.get('/whoami', auth, (req, res) => {
  // Te permet de vérifier ce que contient le token côté serveur
  return res.json({ userFromToken: req.user });
});

// ---------- Changement de mot de passe ----------
router.post('/', auth, async (req, res) => {
  const fail = (code, message, http = 400, extra = {}) =>
    res.status(http).json({ ok: false, code, message, ...extra });

  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return fail('E_MISSING_FIELDS', 'Champs requis manquants: oldPassword, newPassword');
    }

    const u = req.user || {}; // { id, email, role, ... }
    let doc = null;
    let source = null;

    // 1) by id
    if (u.id && isValidObjectId(u.id)) {
      doc = await User.findById(u.id).select('+password email role');
      source = doc ? 'User' : source;
      if (!doc && Admin) {
        doc = await Admin.findById(u.id).select('+password email role');
        source = doc ? 'Admin' : source;
      }
    }
    // 2) fallback by email
    if (!doc && u.email) {
      doc = await User.findOne({ email: u.email }).select('+password email role');
      source = doc ? 'User' : source;
      if (!doc && Admin) {
        doc = await Admin.findOne({ email: u.email }).select('+password email role');
        source = doc ? 'Admin' : source;
      }
    }

    if (!doc) {
      // On renvoie aussi ce qu'il y a dans le token pour t'aider à diagnostiquer
      return fail('E_USER_NOT_FOUND', 'Utilisateur non trouvé', 404, { tokenUser: u });
    }

    if (!doc.password) {
      // Cas rare: le champ password n'a pas été sélectionné
      return fail('E_NO_PASSWORD_SELECTED', 'Mot de passe non sélectionné depuis la base', 500, { source });
    }

    const ok = await bcrypt.compare(oldPassword, doc.password);
    if (!ok) {
      return fail('E_OLD_PASSWORD', 'Ancien mot de passe incorrect', 400, { source });
    }

    doc.password = await bcrypt.hash(newPassword, 10);
    await doc.save();

    return res.json({ ok: true, message: 'Mot de passe mis à jour avec succès', source });
  } catch (e) {
    console.error('❌ POST /change-password failed:', e);
    return res.status(500).json({
      ok: false,
      code: 'E_INTERNAL',
      message: 'Erreur interne du serveur',
    });
  }
});

module.exports = router;

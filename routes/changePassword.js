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

// ====== CORS + Ping ======
router.options('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Requested-With');
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

// ====== DEBUG : qui suis-je ? ======
router.get('/whoami', auth, (req, res) => {
  return res.json({ userFromToken: req.user });
});

// ====== DEBUG : que voit-on en base ? ======
router.get('/debug', auth, async (req, res) => {
  try {
    const u = req.user || {};
    let doc = null;
    let source = null;

    if (u.id && isValidObjectId(u.id)) {
      doc = await User.findById(u.id).select('+password email role');
      source = doc ? 'User' : source;
      if (!doc && Admin) {
        doc = await Admin.findById(u.id).select('+password email role');
        source = doc ? 'Admin' : source;
      }
    }
    if (!doc && u.email) {
      doc = await User.findOne({ email: u.email }).select('+password email role');
      source = doc ? 'User' : source;
      if (!doc && Admin) {
        doc = await Admin.findOne({ email: u.email }).select('+password email role');
        source = doc ? 'Admin' : source;
      }
    }

    if (!doc) {
      return res.status(404).json({ ok:false, code:'E_USER_NOT_FOUND', message:'Utilisateur non trouvé', tokenUser: u });
    }

    return res.json({
      ok: true,
      source,
      user: { id: doc._id, email: doc.email, role: doc.role },
      hasPassword: !!doc.password,
      passwordType: typeof doc.password,
      passwordPreview: typeof doc.password === 'string' ? (doc.password.slice(0, 12) + '…') : null
    });
  } catch (e) {
    console.error('❌ GET /change-password/debug:', e);
    return res.status(500).json({ ok:false, code:'E_INTERNAL', message:'Erreur interne du serveur' });
  }
});

// ====== Changement de mot de passe (robuste & verbeux) ======
router.post('/', auth, async (req, res) => {
  const fail = (code, message, http = 400, extra = {}) =>
    res.status(http).json({ ok: false, code, message, ...extra });

  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return fail('E_MISSING_FIELDS', 'Champs requis manquants: oldPassword, newPassword');
    }

    const u = req.user || {}; // { id, email, role, src, ... }
    let doc = null;
    let source = null;

    // 1) recherche par id
    if (u.id && isValidObjectId(u.id)) {
      try {
        doc = await User.findById(u.id).select('+password email role');
        source = doc ? 'User' : source;
        if (!doc && Admin) {
          doc = await Admin.findById(u.id).select('+password email role');
          source = doc ? 'Admin' : source;
        }
      } catch (e) {
        console.error('🔎 findById error:', e);
        return fail('E_DB_FIND_BY_ID', 'Erreur de lecture (findById)', 500);
      }
    }

    // 2) fallback par email
    if (!doc && u.email) {
      try {
        doc = await User.findOne({ email: u.email }).select('+password email role');
        source = doc ? 'User' : source;
        if (!doc && Admin) {
          doc = await Admin.findOne({ email: u.email }).select('+password email role');
          source = doc ? 'Admin' : source;
        }
      } catch (e) {
        console.error('🔎 findOne error:', e);
        return fail('E_DB_FIND_ONE', 'Erreur de lecture (findOne)', 500);
      }
    }

    if (!doc) {
      console.error('⛔ Utilisateur introuvable pour token:', u);
      return fail('E_USER_NOT_FOUND', 'Utilisateur non trouvé', 404, { tokenUser: u });
    }

    if (typeof doc.password !== 'string' || !doc.password.length) {
      console.error('⛔ password manquant/invalid', { source, typeofPassword: typeof doc.password });
      return fail('E_NO_PASSWORD_SELECTED', 'Mot de passe non sélectionné depuis la base', 500, { source });
    }

    let ok = false;
    try {
      ok = await bcrypt.compare(oldPassword, doc.password);
    } catch (e) {
      console.error('⛔ bcrypt.compare error:', e);
      return fail('E_BCRYPT_COMPARE', 'Erreur comparaison de mot de passe', 500, { source });
    }
    if (!ok) return fail('E_OLD_PASSWORD', 'Ancien mot de passe incorrect', 400, { source });

    try {
      doc.password = await bcrypt.hash(newPassword, 10);
      await doc.save();
    } catch (e) {
      console.error('⛔ save error:', e);
      return fail('E_SAVE', 'Erreur lors de la sauvegarde du nouveau mot de passe', 500, { source });
    }

    return res.json({ ok: true, message: 'Mot de passe mis à jour avec succès', source });
  } catch (e) {
    console.error('❌ POST /change-password failed:', e);
    return res.status(500).json({ ok: false, code: 'E_INTERNAL', message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

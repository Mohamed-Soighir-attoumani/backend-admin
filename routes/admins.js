// backend/routes/admins.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

/* IMPORTANT : même secret que /routes/auth.js et /middleware/authMiddleware.js */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

/* ===== Helpers communs ===== */
const isValidHex24 = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
const decode = (v) => {
  try {
    return decodeURIComponent(String(v));
  } catch {
    return String(v || '');
  }
};
const norm = (v) => String(v || '').trim().toLowerCase();
const pickHexFromAny = (v) => {
  if (!v) return '';
  if (typeof v === 'object') {
    if (v.$oid && isValidHex24(v.$oid)) return v.$oid;
    try {
      const m = JSON.stringify(v).match(/[a-f0-9]{24}/i);
      if (m && isValidHex24(m[0])) return m[0];
    } catch {}
  }
  const s = String(v);
  const m = s.match(/[a-f0-9]{24}/i);
  return m && isValidHex24(m[0]) ? m[0] : '';
};

async function findUserByAnyId(primary, body = {}, query = {}) {
  const candidatesRaw = [
    primary,
    body && body.id,
    body && body.userId,
    body && body.email,
    query && query.id,
    query && query.userId,
    query && query.email,
  ].filter((x) => x !== undefined && x !== null);

  const candidates = candidatesRaw
    .map((x) => (typeof x === 'string' ? x.trim() : x))
    .filter(Boolean);

  for (const raw of candidates) {
    const maybeEmail = typeof raw === 'string' && raw.includes('@');
    const hex = pickHexFromAny(raw);

    // 1) par ObjectId
    if (hex) {
      const byId = await User.findById(hex);
      if (byId) return byId;
    }
    // 2) par email
    if (maybeEmail) {
      const byEmail = await User.findOne({ email: norm(raw) });
      if (byEmail) return byEmail;
    }
    // 3) par userId custom
    const rawStr = decode(raw).trim();
    if (rawStr) {
      const byUserId = await User.findOne({ userId: rawStr });
      if (byUserId) return byUserId;
    }
  }
  return null;
}

/* ====== Toutes ces routes nécessitent le superadmin ====== */
router.use(auth, requireRole('superadmin'));

/**
 * POST /api/admins
 * Création d’un administrateur (équivalent à POST /api/users, mais supporte les UIs qui visent /api/admins)
 */
router.post('/', async (req, res) => {
  try {
    let { email, password, name, communeId, communeName } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email et mot de passe requis' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email déjà utilisé' });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      password: passwordHash,
      name: name || '',
      role: 'admin',
      communeId: communeId || '',
      communeName: communeName || '',
      createdBy: String(req.user.id),
      isActive: true,
      subscriptionStatus: 'none',
      subscriptionEndAt: null,
    });

    const plain = doc.toObject();
    plain._idString = String(doc._id);

    res.status(201).json(plain);
  } catch (err) {
    console.error('❌ POST /api/admins', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * POST /api/admins/:id/reset-password
 * Body: { newPassword } (alias: { password })
 * Incrémente tokenVersion pour invalider les anciens tokens de cet admin.
 */
router.post('/:id/reset-password', async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') {
      return res
        .status(400)
        .json({ message: 'Seuls les comptes admin sont réinitialisables ici' });
    }

    const newPassword = String(
      req.body?.newPassword || req.body?.password || ''
    ).trim();

    if (!newPassword || newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: 'Nouveau mot de passe requis (min 8 caractères)' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1; // ✅ invalider tous les anciens tokens
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ POST /api/admins/:id/reset-password', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * DELETE /api/admins/:id
 * Supprime un administrateur (interdit de supprimer un superadmin ou toi-même).
 */
router.delete('/:id', async (req, res) => {
  try {
    const target = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!target) return res.status(404).json({ message: 'Utilisateur introuvable' });

    if (target.role !== 'admin') {
      return res
        .status(400)
        .json({ message: "Suppression refusée (rôle non 'admin')" });
    }
    if (String(target._id) === String(req.user.id)) {
      return res
        .status(400)
        .json({ message: 'Tu ne peux pas te supprimer toi-même' });
    }

    await User.deleteOne({ _id: target._id });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/admins/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * POST /api/admins/:id/impersonate
 * Génère un token de connexion en tant que l’admin ciblé (impersonation).
 * Token signé avec le même JWT_SECRET, mais flaggé { impersonated: true, origUserId: superadminId }.
 */
router.post('/:id/impersonate', async (req, res) => {
  try {
    const target = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!target) return res.status(404).json({ message: 'Utilisateur introuvable' });

    if (target.role !== 'admin')
      return res
        .status(400)
        .json({ message: "Impersonation possible uniquement sur un 'admin'" });

    if (target.isActive === false)
      return res.status(400).json({ message: 'Compte admin désactivé' });

    const payload = {
      id: String(target._id),
      email: target.email,
      role: target.role || 'admin',
      tv: typeof target.tokenVersion === 'number' ? target.tokenVersion : 0,
      impersonated: true,
      origUserId: String(req.user.id),
    };

    // Durée volontairement plus courte pour l’impersonation
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

    res.json({
      token,
      user: {
        id: String(target._id),
        email: target.email,
        name: target.name || '',
        role: target.role || 'admin',
        communeId: target.communeId || '',
        communeName: target.communeName || '',
        photo: target.photo || '',
      },
    });
  } catch (err) {
    console.error('❌ POST /api/admins/:id/impersonate', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

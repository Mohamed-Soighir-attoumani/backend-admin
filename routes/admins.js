// backend/routes/admins.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const router = express.Router();

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const isValidHex24 = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
const norm = (v) => String(v || '').trim().toLowerCase();
const decode = (v) => { try { return decodeURIComponent(String(v)); } catch { return String(v || ''); } };
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

    if (hex) {
      const byId = await User.findById(hex);
      if (byId) return byId;
    }
    if (maybeEmail) {
      const byEmail = await User.findOne({ email: norm(raw) });
      if (byEmail) return byEmail;
    }
    const rawStr = decode(raw).trim();
    if (rawStr) {
      const byUserId = await User.findOne({ userId: rawStr });
      if (byUserId) return byUserId;
    }
  }
  return null;
}

/* ========= ALIAS CREATION (POST /api/admins) =========
   Laisse /api/users gérer la création, mais on garde cet alias si ton front l’utilise.
*/
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { email, password, name, communeId, communeName, createdBy } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email déjà utilisé' });

    const hash = await bcrypt.hash(String(password), 10);
    const doc = await User.create({
      email,
      password: hash,
      name: name || '',
      role: 'admin',
      communeId: communeId || '',
      communeName: communeName || '',
      createdBy: createdBy ? String(createdBy) : '',
      isActive: true,
      subscriptionStatus: 'none',
      subscriptionEndAt: null,
    });

    res.status(201).json({ ...doc.toObject(), _idString: String(doc._id) });
  } catch (err) {
    console.error('❌ POST /api/admins', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ========= RESET PASSWORD ========= */
router.post('/:id/reset-password', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les administrateurs peuvent être traités ici' });
    }

    const { newPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ message: 'Nouveau mot de passe invalide (min 6 caractères)' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    user.password = hash;
    // Invalidation des sessions existantes
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.json({ ok: true, message: 'Mot de passe réinitialisé' });
  } catch (err) {
    console.error('❌ POST /api/admins/:id/reset-password', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ========= IMPERSONATE ========= */
router.post('/:id/impersonate', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const target = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!target) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (target.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les administrateurs peuvent être utilisés' });
    }
    if (target.isActive === false) {
      return res.status(403).json({ message: 'Compte administrateur désactivé' });
    }

    const payload = {
      id: String(target._id),
      email: target.email,
      role: target.role || 'admin',
      tv: typeof target.tokenVersion === 'number' ? target.tokenVersion : 0,
      impersonated: true,
      origUserId: req.user?.id || null,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

    return res.json({
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

/* ========= DELETE ADMIN ========= */
router.delete('/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les administrateurs peuvent être supprimés ici' });
    }
    await User.deleteOne({ _id: user._id });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/admins/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

/* Config JWT (même secret que routes/auth.js) */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const TOKEN_EXPIRES_IN = '7d';

/* Utils */
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

/** Résout un utilisateur */
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

/* ===================== LISTE ADMINS ===================== */
router.get('/admins', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const {
      q = '',
      communeId = '',
      status = '',
      sub = '',
      page = 1,
      pageSize = 15,
    } = req.query;

    const find = { role: 'admin' };

    if (q) {
      const rx = new RegExp(q, 'i');
      find.$or = [{ email: rx }, { name: rx }];
    }
    if (communeId) find.communeId = communeId;

    if (status === 'active')   find.isActive = { $ne: false };
    if (status === 'inactive') find.isActive = false;

    if (sub === 'none') {
      find.$or = [
        ...(find.$or || []),
        { subscriptionStatus: { $exists: false } },
        { subscriptionStatus: 'none' },
      ];
    }
    if (sub === 'active')  find.subscriptionStatus = 'active';
    if (sub === 'expired') find.subscriptionStatus = 'expired';

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));

    let items = await User.find(find)
      .sort({ createdAt: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .lean();

    items = items.map(u => ({
      ...u,
      _idString: (u._id && String(u._id)) || '',
    }));

    const total = await User.countDocuments(find);

    res.json({ items, total });
  } catch (err) {
    console.error('❌ GET /api/admins', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== LISTE /api/users (fallback) ===================== */
router.get('/users', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const {
      q = '',
      communeId = '',
      role = '',
      status = '',
      sub = '',
      page = 1,
      pageSize = 15,
    } = req.query;

    const find = {};
    if (role) find.role = role;

    if (q) {
      const rx = new RegExp(q, 'i');
      find.$or = [{ email: rx }, { name: rx }];
    }
    if (communeId) find.communeId = communeId;

    if (status === 'active')   find.isActive = { $ne: false };
    if (status === 'inactive') find.isActive = false;

    if (sub === 'none') {
      find.$or = [
        ...(find.$or || []),
        { subscriptionStatus: { $exists: false } },
        { subscriptionStatus: 'none' },
      ];
    }
    if (sub === 'active')  find.subscriptionStatus = 'active';
    if (sub === 'expired') find.subscriptionStatus = 'expired';

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));

    let items = await User.find(find)
      .sort({ createdAt: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .lean();

    items = items.map(u => ({
      ...u,
      _idString: (u._id && String(u._id)) || '',
    }));

    const total = await User.countDocuments(find);

    res.json({ items, total });
  } catch (err) {
    console.error('❌ GET /api/users', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== CRÉATION ADMIN ===================== */
router.post('/users', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { email, password, name, communeId, communeName, role, createdBy } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }
    role = 'admin';

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email déjà utilisé' });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      password: passwordHash,
      name: name || '',
      role,
      communeId: communeId || '',
      communeName: communeName || '',
      createdBy: createdBy ? String(createdBy) : '',
      isActive: true,
      subscriptionStatus: 'none',
      subscriptionEndAt: null,
      subscriptionPrice: 0,
      subscriptionCurrency: 'EUR',
      subscriptionMethod: '',
    });

    const plain = doc.toObject();
    plain._idString = String(doc._id);

    res.status(201).json(plain);
  } catch (err) {
    console.error('❌ POST /api/users', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== MISE À JOUR ADMIN ===================== */
router.put('/users/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les admins sont éditables ici' });
    }

    const payload = {};
    if (typeof req.body.email === 'string') payload.email = norm(req.body.email);
    if (typeof req.body.name === 'string')  payload.name = req.body.name;
    if (typeof req.body.communeId === 'string')   payload.communeId = req.body.communeId;
    if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;
    if (typeof req.body.isActive === 'boolean')   payload.isActive = req.body.isActive;

    if (req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'Changement de rôle interdit ici' });
    }

    const updated = await User.findByIdAndUpdate(user._id, { $set: payload }, { new: true });
    res.json({ ...updated.toObject(), _idString: String(updated._id) });
  } catch (err) {
    console.error('❌ PUT /api/users/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== TOGGLE ACTIVE ===================== */
router.post('/users/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const next = !!req.body.active;
    user.isActive = next;
    await user.save();

    res.json({ ok: true, user: { ...user.toObject(), _idString: String(user._id) } });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (utilise le montant saisi) ===================== */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.query, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const invoices = [];
    if (user.subscriptionStatus === 'active') {
      invoices.push({
        id: `INV-${String(user._id).slice(-6)}`,
        number: `INV-${new Date().getFullYear()}-${String(user._id).slice(-4)}`,
        amount: typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0,
        currency: user.subscriptionCurrency || 'EUR',
        status: 'paid',
        date: new Date(),
        url: 'https://example.com/invoice.pdf',
      });
    }

    res.json({ invoices });
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== Impersonate / Reset PW / Delete ===================== */
router.post('/users/:id/impersonate', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const target = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!target) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (target.role === 'superadmin') return res.status(403).json({ message: 'Impersonation superadmin interdite' });
    if (target.isActive === false)    return res.status(403).json({ message: 'Compte désactivé' });

    const payload = {
      id: String(target._id),
      email: target.email,
      role: target.role || 'user',
      tv: typeof target.tokenVersion === 'number' ? target.tokenVersion : 0,
      impersonated: true,
      origUserId: String(req.user.id),
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });

    return res.json({
      token,
      user: {
        id: String(target._id),
        email: target.email,
        name: target.name || '',
        role: target.role || 'user',
        communeId: target.communeId || '',
        communeName: target.communeName || '',
        photo: target.photo || '',
      },
    });
  } catch (err) {
    console.error('❌ POST /impersonate', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.post('/users/:id/reset-password', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') return res.status(400).json({ message: 'Seuls les admins sont gérés ici' });

    const newPassword = String(req.body?.newPassword || req.body?.password || '').trim();
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Nouveau mot de passe requis (min 6 caractères)' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await User.updateOne(
      { _id: user._id },
      { $set: { password: hash }, $inc: { tokenVersion: 1 } }
    );

    return res.json({ ok: true, message: 'Mot de passe mis à jour' });
  } catch (err) {
    console.error('❌ POST reset-password', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.delete('/users/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') return res.status(400).json({ message: 'Seuls les admins sont supprimables ici' });

    await User.deleteOne({ _id: user._id });
    return res.json({ ok: true, message: 'Compte administrateur supprimé' });
  } catch (err) {
    console.error('❌ DELETE admin', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== ALIAS "admins" ===================== */
router.post('/admins',                     auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:'/users' }, res, next));
router.put('/admins/:id',                  auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:`/users/${req.params.id}` }, res, next));
router.post('/admins/:id/toggle-active',   auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:`/users/${req.params.id}/toggle-active` }, res, next));
router.get('/admins/:id/invoices',         auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:`/users/${req.params.id}/invoices` }, res, next));
router.post('/admins/:id/impersonate',     auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:`/users/${req.params.id}/impersonate` }, res, next));
router.post('/admins/:id/reset-password',  auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:`/users/${req.params.id}/reset-password` }, res, next));
router.delete('/admins/:id',               auth, requireRole('superadmin'), (req,res,next)=>router.handle({ ...req, url:`/users/${req.params.id}` }, res, next));

module.exports = router;

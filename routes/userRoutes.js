// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

/* Utils */
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * Résout un utilisateur à partir de: id/email/userId
 */
async function findUserByAnyId(primary, body = {}) {
  const candidates = [
    String(primary || '').trim(),
    String(body.id || '').trim(),
    norm(body.email || ''),
  ].filter(Boolean);

  for (const raw of candidates) {
    if (!raw) continue;

    if (isValidId(raw)) {
      const hit = await User.findById(raw);
      if (hit) return hit;
    }

    const m = raw.match(/[a-f0-9]{24}/i);
    if (m && isValidId(m[0])) {
      const byHex = await User.findById(m[0]);
      if (byHex) return byHex;
    }

    if (raw.includes('@')) {
      const byEmail = await User.findOne({ email: norm(raw) });
      if (byEmail) return byEmail;
    }

    const byUserId = await User.findOne({ userId: raw });
    if (byUserId) return byUserId;
  }

  return null;
}

/* ===================== LISTE ADMINS ===================== */
router.get('/admins', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { q = '', communeId = '', status = '', sub = '', page = 1, pageSize = 15 } = req.query;

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

    items = items.map(u => ({ ...u, _idString: String(u._id) }));
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
    const { q = '', communeId = '', role = '', status = '', sub = '', page = 1, pageSize = 15 } = req.query;

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

    items = items.map(u => ({ ...u, _idString: String(u._id) }));
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
    let { email, password, name, communeId, communeName, role } = req.body || {};
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
      passwordHash,
      name: name || '',
      role,
      communeId: communeId || '',
      communeName: communeName || '',
      isActive: true,
      subscriptionStatus: 'none',
      subscriptionEndAt: null,
      createdBy: req.user?.id || '',
    });

    res.status(201).json(doc.toJSON());
  } catch (err) {
    console.error('❌ POST /api/users', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== MISE À JOUR ADMIN ===================== */
router.put('/users/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body);
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
    res.json(updated.toJSON());
  } catch (err) {
    console.error('❌ PUT /api/users/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== TOGGLE ACTIVE ===================== */
router.post('/users/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const next = !!req.body.active;
    user.isActive = next;
    await user.save();

    res.json({ ok: true, user: user.toJSON() });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (self + superadmin) ===================== */
// 👉 superadmin peut voir toutes les factures,
// 👉 un admin peut voir les siennes si :id === req.user.id
router.get('/users/:id/invoices', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const isSelf = String(id) === String(req.user.id);
    const isSuper = req.user.role === 'superadmin';
    if (!isSelf && !isSuper) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const user = await findUserByAnyId(id, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const inv = [{
      id: `INV-${String(user._id).slice(-6)}`,
      number: `INV-${new Date().getFullYear()}-${String(user._id).slice(-4)}`,
      amount: user.subscriptionStatus === 'active' ? 19.90 : 0.00,
      currency: 'EUR',
      status: user.subscriptionStatus === 'active' ? 'paid' : 'unpaid',
      date: new Date(),
      url: 'https://example.com/invoice.pdf'
    }];

    res.json({ invoices: inv });
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== SELF-SERVICE: abonnement & factures ===================== */
// ✅ statut d’abonnement de l’utilisateur connecté
router.get('/me/subscription', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    res.json({
      status: user.subscriptionStatus || 'none',
      endAt: user.subscriptionEndAt || null,
    });
  } catch (err) {
    console.error('❌ GET /api/me/subscription', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ✅ factures de l’utilisateur connecté
router.get('/me/invoices', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const inv = [{
      id: `INV-${String(user._id).slice(-6)}`,
      number: `INV-${new Date().getFullYear()}-${String(user._id).slice(-4)}`,
      amount: user.subscriptionStatus === 'active' ? 19.90 : 0.00,
      currency: 'EUR',
      status: user.subscriptionStatus === 'active' ? 'paid' : 'unpaid',
      date: new Date(),
      url: 'https://example.com/invoice.pdf'
    }];

    res.json({ invoices: inv });
  } catch (err) {
    console.error('❌ GET /api/me/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

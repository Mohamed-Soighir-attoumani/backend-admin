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
 * Résout un utilisateur à partir de plusieurs formes d'ID possibles :
 * - ObjectId (string 24 hex) → findById
 * - email (string) → findOne({ email })
 * - userId personnalisé → findOne({ userId })
 */
async function findUserByAnyId(idLike) {
  const raw = String(idLike || '').trim();

  // Essai direct ObjectId
  if (isValidId(raw)) {
    const byId = await User.findById(raw);
    if (byId) return byId;
  }

  // Essai d’un $oid encapsulé (au cas où)
  const m = raw.match(/[a-f0-9]{24}/i);
  if (m && isValidId(m[0])) {
    const byHex = await User.findById(m[0]);
    if (byHex) return byHex;
  }

  // Essai email
  const maybeEmail = norm(raw);
  if (maybeEmail.includes('@')) {
    const byEmail = await User.findOne({ email: maybeEmail });
    if (byEmail) return byEmail;
  }

  // Essai userId personnalisé
  const byUserId = await User.findOne({ userId: raw });
  if (byUserId) return byUserId;

  return null;
}

/* ===================== LISTE ADMINS ===================== */
/**
 * GET /api/admins
 * Query: q, communeId, status (active|inactive), sub (active|expired|none), page, pageSize
 * Retour: { items: [], total }
 */
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

    // statut actif/inactif
    if (status === 'active')   find.isActive = { $ne: false };
    if (status === 'inactive') find.isActive = false;

    // abonnement (si champs présents)
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

    const [items, total] = await Promise.all([
      User.find(find)
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      User.countDocuments(find),
    ]);

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

    const [items, total] = await Promise.all([
      User.find(find)
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      User.countDocuments(find),
    ]);

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
    // rôle forcé "admin"
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
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /api/users', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== MISE À JOUR ADMIN ===================== */
router.put('/users/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les admins sont éditables ici' });
    }

    const payload = {};
    if (typeof req.body.email === 'string') payload.email = norm(req.body.email);
    if (typeof req.body.name === 'string')  payload.name = req.body.name;
    if (typeof req.body.communeId === 'string')   payload.communeId = req.body.communeId;
    if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;

    // ne pas changer le rôle par cette route
    if (req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'Changement de rôle interdit ici' });
    }

    if (typeof req.body.isActive === 'boolean') payload.isActive = req.body.isActive;

    const updated = await User.findByIdAndUpdate(user._id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PUT /api/users/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== TOGGLE ACTIVE ===================== */
router.post('/users/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const next = !!req.body.active;
    user.isActive = next;
    await user.save();

    res.json({ ok: true, user });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (stub compatible) ===================== */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    // Exemple simple pour que l’UI affiche quelque chose
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

module.exports = router;

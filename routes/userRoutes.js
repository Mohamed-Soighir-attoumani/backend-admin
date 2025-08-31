// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// ⚠️ Adapte le chemin si ton modèle s'appelle autrement
const User = require('../models/User');

/* Utils */
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const norm = (v) => String(v || '').trim().toLowerCase();

/* ===================== LISTE ADMINS (préférée par le front) ===================== */
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

    // abonnement (optionnel si champs présents)
    if (sub === 'none') {
      find.$or = [
        ...(find.$or || []),
        { subscriptionStatus: { $exists: false } },
        { subscriptionStatus: 'none' },
      ];
    }
    if (sub === 'active') find.subscriptionStatus = 'active';
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

/* ===================== LISTE /api/users (fallback du front) ===================== */
/**
 * GET /api/users
 * Même filtres que /api/admins, mais on peut passer role=admin (imposé par ton front)
 */
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
    if (sub === 'active') find.subscriptionStatus = 'active';
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
/**
 * POST /api/users
 * Body: { email, password, name, communeId, communeName, role="admin" }
 * 🔐 superadmin uniquement
 */
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
      // champs d’abonnement optionnels (si tu veux les afficher)
      subscriptionStatus: 'none',
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /api/users', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== MISE À JOUR ADMIN ===================== */
/**
 * PUT /api/users/:id
 * Front l’appelle lors de l’édition.
 * 🔐 superadmin uniquement
 */
router.put('/users/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (user.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les admins sont éditables ici' });
    }

    const payload = {};
    if (typeof req.body.email === 'string') payload.email = norm(req.body.email);
    if (typeof req.body.name === 'string')  payload.name = req.body.name;
    if (typeof req.body.communeId === 'string')   payload.communeId = req.body.communeId;
    if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;

    // sécurité : ne pas permettre de changer le rôle par cette route
    if (req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'Changement de rôle interdit ici' });
    }

    // (optionnel) permettre isActive
    if (typeof req.body.isActive === 'boolean') payload.isActive = req.body.isActive;

    const updated = await User.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PUT /api/users/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== TOGGLE ACTIVE ===================== */
/**
 * POST /api/users/:id/toggle-active  { active: boolean }
 * 🔐 superadmin uniquement
 */
router.post('/users/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const next = !!req.body.active;
    const updated = await User.findByIdAndUpdate(id, { $set: { isActive: next } }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Utilisateur introuvable' });
    res.json({ ok: true, user: updated });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (stub) ===================== */
/**
 * GET /api/users/:id/invoices
 * (stub de compatibilité – renvoie une liste vide)
 */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ message: 'ID invalide' });
  res.json({ invoices: [] });
});

module.exports = router;

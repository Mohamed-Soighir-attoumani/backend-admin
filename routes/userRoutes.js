// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

// Modèle Admin optionnel (si pas présent, on ignore)
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

/* Utils */
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const norm = (v) => String(v || '').trim().toLowerCase();
const decode = (v) => { try { return decodeURIComponent(String(v)); } catch { return String(v); } };

/**
 * 🔍 Résout un compte à partir d’un maximum d’indices (ID/Email/UserId…)
 * Cherche d’abord dans User, puis dans Admin (si existant).
 */
async function findAccountByAnyId(primary, body = {}) {
  const candidates = [
    decode(primary),
    decode(body._id),
    decode(body.id),
    decode(body.userId),
    norm(body.email || ''),
  ].filter(Boolean);

  for (const raw of candidates) {
    const s = String(raw).trim();
    if (!s) continue;

    // 1) ObjectId direct
    if (isValidId(s)) {
      let hit = await User.findById(s);
      if (!hit && Admin) hit = await Admin.findById(s);
      if (hit) return hit;
    }

    // 2) ObjectId caché dans un string (ObjectId("...") | {"$oid":"..."} | texte quelconque)
    const m = s.match(/[a-f0-9]{24}/i);
    if (m && isValidId(m[0])) {
      let hit = await User.findById(m[0]);
      if (!hit && Admin) hit = await Admin.findById(m[0]);
      if (hit) return hit;
    }

    // 3) email
    if (s.includes('@')) {
      let hit = await User.findOne({ email: norm(s) });
      if (!hit && Admin) hit = await Admin.findOne({ email: norm(s) });
      if (hit) return hit;
    }

    // 4) userId custom
    let hit = await User.findOne({ userId: s });
    if (!hit && Admin) hit = await Admin.findOne({ userId: s });
    if (hit) return hit;
  }

  return null;
}

/* ===================== LISTE ADMINS ===================== */
/**
 * GET /api/admins
 * Filtre dans la collection User (rôle admin).
 * (Si tu veux fusionner User + Admin dans la liste, dis-moi et je te pousse une agrégation)
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

    // ✅ standardise un champ _idString pour le front
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
      password: passwordHash, // ✅ correspond au schéma User
      name: name || '',
      role,
      communeId: communeId || '',
      communeName: communeName || '',
      createdBy: createdBy ? String(createdBy) : '',
      isActive: true,
      subscriptionStatus: 'none',
      subscriptionEndAt: null,
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
    const account = await findAccountByAnyId(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (account.role !== 'admin') {
      return res.status(400).json({ message: 'Seuls les admins sont éditables ici' });
    }

    const payload = {};
    if (typeof req.body.email === 'string')       payload.email = norm(req.body.email);
    if (typeof req.body.name === 'string')        payload.name = req.body.name;
    if (typeof req.body.communeId === 'string')   payload.communeId = req.body.communeId;
    if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;
    if (typeof req.body.isActive === 'boolean')   payload.isActive = req.body.isActive;

    if (req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'Changement de rôle interdit ici' });
    }

    // ✅ fonctionne quel que soit le modèle (User ou Admin)
    Object.assign(account, payload);
    const saved = await account.save();

    res.json({ ...saved.toObject(), _idString: String(saved._id) });
  } catch (err) {
    console.error('❌ PUT /api/users/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== TOGGLE ACTIVE ===================== */
router.post('/users/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const account = await findAccountByAnyId(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const next = !!req.body.active;
    account.isActive = next;
    const saved = await account.save();

    res.json({ ok: true, user: { ...saved.toObject(), _idString: String(saved._id) } });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (exemple compatible) ===================== */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const account = await findAccountByAnyId(req.params.id, req.query);
    if (!account) return res.status(404).json({ message: 'Utilisateur introuvable' });

    // Exemple minimal ; remplace-le par ta vraie logique si besoin
    const inv = [{
      id: `INV-${String(account._id).slice(-6)}`,
      number: `INV-${new Date().getFullYear()}-${String(account._id).slice(-4)}`,
      amount: account.subscriptionStatus === 'active' ? 19.90 : 0.00,
      currency: 'EUR',
      status: account.subscriptionStatus === 'active' ? 'paid' : 'unpaid',
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

// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const norm = (v) => String(v || '').trim().toLowerCase();

/** Cherche dans User puis (si dispo) Admin, par id/$oid/24hex/email/userId */
async function findAccount(primary, body = {}) {
  const candidates = [
    String(primary || '').trim(),
    String(body.id || '').trim(),
    norm(body.email || ''),
  ].filter(Boolean);

  for (const raw of candidates) {
    if (!raw) continue;

    // 1) ObjectId direct
    if (isValidId(raw)) {
      const hitU = await User.findById(raw);
      if (hitU) return { doc: hitU, model: 'User' };
      if (Admin) {
        const hitA = await Admin.findById(raw);
        if (hitA) return { doc: hitA, model: 'Admin' };
      }
    }

    // 2) $oid / 24-hex parse
    const m = raw.match(/[a-f0-9]{24}/i);
    if (m && isValidId(m[0])) {
      const hitU = await User.findById(m[0]);
      if (hitU) return { doc: hitU, model: 'User' };
      if (Admin) {
        const hitA = await Admin.findById(m[0]);
        if (hitA) return { doc: hitA, model: 'Admin' };
      }
    }

    // 3) email
    if (raw.includes('@')) {
      const byEmailU = await User.findOne({ email: norm(raw) });
      if (byEmailU) return { doc: byEmailU, model: 'User' };
      if (Admin) {
        const byEmailA = await Admin.findOne({ email: norm(raw) });
        if (byEmailA) return { doc: byEmailA, model: 'Admin' };
      }
    }

    // 4) userId
    const byUidU = await User.findOne({ userId: raw });
    if (byUidU) return { doc: byUidU, model: 'User' };
    if (Admin) {
      const byUidA = await Admin.findOne({ userId: raw });
      if (byUidA) return { doc: byUidA, model: 'Admin' };
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
    let { email, password, name, communeId, communeName } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email déjà utilisé' });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      passwordHash, // on stocke dans passwordHash (compat conservée avec "password")
      name: name || '',
      role: 'admin',
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
    const found = await findAccount(req.params.id, req.body);
    if (!found) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (found.doc.role !== 'admin') {
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

    // On met à jour dans le modèle d’origine (User ou Admin)
    const Model = found.model === 'Admin' ? Admin : User;
    const updated = await Model.findByIdAndUpdate(found.doc._id, { $set: payload }, { new: true });
    res.json(updated.toJSON ? updated.toJSON() : updated);
  } catch (err) {
    console.error('❌ PUT /api/users/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== TOGGLE ACTIVE ===================== */
router.post('/users/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const found = await findAccount(req.params.id, req.body);
    if (!found) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const next = !!req.body.active;
    found.doc.isActive = next;
    await found.doc.save();

    const plain = found.doc.toJSON ? found.doc.toJSON() : found.doc;
    res.json({ ok: true, user: plain });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (stub) ===================== */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const found = await findAccount(req.params.id, req.query);
    if (!found) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const u = found.doc;
    const inv = [{
      id: `INV-${String(u._id).slice(-6)}`,
      number: `INV-${new Date().getFullYear()}-${String(u._id).slice(-4)}`,
      amount: u.subscriptionStatus === 'active' ? 19.90 : 0.00,
      currency: 'EUR',
      status: u.subscriptionStatus === 'active' ? 'paid' : 'unpaid',
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

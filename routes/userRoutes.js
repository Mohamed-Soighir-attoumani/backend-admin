// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Commune = require('../models/Commune');
const { sign } = require('../utils/jwt');

/* Utils */
const isValidHex24 = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
const isValidId = (id) => isValidHex24(String(id || ''));
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
function formatDateFR(d) { try { return new Date(d).toLocaleDateString('fr-FR'); } catch { return ''; } }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------- Slug ---------- */
function slugify(input) {
  return String(input || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
}

/* ---------- Canonicalisation commune ---------- */
async function findCommuneByAny(anyId) {
  const raw = String(anyId ?? '').trim();
  if (!raw) return null;

  if (isValidHex24(raw)) {
    const c = await Commune.findById(raw).lean();
    if (c) return c;
  }
  let c = await Commune.findOne({ slug: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  const nameFields = ['name', 'label', 'communeName', 'nom'];
  for (const f of nameFields) {
    c = await Commune.findOne({ [f]: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
    if (c) return c;
  }

  c = await Commune.findOne({ code: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  return null;
}

/** Retourne { key, name } si connue, sinon { key:'', name:'' } */
async function toCanonicalCommune(anyId) {
  const raw = norm(anyId);
  if (!raw) return { key: '', name: '' };
  const c = await findCommuneByAny(raw);
  if (!c) return { key: '', name: '' };
  const key = norm(c.slug || String(c._id));
  const name = String(c.name ?? c.label ?? c.communeName ?? c.nom ?? '').trim();
  return { key, name };
}

/** 
 * Assure qu’une commune existe :
 * - si elle existe → retourne { key, name }
 * - sinon → la crée (slugifié) et retourne { key, name }
 */
async function ensureCanonicalCommune(anyIdOrName) {
  const raw = String(anyIdOrName || '').trim();
  if (!raw) return { key: '', name: '' };

  // 1) existe déjà ?
  const canon = await toCanonicalCommune(raw);
  if (canon.key) return canon;

  // 2) créer à la volée (uniquement pour les routes superadmin qui appellent cette fonction)
  const slug = slugify(raw);
  // si collision de slug, on suffixe
  let finalSlug = slug || `commune-${Date.now()}`;
  let i = 1;
  while (await Commune.findOne({ slug: finalSlug }).lean()) {
    i += 1;
    finalSlug = `${slug}-${i}`;
  }

  const doc = await Commune.create({
    name: raw,
    label: raw,
    communeName: raw,
    code: '',
    region: '',
    imageUrl: '',
    slug: finalSlug,
  });

  return { key: doc.slug, name: doc.name || raw };
}

/**
 * 🔍 Résout un utilisateur à partir de plein d’identifiants
 */
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

    if (communeId) {
      const { key } = await toCanonicalCommune(communeId);
      if (key) find.communeId = key;
      else return res.json({ items: [], total: 0 });
    }

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

/* ===================== CRÉATION ADMIN ===================== */
router.post('/admins', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { email, password, name, communeId, communeName, photo, createdBy } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email déjà utilisé' });

    // ⬇️ COMMUNE OBLIGATOIRE — et si inconnue, on la crée (slugifié)
    const rawCommuneInput = communeId || communeName;
    if (!rawCommuneInput) {
      return res.status(400).json({ message: 'Commune obligatoire pour un compte admin.' });
    }
    const canon = await ensureCanonicalCommune(rawCommuneInput);
    if (!canon.key) {
      return res.status(400).json({ message: "Commune invalide." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      password: passwordHash,
      name: name || '',
      role: 'admin',
      communeId: canon.key,
      communeName: canon.name || communeName || '',
      photo: photo || '',
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
    console.error('❌ POST /api/admins', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== (compat) CRÉATION via /users ===================== */
router.post('/users', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { email, password, name, communeId, communeName, role, createdBy, photo } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }
    role = 'admin';

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email déjà utilisé' });

    const rawCommuneInput = communeId || communeName;
    if (!rawCommuneInput) {
      return res.status(400).json({ message: 'Commune obligatoire pour un compte admin.' });
    }
    const canon = await ensureCanonicalCommune(rawCommuneInput);
    if (!canon.key) {
      return res.status(400).json({ message: "Commune invalide." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      password: passwordHash,
      name: name || '',
      role,
      communeId: canon.key,
      communeName: canon.name || communeName || '',
      photo: photo || '',
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

    if (req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'Changement de rôle interdit ici' });
    }

    // Commune : si fournie → s’assurer qu’elle existe (création à la volée si besoin)
    let nextCommuneId = user.communeId || '';
    let nextCommuneName = user.communeName || '';

    if (typeof req.body.communeId === 'string' || typeof req.body.communeName === 'string') {
      const raw = req.body.communeId || req.body.communeName;
      const canon = await ensureCanonicalCommune(raw);
      if (!canon.key) {
        return res.status(400).json({ message: "Commune invalide." });
      }
      nextCommuneId = canon.key;
      nextCommuneName = canon.name || req.body.communeName || '';
    }

    // Si le compte est (ou reste) admin, il doit avoir une commune
    const becomesAdmin = (req.body.role || user.role) === 'admin';
    if (becomesAdmin && !nextCommuneId) {
      return res.status(400).json({ message: "Un compte admin doit être rattaché à une commune valide." });
    }

    const payload = {};
    if (typeof req.body.email === 'string') payload.email = norm(req.body.email);
    if (typeof req.body.name === 'string')  payload.name = req.body.name;
    if (typeof req.body.isActive === 'boolean') payload.isActive = req.body.isActive;

    if (nextCommuneId !== (user.communeId || '')) {
      payload.communeId = nextCommuneId;
      payload.communeName = nextCommuneName;
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

/* ===================== FACTURES (extraits utiles) ===================== */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.query, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const invoices = await Invoice.find({ userId: user._id }).sort({ issuedAt: -1 }).lean();

    const list = invoices.map(inv => ({
      id: String(inv._id),
      number: inv.number,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      date: inv.issuedAt,
      method: inv.method || '',
      periodStart: inv.periodStart || null,
      periodEnd: inv.periodEnd || null,
      url: `/api/users/${encodeURIComponent(String(user._id))}/invoices/${encodeURIComponent(inv.number)}/pdf`,
    }));

    res.json({ items: list, total: list.length });
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

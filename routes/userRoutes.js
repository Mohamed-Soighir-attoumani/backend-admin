// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Commune = require('../models/Commune');
const { sign } = require('../utils/jwt');

/* ===================== Utils généraux ===================== */
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
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function formatDateFR(d) { try { return new Date(d).toLocaleDateString('fr-FR'); } catch { return ''; } }

/* ---------- Slugify pour communes auto ---------- */
function slugify(input) {
  return String(input || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
}

/* ===================== Communes : recherche / canon / ensure ===================== */
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

async function toCanonicalCommune(anyId) {
  const raw = norm(anyId);
  if (!raw) return { key: '', name: '' };
  const c = await findCommuneByAny(raw);
  if (!c) return { key: '', name: '' };
  const key = norm(c.slug || String(c._id));
  const name = String(c.name ?? c.label ?? c.communeName ?? c.nom ?? '').trim();
  return { key, name };
}

/** Crée la commune si absente, retourne { key: slugOrId, name } (active = true pour l’app mobile) */
async function ensureCanonicalCommune(anyIdOrName) {
  const raw = String(anyIdOrName || '').trim();
  if (!raw) return { key: '', name: '' };

  const canon = await toCanonicalCommune(raw);
  if (canon.key) return canon;

  const baseSlug = slugify(raw) || `commune-${Date.now()}`;
  let finalSlug = baseSlug;
  let i = 1;
  while (await Commune.findOne({ slug: finalSlug }).lean()) {
    i += 1;
    finalSlug = `${baseSlug}-${i}`;
  }

  // création résiliente aux courses (slug déjà pris entre le check et l’insert)
  try {
    const doc = await Commune.create({
      name: raw,
      label: raw,
      communeName: raw,
      code: '',
      region: '',
      imageUrl: '',
      slug: finalSlug,
      active: true,
    });
    return { key: doc.slug, name: doc.name || raw };
  } catch (e) {
    if (e && e.code === 11000) {
      const altSlug = `${finalSlug}-${Date.now().toString().slice(-4)}`;
      const doc2 = await Commune.create({
        name: raw,
        label: raw,
        communeName: raw,
        code: '',
        region: '',
        imageUrl: '',
        slug: altSlug,
        active: true,
      });
      return { key: doc2.slug, name: doc2.name || raw };
    }
    throw e;
  }
}

/* ===================== Users helper ===================== */
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

/* ===================== Email alias en cas de collision ===================== */
async function buildUniqueAliasEmail(baseEmail, slug) {
  const s = String(baseEmail || '').trim();
  const at = s.lastIndexOf('@');
  if (at < 0) return '';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const base = `${local}+${slug}`;
  let candidate = `${base}@${domain}`;
  let i = 1;

  while (await User.findOne({ email: norm(candidate) })) {
    i += 1;
    candidate = `${base}-${i}@${domain}`;
  }
  return candidate.toLowerCase();
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

    items = items.map(u => ({ ...u, _idString: (u._id && String(u._id)) || '' }));
    const total = await User.countDocuments(find);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ items, total });
  } catch (err) {
    console.error('❌ GET /api/admins', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== CRÉATION / MISE À JOUR ADMIN (idempotent + auto-commune + alias email) ===================== */
router.post('/admins', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { email, password, name, communeId, communeName, photo, createdBy } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Mot de passe trop court (min 6 caractères).' });
    }

    // 1) S’assurer que la commune existe (création auto + active:true)
    const rawCommuneInput = communeId || communeName;
    if (!rawCommuneInput) {
      return res.status(400).json({ message: 'Commune obligatoire pour un compte admin.' });
    }
    const canon = await ensureCanonicalCommune(rawCommuneInput);
    if (!canon.key) {
      return res.status(400).json({ message: 'Commune invalide.' });
    }

    // 2) L’admin existe déjà ?
    let existing = await User.findOne({ email });
    const passwordHash = await bcrypt.hash(String(password), 10);

    // 2a) si déjà admin → mise à jour (commune + mdp + infos)
    if (existing && String(existing.role).toLowerCase() === 'admin') {
      const update = {
        communeId: canon.key,
        communeName: canon.name || communeName || '',
        isActive: true,
      };
      if (name)  update.name  = name;
      if (photo) update.photo = photo;
      update.password = passwordHash;

      const updated = await User.findByIdAndUpdate(
        existing._id,
        { $set: update, $inc: { tokenVersion: 1 } },
        { new: true }
      );

      const plain = updated.toObject();
      plain._idString = String(updated._id);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ...plain, upserted: true, mode: 'updated' });
    }

    // 2b) si email pris par un autre rôle (ex: superadmin) → alias email
    let finalEmail = email;
    if (existing && String(existing.role).toLowerCase() !== 'admin') {
      const alias = await buildUniqueAliasEmail(email, canon.key);
      if (!alias) {
        return res.status(409).json({
          message: "Cet email appartient déjà à un autre compte et ne peut pas être aliasé. Utilisez une autre adresse.",
          code: 'EMAIL_TAKEN',
        });
      }
      finalEmail = alias;
    }

    // 3) créer l’admin (catch 11000 robuste)
    let doc;
    try {
      doc = await User.create({
        email: finalEmail,
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
    } catch (e) {
      // ✅ certains environnements n’envoient pas keyPattern/keyValue → on traite tout E11000 comme doublon email
      if (e && e.code === 11000) {
        return res.status(409).json({ message: 'Email déjà utilisé', code: 'EMAIL_TAKEN' });
      }
      console.error('❌ create admin error:', e);
      throw e;
    }

    const plain = doc.toObject();
    plain._idString = String(doc._id);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({
      ...plain,
      upserted: true,
      mode: 'created',
      emailAliased: finalEmail !== email,
      originalEmail: email,
    });
  } catch (err) {
    console.error('❌ POST /api/admins', err);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== (compat) CRÉATION via /users — redirige vers /admins ===================== */
router.post('/users', auth, requireRole('superadmin'), async (req, res) => {
  req.url = '/admins';
  return router.handle(req, res);
});

/* ===================== MISE À JOUR ADMIN ===================== */
router.put('/users/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'Changement de rôle interdit ici' });
    }

    // commune : création auto si elle n’existe pas
    let nextCommuneId = user.communeId || '';
    let nextCommuneName = user.communeName || '';

    if (typeof req.body.communeId === 'string' || typeof req.body.communeName === 'string') {
      const raw = req.body.communeId || req.body.communeName;
      const canon = await ensureCanonicalCommune(raw);
      if (!canon.key) {
        return res.status(400).json({ message: 'Commune invalide.' });
      }
      nextCommuneId = canon.key;
      nextCommuneName = canon.name || req.body.communeName || '';
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
    res.setHeader('Cache-Control', 'no-store');
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

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, user: { ...user.toObject(), _idString: String(user._id) } });
  } catch (err) {
    console.error('❌ POST /api/users/:id/toggle-active', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== RESET MOT DE PASSE ADMIN ===================== */
router.post('/admins/:id/reset-password', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (String(user.role).toLowerCase() !== 'admin') {
      return res.status(400).json({ message: 'Réservé aux comptes admin' });
    }

    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Nouveau mot de passe invalide (min 6 car.)' });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    await User.updateOne({ _id: user._id }, { $set: { password: hash }, $inc: { tokenVersion: 1 } });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ POST /api/admins/:id/reset-password', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== SUPPRESSION ADMIN ===================== */
router.delete('/admins/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const currentId = String((req.user && req.user.id) || '');
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    if (String(user._id) === currentId) {
      return res.status(400).json({ message: 'Impossible de vous supprimer vous-même' });
    }
    if (String(user.role).toLowerCase() === 'superadmin') {
      return res.status(400).json({ message: 'Suppression d’un superadmin interdite' });
    }

    await User.deleteOne({ _id: user._id });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/admins/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== IMPERSONATION ADMIN ===================== */
router.post('/admins/:id/impersonate', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const target = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!target) return res.status(404).json({ message: 'Utilisateur introuvable' });
    if (String(target.role).toLowerCase() !== 'admin') {
      return res.status(400).json({ message: 'Seuls les comptes admin sont impersonables ici' });
    }
    if (target.isActive === false) {
      return res.status(403).json({ message: 'Compte cible désactivé' });
    }

    const payload = {
      id: String(target._id),
      email: target.email,
      role: target.role || 'admin',
      tv: typeof target.tokenVersion === 'number' ? target.tokenVersion : 0,
      impersonated: true,
      origUserId: String(req.user.id),
      communeId: target.communeId || '',
      communeName: target.communeName || '',
    };

    const token = sign(payload, { expiresIn: '2h' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ token });
  } catch (err) {
    console.error('❌ POST /api/admins/:id/impersonate', err);
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

    items = items.map(u => ({ ...u, _idString: (u._id && String(u._id)) || '' }));
    const total = await User.countDocuments(find);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ items, total });
  } catch (err) {
    console.error('❌ GET /api/users', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== FACTURES (optionnel) ===================== */
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

    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: list, total: list.length });
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.get('/users/:id/invoices/:num/pdf', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.query, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const number = String(req.params.num || '').trim();
    const invoice = await Invoice.findOne({ number, userId: user._id });
    if (!invoice) return res.status(404).json({ message: 'Facture introuvable' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // rendu minimal
    doc.fontSize(20).text('Licence Securidem', 50, 50);
    doc.fontSize(10).text(`N°: ${invoice.number} — Date: ${formatDateFR(invoice.issuedAt)}`);
    doc.moveDown().text(`Client: ${invoice.customerName || invoice.userEmail}`);
    doc.text(`Email: ${invoice.userEmail}`);
    if (invoice.communeName || invoice.communeId) {
      doc.text(`Commune: ${invoice.communeName || invoice.communeId}`);
    }
    doc.moveDown().fontSize(12).text(`Total: ${invoice.amount.toFixed(2)} ${invoice.currency}`);
    doc.end();
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices/:num/pdf', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

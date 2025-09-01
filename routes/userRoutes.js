// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
const JWT_SECRET = require('../config/jwt');

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

function formatDateFR(d) {
  try { return new Date(d).toLocaleDateString('fr-FR'); } catch { return ''; }
}
function invoiceNumberFor(user) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `INV-${y}${m}${d}-${String(user._id).slice(-4)}`;
}
function buildInvoiceForUser(user) {
  const now = new Date();
  const amount = typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0;
  const currency = user.subscriptionCurrency || 'EUR';
  const status = user.subscriptionStatus === 'active' ? 'paid' : 'unpaid';

  return {
    id: `INV-${String(user._id).slice(-6)}`,
    number: invoiceNumberFor(user),
    title: 'Licence Securidem',
    issuer: {
      name: 'Association Bellevue Dembeni',
      siret: '913 987 905 00019',
      address: '49, Rue Manga Chebane, 97660 Dembeni',
    },
    customer: {
      name: user.name || user.email,
      email: user.email,
      communeId: user.communeId || '',
      communeName: user.communeName || '',
    },
    invoiceDate: now,
    invoiceDateFormatted: formatDateFR(now),
    amount,
    currency,
    status,
    method: user.subscriptionMethod || '',
    url: null,
  };
}

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
async function createAdminHandler(req, res) {
  try {
    let { email, password, name, communeId, communeName, createdBy } = req.body || {};
    email = norm(email);
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
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
      createdBy: createdBy ? String(createdBy) : String(req.user.id || ''),
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
    console.error('❌ createAdminHandler', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}
router.post('/users',  auth, requireRole('superadmin'), createAdminHandler);
router.post('/admins', auth, requireRole('superadmin'), createAdminHandler); // ✅ vraie route

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
router.put('/admins/:id', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}` }, res)); // petite redirection interne OK car même req/headers

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
router.post('/admins/:id/toggle-active', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}/toggle-active` }, res));

/* ===================== FACTURES JSON + PDF ===================== */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.query, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const invoices = [];
    if (user.subscriptionStatus === 'active') {
      invoices.push(buildInvoiceForUser(user));
    }
    res.json({ invoices });
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});
router.get('/admins/:id/invoices', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}/invoices` }, res));

const PDFDocument = require('pdfkit');
router.get('/users/:id/invoices/:num/pdf', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.query, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
    const inv = buildInvoiceForUser(user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text(inv.title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Émetteur : ${inv.issuer.name}`);
    doc.text(`SIRET : ${inv.issuer.siret}`);
    doc.text(`Adresse : ${inv.issuer.address}`);
    doc.moveUp(3);
    doc.text(`Date : ${inv.invoiceDateFormatted}`, 350);
    doc.text(`N° : ${inv.number}`, 350);
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();

    doc.moveDown(1);
    doc.fontSize(12).text('Client', { underline: true });
    doc.fontSize(10);
    doc.text(`Nom : ${inv.customer.name}`);
    doc.text(`Email : ${inv.customer.email}`);
    if (inv.customer.communeName || inv.customer.communeId) {
      doc.text(`Commune : ${inv.customer.communeName || inv.customer.communeId}`);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Détails', { underline: true });
    doc.fontSize(10);
    const statusLabel = inv.status === 'paid' ? 'Payée' : 'À payer';
    const methodLabel = inv.method ? ` (${inv.method})` : '';
    doc.text(`Produit : Licence Securidem`);
    doc.text(`Montant : ${inv.amount.toFixed(2)} ${inv.currency} – ${statusLabel}${methodLabel}`);
    if (user.subscriptionEndAt) doc.text(`Valable jusqu’au : ${formatDateFR(user.subscriptionEndAt)}`);
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Total TTC : ${inv.amount.toFixed(2)} ${inv.currency}`, { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#666')
      .text('Association Bellevue Dembeni – Licence Securidem', { align: 'center' })
      .text('Document généré automatiquement, sans signature manuscrite.', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices/:num/pdf', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});
router.get('/admins/:id/invoices/:num/pdf', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}/invoices/${req.params.num}/pdf` }, res));

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
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

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
router.post('/admins/:id/impersonate', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}/impersonate` }, res));

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
router.post('/admins/:id/reset-password', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}/reset-password` }, res));

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
router.delete('/admins/:id', auth, requireRole('superadmin'), (req, res) =>
  router.handle({ ...req, url: `/users/${req.params.id}` }, res));

module.exports = router;

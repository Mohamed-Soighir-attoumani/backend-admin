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

/**
 * 🔍 Résout un utilisateur à partir de :
 * - req.params.id (ObjectId, $oid, ObjectId("..."), email, userId)
 * - req.body.id / req.body.userId / req.body.email
 * - req.query.id / req.query.email
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

    // 1) ObjectId prioritaire
    if (hex) {
      const byId = await User.findById(hex);
      if (byId) return byId;
    }

    // 2) email
    if (maybeEmail) {
      const byEmail = await User.findOne({ email: norm(raw) });
      if (byEmail) return byEmail;
    }

    // 3) userId personnalisé
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

    // ✅ standardiser _idString
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

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      password: passwordHash, // ✅ correspond au schéma
      name: name || '',
      role: 'admin',
      communeId: communeId || '',
      communeName: communeName || '',
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

    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await User.create({
      email,
      password: passwordHash,
      name: name || '',
      role,
      communeId: communeId || '',
      communeName: communeName || '',
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

/* ===================== FACTURES (persistées) ===================== */
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
      // lien de téléchargement pour le superadmin :
      url: `/api/users/${encodeURIComponent(String(user._id))}/invoices/${encodeURIComponent(inv.number)}/pdf`,
    }));

    res.json({ invoices: list });
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ====== PDF Helper (réutilisé) ====== */
function drawInvoicePDF(doc, invoice, { logoPathOrUrl } = {}) {
  // Logo en haut à gauche
  if (logoPathOrUrl) {
    try {
      const p = logoPathOrUrl.startsWith('/') || logoPathOrUrl.includes(path.sep)
        ? logoPathOrUrl
        : path.join(__dirname, '..', logoPathOrUrl);
      if (fs.existsSync(p)) {
        doc.image(p, 50, 40, { fit: [90, 90], align: 'left', valign: 'top' });
      }
    } catch {}
  }

  doc.fontSize(20).text('Licence Securidem', 160, 50, { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text('Émetteur : Association Bellevue Dembeni', 160);
  doc.text('SIRET : 913 987 905 00019', 160);
  doc.text('Adresse : 49, Rue Manga Chebane, 97660 Dembeni', 160);

  doc.text(`Date : ${formatDateFR(invoice.issuedAt)}`, 400, 50);
  doc.text(`N° : ${invoice.number}`, 400);

  doc.moveDown(1);
  doc.moveTo(50, doc.y + 10).lineTo(545, doc.y + 10).stroke();

  doc.moveDown(1.5);
  doc.fontSize(12).text('Client', { underline: true });
  doc.fontSize(10);
  doc.text(`Nom : ${invoice.customerName || invoice.userEmail}`);
  doc.text(`Email : ${invoice.userEmail}`);
  if (invoice.communeName || invoice.communeId) {
    doc.text(`Commune : ${invoice.communeName || invoice.communeId}`);
  }

  doc.moveDown(1);
  doc.fontSize(12).text('Détails', { underline: true });
  doc.fontSize(10);

  const startY = doc.y + 10;
  doc.text('Description', 50, startY);
  doc.text('Qté', 330, startY);
  doc.text('PU', 380, startY);
  doc.text('Total', 460, startY);
  doc.moveTo(50, startY + 12).lineTo(545, startY + 12).stroke();

  let y = startY + 18;
  for (const it of invoice.items || []) {
    doc.text(it.description, 50, y);
    doc.text(String(it.quantity), 330, y);
    doc.text(`${(it.unitPrice || 0).toFixed(2)} ${invoice.currency}`, 380, y);
    doc.text(`${(it.total || 0).toFixed(2)} ${invoice.currency}`, 460, y);
    y += 16;
  }

  doc.moveTo(50, y + 6).lineTo(545, y + 6).stroke();
  doc.fontSize(12).text(`Total TTC : ${invoice.amount.toFixed(2)} ${invoice.currency}`, 400, y + 12);

  if (invoice.periodEnd) {
    doc.fontSize(10).text(`Valable jusqu’au : ${formatDateFR(invoice.periodEnd)}`, 50, y + 12);
  }

  doc.moveDown(3);
  doc.fontSize(8).fillColor('#666')
    .text('Association Bellevue Dembeni – Licence Securidem', { align: 'center' })
    .text('Document généré automatiquement, sans signature manuscrite.', { align: 'center' });
}

/* ====== PDF pour le superadmin (télécharger la facture d’un admin) ====== */
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

    const logoPath = process.env.ASSO_LOGO_PATH || 'assets/logo-bellevue.png';

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    drawInvoicePDF(doc, invoice, { logoPathOrUrl: logoPath });
    doc.end();
  } catch (err) {
    console.error('❌ GET /api/users/:id/invoices/:num/pdf', err);
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
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ POST /api/admins/:id/reset-password', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== SUPPRESSION ADMIN ===================== */
router.delete('/admins/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const currentId = String(req.user && req.user.id || '');
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    if (String(user._id) === currentId) {
      return res.status(400).json({ message: 'Impossible de vous supprimer vous-même' });
    }
    if (String(user.role).toLowerCase() === 'superadmin') {
      return res.status(400).json({ message: 'Suppression d’un superadmin interdite' });
    }

    await User.deleteOne({ _id: user._id });
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
    };

    const token = sign(payload, { expiresIn: '2h' });
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

module.exports = router;

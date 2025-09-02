// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
const Invoice = require('../models/Invoice');

/* ===== Utils génériques ===== */
const isValidHex24 = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
const decode = (v) => { try { return decodeURIComponent(String(v)); } catch { return String(v || ''); } };
const norm = (v) => String(v || '').trim().toLowerCase();
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

/* ===== Numéro de facture: AMS-YYYYMMDD-<3 digits><2 letters> ===== */
function randomDigits(n = 3) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}
function randomLetters(n = 2) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: n }, () => A[Math.floor(Math.random() * A.length)]).join('');
}
function dateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}
async function generateUniqueInvoiceNumber() {
  for (let i = 0; i < 10; i++) {
    const candidate = `AMS-${dateStamp(new Date())}-${randomDigits(3)}${randomLetters(2)}`;
    const exists = await Invoice.exists({ number: candidate });
    if (!exists) return candidate;
  }
  // très improbable – fallback avec timestamp
  return `AMS-${dateStamp(new Date())}-${Date.now().toString().slice(-5)}XX`;
}

/* ===== Résolution utilisateur ===== */
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

/* ===== Plans (mock) ===== */
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

/* ===== Montants envoyés par le superadmin ===== */
function extractPaymentFields(body = {}) {
  let amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  amount = Math.round(amount * 100) / 100;

  let currency = String(body.currency || '').trim().toUpperCase();
  if (!currency) currency = 'EUR';
  if (currency.length > 6) currency = currency.slice(0, 6);

  const method = String(body.method || '').trim();

  return { amount, currency, method };
}

/* ===== Création et persistance d’une facture ===== */
async function createInvoiceForUser(user, { amount, currency, method, periodStart, periodEnd }) {
  const number = await generateUniqueInvoiceNumber();

  const items = [{
    description: 'Licence Securidem',
    quantity: 1,
    unitPrice: amount,
    total: amount,
  }];

  const inv = await Invoice.create({
    number,
    userId: user._id,
    userEmail: user.email,
    customerName: user.name || user.email,
    communeId: user.communeId || '',
    communeName: user.communeName || '',
    items,
    amount,
    currency,
    method,
    status: 'paid',
    periodStart: periodStart || new Date(),
    periodEnd: periodEnd || user.subscriptionEndAt || null,
    issuedAt: new Date(),
    meta: {},
  });

  return inv;
}

/* ===== Démarrer un abonnement ===== */
router.post('/subscriptions/:id/start', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    const end = new Date();
    end.setMonth(end.getMonth() + months);

    const { amount, currency, method } = extractPaymentFields(req.body);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = end;
    user.subscriptionPrice = amount;
    user.subscriptionCurrency = currency;
    user.subscriptionMethod = method;
    await user.save();

    const inv = await createInvoiceForUser(user, {
      amount, currency, method, periodStart: new Date(), periodEnd: end,
    });

    res.json({ ok: true, user: user.toObject(), invoice: inv });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===== Renouveler un abonnement ===== */
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);

    const base = user.subscriptionEndAt && user.subscriptionEndAt > new Date()
      ? new Date(user.subscriptionEndAt)
      : new Date();
    const oldEnd = new Date(base);
    base.setMonth(base.getMonth() + months);

    const { amount, currency, method } = extractPaymentFields(req.body);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = base;
    user.subscriptionPrice = amount;
    user.subscriptionCurrency = currency;
    user.subscriptionMethod = method;
    await user.save();

    const inv = await createInvoiceForUser(user, {
      amount, currency, method, periodStart: oldEnd, periodEnd: base,
    });

    res.json({ ok: true, user: user.toObject(), invoice: inv });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===== Annuler un abonnement (pas de facture) ===== */
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    user.subscriptionStatus = 'none';
    user.subscriptionEndAt = null;
    user.subscriptionPrice = 0;
    user.subscriptionMethod = '';
    await user.save();

    res.json({ ok: true, user: user.toObject() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===== “Mon abonnement” (client) ===== */
router.get('/my-subscription', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const user = await User.findById(id).select(
      'subscriptionStatus subscriptionEndAt subscriptionPrice subscriptionCurrency name email communeId communeName subscriptionMethod'
    );
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    return res.json({
      status: user.subscriptionStatus || 'none',
      endAt: user.subscriptionEndAt || null,
      price: typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0,
      currency: user.subscriptionCurrency || 'EUR',
      method: user.subscriptionMethod || '',
      customer: {
        name: user.name || user.email,
        email: user.email,
        communeId: user.communeId || '',
        communeName: user.communeName || '',
      }
    });
  } catch (e) {
    console.error('GET /my-subscription:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===== Mes factures (client) – depuis la base ===== */
router.get('/my-invoices', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const invoices = await Invoice.find({ userId: id })
      .sort({ issuedAt: -1 })
      .lean();

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
      url: `/api/my-invoices/${encodeURIComponent(inv.number)}/pdf`,
    }));

    return res.json({ invoices: list });
  } catch (e) {
    console.error('GET /my-invoices:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===== PDF Helper (logo + rendu) ===== */
function drawInvoicePDF(doc, invoice, { logoPathOrUrl } = {}) {
  // Logo (fichier local)
  if (logoPathOrUrl) {
    try {
      // si c’est un fichier local relatif au backend/
      const p = logoPathOrUrl.startsWith('/') || logoPathOrUrl.includes(path.sep)
        ? logoPathOrUrl
        : path.join(__dirname, '..', logoPathOrUrl);
      if (fs.existsSync(p)) {
        doc.image(p, 50, 40, { fit: [90, 90], align: 'left', valign: 'top' });
      }
    } catch {}
  }

  // Titre & entête
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

  // Client
  doc.moveDown(1.5);
  doc.fontSize(12).text('Client', { underline: true });
  doc.fontSize(10);
  doc.text(`Nom : ${invoice.customerName || invoice.userEmail}`);
  doc.text(`Email : ${invoice.userEmail}`);
  if (invoice.communeName || invoice.communeId) {
    doc.text(`Commune : ${invoice.communeName || invoice.communeId}`);
  }

  // Détails
  doc.moveDown(1);
  doc.fontSize(12).text('Détails', { underline: true });
  doc.fontSize(10);

  // tableau simple
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

/* ===== Télécharger mon PDF par numéro ===== */
router.get('/my-invoices/:num/pdf', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const number = String(req.params.num || '').trim();
    const invoice = await Invoice.findOne({ number, userId: id });
    if (!invoice) return res.status(404).json({ message: 'Facture introuvable' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    const logoPath = process.env.ASSO_LOGO_PATH || 'assets/logo-bellevue.png'; // place ton logo ici
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    drawInvoicePDF(doc, invoice, { logoPathOrUrl: logoPath });

    doc.end();
  } catch (e) {
    console.error('GET /my-invoices/:num/pdf:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

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

// Plans
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

/** extrait montant/devise/méthode */
function extractPaymentFields(body = {}) {
  let amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  amount = Math.round(amount * 100) / 100;

  let currency = String(body.currency || '').trim().toUpperCase();
  if (!currency) currency = 'EUR';
  if (currency.length > 6) currency = currency.slice(0, 6);

  const method = String(body.method || '').trim(); // 'card'|'cash'|'transfer'...

  return { amount, currency, method };
}

// Démarrer un abonnement
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

    res.json({ ok: true, user: user.toObject() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Renouveler
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);

    const base = user.subscriptionEndAt && user.subscriptionEndAt > new Date()
      ? new Date(user.subscriptionEndAt)
      : new Date();
    base.setMonth(base.getMonth() + months);

    const { amount, currency, method } = extractPaymentFields(req.body);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = base;
    user.subscriptionPrice = amount;
    user.subscriptionCurrency = currency;
    user.subscriptionMethod = method;
    await user.save();

    res.json({ ok: true, user: user.toObject() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Annuler
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

/* --------- ENDPOINTS “MON COMPTE” --------- */

// GET /api/my-subscription
router.get('/my-subscription', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const user = await User.findById(id).select('subscriptionStatus subscriptionEndAt subscriptionPrice subscriptionCurrency name email communeId communeName subscriptionMethod');
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

// GET /api/my-invoices
router.get('/my-invoices', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const user = await User.findById(id).select('subscriptionStatus subscriptionEndAt subscriptionPrice subscriptionCurrency name email communeId communeName subscriptionMethod');
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const invoices = [];
    if (user.subscriptionStatus === 'active') {
      invoices.push(buildInvoiceForUser(user));
    }

    return res.json({ invoices });
  } catch (e) {
    console.error('GET /my-invoices:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

// GET /api/my-invoices/:num/pdf
router.get('/my-invoices/:num/pdf', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const user = await User.findById(id);
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
    if (user.subscriptionEndAt) {
      doc.text(`Valable jusqu’au : ${formatDateFR(user.subscriptionEndAt)}`);
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Total TTC : ${inv.amount.toFixed(2)} ${inv.currency}`, { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#666')
      .text('Association Bellevue Dembeni – Licence Securidem', { align: 'center' })
      .text('Document généré automatiquement, sans signature manuscrite.', { align: 'center' });

    doc.end();
  } catch (e) {
    console.error('GET /my-invoices/:num/pdf:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

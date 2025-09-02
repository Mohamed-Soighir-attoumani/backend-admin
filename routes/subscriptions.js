// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
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

const TAX_RATE = Number(process.env.INVOICE_TAX_RATE || 0); // ex: 0 ou 0.2
const LOGO_PATH = process.env.INVOICE_LOGO_PATH || '';      // ex: ./uploads/logo.png

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
  const amountTTC = typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0;
  const currency = user.subscriptionCurrency || 'EUR';
  const status = user.subscriptionStatus === 'active' ? 'paid' : 'unpaid';
  const startAt = user.subscriptionStartAt ? new Date(user.subscriptionStartAt) : null;
  const endAt = user.subscriptionEndAt ? new Date(user.subscriptionEndAt) : null;

  // Si TVA configurée, on part du TTC pour reconstituer HT/TVA
  const rate = TAX_RATE > 0 ? TAX_RATE : 0;
  const amountHT = rate > 0 ? +(amountTTC / (1 + rate)).toFixed(2) : amountTTC;
  const amountTVA = +(amountTTC - amountHT).toFixed(2);

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
      name: user.billingName || user.name || user.email,
      email: user.billingEmail || user.email,
      phone: user.billingPhone || '',
      address: user.billingAddress || '',
      city: user.billingCity || '',
      zip: user.billingZip || '',
      country: user.billingCountry || '',
      vatNumber: user.vatNumber || '',
      // Contexte projet
      communeId: user.communeId || '',
      communeName: user.communeName || '',
    },
    invoiceDate: now,
    invoiceDateFormatted: formatDateFR(now),
    periodStart: startAt,
    periodStartFormatted: startAt ? formatDateFR(startAt) : '',
    periodEnd: endAt,
    periodEndFormatted: endAt ? formatDateFR(endAt) : '',
    amountHT,
    amountTVA,
    amountTTC,
    tvaRate: rate, // ex: 0.2
    currency,
    status,        // 'paid' | 'unpaid'
    method: user.subscriptionMethod || '',

    // Lignes (une ligne simple “Licence Securidem – période”)
    items: [{
      description: `Licence Securidem${startAt && endAt ? ` – Période: ${formatDateFR(startAt)} au ${formatDateFR(endAt)}` : ''}`,
      quantity: 1,
      unitPriceHT: amountHT,
      totalHT: amountHT,
    }],

    url: null, // rempli côté front
    notes: user.invoiceNotes || '',
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

// Plans simples (démo)
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

    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);

    const { amount, currency, method } = extractPaymentFields(req.body);

    user.subscriptionStatus = 'active';
    user.subscriptionStartAt = start;
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

// Renouveler (enchaîne la période)
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body, req.query);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);

    const base = user.subscriptionEndAt && user.subscriptionEndAt > new Date()
      ? new Date(user.subscriptionEndAt)
      : new Date();
    const start = new Date(base);
    const end = new Date(base);
    end.setMonth(end.getMonth() + months);

    const { amount, currency, method } = extractPaymentFields(req.body);

    user.subscriptionStatus = 'active';
    user.subscriptionStartAt = start;
    user.subscriptionEndAt = end;
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
    user.subscriptionStartAt = null;
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
    const user = await User.findById(id).select(
      'subscriptionStatus subscriptionStartAt subscriptionEndAt subscriptionPrice subscriptionCurrency subscriptionMethod name email communeId communeName billingName billingEmail billingPhone billingAddress billingCity billingZip billingCountry vatNumber'
    );
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    return res.json({
      status: user.subscriptionStatus || 'none',
      startAt: user.subscriptionStartAt || null,
      endAt: user.subscriptionEndAt || null,
      price: typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0,
      currency: user.subscriptionCurrency || 'EUR',
      method: user.subscriptionMethod || '',
      customer: {
        name: user.billingName || user.name || user.email,
        email: user.billingEmail || user.email,
        phone: user.billingPhone || '',
        address: user.billingAddress || '',
        city: user.billingCity || '',
        zip: user.billingZip || '',
        country: user.billingCountry || '',
        vatNumber: user.vatNumber || '',
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
    const user = await User.findById(id);
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

    // Bandeau haut
    if (LOGO_PATH) {
      try {
        const abs = path.resolve(LOGO_PATH);
        if (fs.existsSync(abs)) {
          doc.image(abs, 50, 40, { width: 90 });
        }
      } catch {}
    }

    doc.fontSize(20).text(inv.title, 150, 45, { align: 'right' });
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text(`Émetteur : ${inv.issuer.name}`, 50, 110);
    doc.text(`SIRET    : ${inv.issuer.siret}`, 50);
    doc.text(`Adresse  : ${inv.issuer.address}`, 50);

    doc.text(`Date : ${inv.invoiceDateFormatted}`, 350, 110, { align: 'left' });
    doc.text(`Facture n° : ${inv.number}`, 350);

    // Client
    doc.moveDown(1.2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.6);
    doc.fontSize(12).text('Client', { underline: true });
    doc.fontSize(10);
    doc.text(`${inv.customer.name}`);
    if (inv.customer.vatNumber) doc.text(`N° TVA : ${inv.customer.vatNumber}`);
    doc.text(`${inv.customer.email}`);
    if (inv.customer.phone) doc.text(`${inv.customer.phone}`);
    if (inv.customer.address) doc.text(`${inv.customer.address}`);
    const loc = [inv.customer.zip, inv.customer.city].filter(Boolean).join(' ');
    if (loc) doc.text(loc);
    if (inv.customer.country) doc.text(inv.customer.country);
    if (inv.customer.communeName || inv.customer.communeId) {
      doc.text(`Commune : ${inv.customer.communeName || inv.customer.communeId}`);
    }

    // Détails abonnement / période
    doc.moveDown(1);
    doc.fontSize(12).text('Détails', { underline: true });
    doc.fontSize(10);
    if (inv.periodStartFormatted || inv.periodEndFormatted) {
      doc.text(`Période : ${inv.periodStartFormatted || '—'} au ${inv.periodEndFormatted || '—'}`);
    }
    const statusLabel = inv.status === 'paid' ? 'Payée' : 'À payer';
    const methodLabel = inv.method ? ` – Règlement: ${inv.method}` : '';
    doc.text(`Statut : ${statusLabel}${methodLabel}`);

    // Tableau lignes
    doc.moveDown(0.6);
    const tableTop = doc.y;
    const colX = { desc: 50, qty: 360, pu: 400, total: 480 };
    doc.fontSize(10).text('Description', colX.desc, tableTop);
    doc.text('Qté', colX.qty, tableTop);
    doc.text('PU HT', colX.pu, tableTop, { width: 60, align: 'right' });
    doc.text('Total HT', colX.total, tableTop, { width: 60, align: 'right' });
    doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).stroke();

    let y = doc.y + 8;
    inv.items.forEach(it => {
      doc.text(it.description, colX.desc, y, { width: 300 });
      doc.text(String(it.quantity), colX.qty, y);
      doc.text(it.unitPriceHT.toFixed(2) + ' ' + inv.currency, colX.pu, y, { width: 60, align: 'right' });
      doc.text(it.totalHT.toFixed(2) + ' ' + inv.currency, colX.total, y, { width: 60, align: 'right' });
      y += 18;
    });

    // Totaux
    doc.moveTo(50, y + 4).lineTo(545, y + 4).stroke();
    y += 12;
    const right = 540;

    const line = (label, value) => {
      doc.text(label, 350, y);
      doc.text(value, right - 60, y, { width: 60, align: 'right' });
      y += 16;
    };

    line('Sous-total HT', `${inv.amountHT.toFixed(2)} ${inv.currency}`);
    if (inv.tvaRate > 0) {
      line(`TVA (${(inv.tvaRate * 100).toFixed(0)}%)`, `${inv.amountTVA.toFixed(2)} ${inv.currency}`);
    } else {
      line('TVA', `0.00 ${inv.currency}`);
    }
    doc.font('Helvetica-Bold');
    line('Total TTC', `${inv.amountTTC.toFixed(2)} ${inv.currency}`);
    doc.font('Helvetica');

    // Notes / mentions
    doc.moveDown(1.2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#444')
      .text(inv.notes || 'Association Bellevue Dembeni – Licence Securidem', { align: 'center' })
      .text('Document généré automatiquement, sans signature manuscrite.', { align: 'center' });
    doc.fillColor('black');

    doc.end();
  } catch (e) {
    console.error('GET /my-invoices/:num/pdf:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

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

// Plans (exemple)
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

/** helper pour lire amount/currency/method depuis le body et normaliser */
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

/* --------- NOUVEAUX ENDPOINTS pour la page MonAbonnement --------- */

// GET /api/my-subscription -> l’admin voit en direct son statut
router.get('/my-subscription', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const user = await User.findById(id).select('subscriptionStatus subscriptionEndAt subscriptionPrice subscriptionCurrency');
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    return res.json({
      status: user.subscriptionStatus || 'none',
      endAt: user.subscriptionEndAt || null,
      price: typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0,
      currency: user.subscriptionCurrency || 'EUR',
    });
  } catch (e) {
    console.error('GET /my-subscription:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

// GET /api/my-invoices -> factures "mock" avec le dernier montant
router.get('/my-invoices', auth, async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Non connecté' });
    }
    const user = await User.findById(id).select('subscriptionStatus subscriptionEndAt subscriptionPrice subscriptionCurrency');
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const invoices = [];
    if (user.subscriptionStatus === 'active') {
      invoices.push({
        id: `INV-${String(user._id).slice(-6)}`,
        number: `INV-${new Date().getFullYear()}-${String(user._id).slice(-4)}`,
        amount: typeof user.subscriptionPrice === 'number' ? user.subscriptionPrice : 0,
        currency: user.subscriptionCurrency || 'EUR',
        status: 'paid',
        date: new Date(),
        url: 'https://example.com/invoice.pdf',
      });
    }

    return res.json({ invoices });
  } catch (e) {
    console.error('GET /my-invoices:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

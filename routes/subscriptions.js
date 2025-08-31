// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

async function findUserByAnyId(id) {
  if (!id) return null;
  const raw = String(id).trim();

  if (isValidId(raw)) {
    const byId = await User.findById(raw);
    if (byId) return byId;
  }
  const m = raw.match(/[a-f0-9]{24}/i);
  if (m && isValidId(m[0])) {
    const byHex = await User.findById(m[0]);
    if (byHex) return byHex;
  }
  const byEmail = await User.findOne({ email: raw.toLowerCase() });
  if (byEmail) return byEmail;
  const byUserId = await User.findOne({ userId: raw });
  if (byUserId) return byUserId;
  return null;
}

/* ======== Plans (superadmin) ======== */
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

/* ======== Opérations d’abonnement (superadmin) ======== */
router.post('/subscriptions/:id/start', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { planId = 'basic', periodMonths = 1 } = req.body || {};
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    const end = new Date();
    end.setMonth(end.getMonth() + months);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = end;
    await user.save();

    res.json({ ok: true, user, planId, periodMonths: months });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { planId = 'basic', periodMonths = 1 } = req.body || {};
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const base = user.subscriptionEndAt && user.subscriptionEndAt > new Date()
      ? new Date(user.subscriptionEndAt)
      : new Date();
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    base.setMonth(base.getMonth() + months);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = base;
    await user.save();

    res.json({ ok: true, user, planId, periodMonths: months });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    user.subscriptionStatus = 'none';
    user.subscriptionEndAt = null;
    await user.save();

    res.json({ ok: true, user });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ======== Endpoints self-service (admin & superadmin) ======== */
// Abonnement courant de l’utilisateur connecté
router.get('/my-subscription', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).lean();
    if (!me) return res.status(404).json({ message: 'Utilisateur introuvable' });
    res.json({
      status: me.subscriptionStatus || 'none',
      endAt: me.subscriptionEndAt || null,
    });
  } catch (err) {
    console.error('❌ GET /my-subscription', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Factures de l’utilisateur connecté (stub)
router.get('/my-invoices', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).lean();
    if (!me) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const invoices = [{
      id: `INV-${String(me._id).slice(-6)}`,
      number: `INV-${new Date().getFullYear()}-${String(me._id).slice(-4)}`,
      amount: me.subscriptionStatus === 'active' ? 19.90 : 0.00,
      currency: 'EUR',
      status: me.subscriptionStatus === 'active' ? 'paid' : 'unpaid',
      date: new Date(),
      url: 'https://example.com/invoice.pdf',
    }];

    res.json({ invoices });
  } catch (err) {
    console.error('❌ GET /my-invoices', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

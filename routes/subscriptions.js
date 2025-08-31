// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

async function findUserByAnyId(id) {
  let u = null;
  if (isValidId(id)) {
    u = await User.findById(id);
    if (u) return u;
  }
  // fallback: parfois le front envoie email / id / userId
  u = await User.findOne({ email: id });
  if (u) return u;
  u = await User.findOne({ id });
  if (u) return u;
  u = await User.findOne({ userId: id });
  return u;
}

// Plans disponibles
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

// Helpers abonnement
function computeEndDate(periodMonths = 1) {
  const d = new Date();
  const months = Math.max(1, parseInt(periodMonths, 10) || 1);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Démarrer un abonnement
router.post('/subscriptions/:id/start', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const u = await findUserByAnyId(req.params.id);
    if (!u) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const endAt = computeEndDate(req.body?.periodMonths);
    u.subscriptionStatus = 'active';
    u.subscriptionEndAt = endAt;
    await u.save();

    res.json({ ok: true, user: u });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Renouveler un abonnement
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const u = await findUserByAnyId(req.params.id);
    if (!u) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const base = u.subscriptionEndAt && new Date(u.subscriptionEndAt) > new Date()
      ? new Date(u.subscriptionEndAt)
      : new Date();
    const months = Math.max(1, parseInt(req.body?.periodMonths, 10) || 1);
    base.setMonth(base.getMonth() + months);

    u.subscriptionStatus = 'active';
    u.subscriptionEndAt = base;
    await u.save();

    res.json({ ok: true, user: u });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Annuler un abonnement
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const u = await findUserByAnyId(req.params.id);
    if (!u) return res.status(404).json({ message: 'Utilisateur introuvable' });

    u.subscriptionStatus = 'none';
    u.subscriptionEndAt = null;
    await u.save();

    res.json({ ok: true, user: u });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

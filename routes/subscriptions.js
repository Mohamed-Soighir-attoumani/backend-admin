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

  // 1) ObjectId direct
  if (isValidId(id)) {
    const byId = await User.findById(id);
    if (byId) return byId;
  }
  // 2) 24-hex extrait
  const m = String(id).match(/[a-f0-9]{24}/i);
  if (m && isValidId(m[0])) {
    const byHex = await User.findById(m[0]);
    if (byHex) return byHex;
  }
  // 3) email
  const byEmail = await User.findOne({ email: String(id).trim().toLowerCase() });
  if (byEmail) return byEmail;
  // 4) userId
  const byUserId = await User.findOne({ userId: id });
  if (byUserId) return byUserId;

  return null;
}

/* Plans (optionnel) */
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

/* Start */
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

    res.json({ ok: true, user: user.toJSON(), planId, periodMonths: months });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* Renew */
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { planId = 'basic', periodMonths = 1 } = req.body || {};
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const base =
      user.subscriptionEndAt && user.subscriptionEndAt > new Date()
        ? new Date(user.subscriptionEndAt)
        : new Date();
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    base.setMonth(base.getMonth() + months);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = base;
    await user.save();

    res.json({ ok: true, user: user.toJSON(), planId, periodMonths: months });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* Cancel */
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    user.subscriptionStatus = 'none';
    user.subscriptionEndAt = null;
    await user.save();

    res.json({ ok: true, user: user.toJSON() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

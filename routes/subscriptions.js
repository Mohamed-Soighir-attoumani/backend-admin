// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const norm = (v) => String(v || '').trim().toLowerCase();

function cleanCandidate(v) {
  if (v == null) return '';
  let s = String(v).trim();
  s = s.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
  try { s = decodeURIComponent(s); } catch {}
  return s;
}

async function findUserByAnyId(primary, body = {}) {
  const candidatesRaw = [
    primary,
    body.id,
    body.userId,
    body._id,
    body._idString,
    body.email,
    body.queryId,
  ];

  if (primary && typeof primary === 'object') {
    candidatesRaw.push(primary.id, primary._id, primary._idString, primary.email);
  }

  const candidates = candidatesRaw.map(cleanCandidate).filter(Boolean);

  for (const s of candidates) {
    if (isValidId(s)) {
      const byId = await User.findById(s);
      if (byId) return byId;
    }
    const m = s.match(/[a-f0-9]{24}/i);
    if (m && isValidId(m[0])) {
      const byHex = await User.findById(m[0]);
      if (byHex) return byHex;
    }
    if (s.includes('@')) {
      const byEmail = await User.findOne({ email: norm(s) });
      if (byEmail) return byEmail;
    }
    const byUserId = await User.findOne({ userId: s });
    if (byUserId) return byUserId;
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

// Démarrer un abonnement
router.post('/subscriptions/:id/start', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    const end = new Date();
    end.setMonth(end.getMonth() + months);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = end;
    await user.save();

    res.json({ ok: true, user: { ...user.toObject(), _idString: String(user._id) } });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Renouveler
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);

    const base = user.subscriptionEndAt && user.subscriptionEndAt > new Date()
      ? new Date(user.subscriptionEndAt)
      : new Date();
    base.setMonth(base.getMonth() + months);

    user.subscriptionStatus = 'active';
    user.subscriptionEndAt = base;
    await user.save();

    res.json({ ok: true, user: { ...user.toObject(), _idString: String(user._id) } });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Annuler
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await findUserByAnyId(req.params.id, req.body);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    user.subscriptionStatus = 'none';
    user.subscriptionEndAt = null;
    await user.save();

    res.json({ ok: true, user: { ...user.toObject(), _idString: String(user._id) } });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

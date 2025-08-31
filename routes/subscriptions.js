// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');

// Modèle Admin optionnel
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const decode = (v) => { try { return decodeURIComponent(String(v)); } catch { return String(v); } };
const norm = (v) => String(v || '').trim().toLowerCase();

/** Résout User OU Admin par id/email/userId */
async function findAccountByAnyId(primary, body = {}) {
  const candidates = [
    decode(primary),
    decode(body._id),
    decode(body.id),
    decode(body.userId),
    norm(body.email || ''),
  ].filter(Boolean);

  for (const raw of candidates) {
    const s = String(raw).trim();
    if (!s) continue;

    if (isValidId(s)) {
      let hit = await User.findById(s);
      if (!hit && Admin) hit = await Admin.findById(s);
      if (hit) return hit;
    }
    const m = s.match(/[a-f0-9]{24}/i);
    if (m && isValidId(m[0])) {
      let hit = await User.findById(m[0]);
      if (!hit && Admin) hit = await Admin.findById(m[0]);
      if (hit) return hit;
    }
    if (s.includes('@')) {
      let hit = await User.findOne({ email: norm(s) });
      if (!hit && Admin) hit = await Admin.findOne({ email: norm(s) });
      if (hit) return hit;
    }
    let hit = await User.findOne({ userId: s });
    if (!hit && Admin) hit = await Admin.findOne({ userId: s });
    if (hit) return hit;
  }
  return null;
}

/* ===================== PLANS (exemple) ===================== */
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic',   name: 'Basic',   price:  9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro',     name: 'Pro',     price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

/* ===================== START ===================== */
router.post('/subscriptions/:id/start', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const account = await findAccountByAnyId(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);

    const end = new Date();
    end.setMonth(end.getMonth() + months);

    account.subscriptionStatus = 'active';
    account.subscriptionEndAt = end;
    await account.save();

    res.json({ ok: true, user: account.toObject() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/start', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== RENEW ===================== */
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const account = await findAccountByAnyId(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const { periodMonths = 1 } = req.body || {};
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);

    const base = account.subscriptionEndAt && account.subscriptionEndAt > new Date()
      ? new Date(account.subscriptionEndAt)
      : new Date();
    base.setMonth(base.getMonth() + months);

    account.subscriptionStatus = 'active';
    account.subscriptionEndAt = base;
    await account.save();

    res.json({ ok: true, user: account.toObject() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ===================== CANCEL ===================== */
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const account = await findAccountByAnyId(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: 'Utilisateur introuvable' });

    account.subscriptionStatus = 'none';
    account.subscriptionEndAt = null;
    await account.save();

    res.json({ ok: true, user: account.toObject() });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

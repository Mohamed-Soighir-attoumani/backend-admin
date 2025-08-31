// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

/** Trouve un compte dans User ou Admin, par id/$oid/24hex/email/userId */
async function findAccount(id) {
  if (!id) return null;

  const raw = String(id).trim();

  // 1) ObjectId direct
  if (isValidId(raw)) {
    const u = await User.findById(raw);
    if (u) return { doc: u, model: 'User' };
    if (Admin) {
      const a = await Admin.findById(raw);
      if (a) return { doc: a, model: 'Admin' };
    }
  }

  // 2) 24-hex dans chaîne
  const m = raw.match(/[a-f0-9]{24}/i);
  if (m && isValidId(m[0])) {
    const u2 = await User.findById(m[0]);
    if (u2) return { doc: u2, model: 'User' };
    if (Admin) {
      const a2 = await Admin.findById(m[0]);
      if (a2) return { doc: a2, model: 'Admin' };
    }
  }

  // 3) email
  if (raw.includes('@')) {
    const um = await User.findOne({ email: raw.toLowerCase() });
    if (um) return { doc: um, model: 'User' };
    if (Admin) {
      const am = await Admin.findOne({ email: raw.toLowerCase() });
      if (am) return { doc: am, model: 'Admin' };
    }
  }

  // 4) userId
  const uu = await User.findOne({ userId: raw });
  if (uu) return { doc: uu, model: 'User' };
  if (Admin) {
    const aa = await Admin.findOne({ userId: raw });
    if (aa) return { doc: aa, model: 'Admin' };
  }

  return null;
}

/* Plans */
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
    const found = await findAccount(id);
    if (!found) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    const end = new Date();
    end.setMonth(end.getMonth() + months);

    // On met ces champs même si modèle Admin ne les définit pas (ne bloque pas la réponse)
    found.doc.subscriptionStatus = 'active';
    found.doc.subscriptionEndAt = end;
    await found.doc.save();

    const plain = found.doc.toJSON ? found.doc.toJSON() : found.doc;
    res.json({ ok: true, user: plain, planId, periodMonths: months });
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
    const found = await findAccount(id);
    if (!found) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const base =
      found.doc.subscriptionEndAt && found.doc.subscriptionEndAt > new Date()
        ? new Date(found.doc.subscriptionEndAt)
        : new Date();
    const months = Math.max(1, parseInt(periodMonths, 10) || 1);
    base.setMonth(base.getMonth() + months);

    found.doc.subscriptionStatus = 'active';
    found.doc.subscriptionEndAt = base;
    await found.doc.save();

    const plain = found.doc.toJSON ? found.doc.toJSON() : found.doc;
    res.json({ ok: true, user: plain, planId, periodMonths: months });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/renew', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* Cancel */
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const found = await findAccount(id);
    if (!found) return res.status(404).json({ message: 'Utilisateur introuvable' });

    found.doc.subscriptionStatus = 'none';
    found.doc.subscriptionEndAt = null;
    await found.doc.save();

    const plain = found.doc.toJSON ? found.doc.toJSON() : found.doc;
    res.json({ ok: true, user: plain });
  } catch (err) {
    console.error('❌ POST /subscriptions/:id/cancel', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

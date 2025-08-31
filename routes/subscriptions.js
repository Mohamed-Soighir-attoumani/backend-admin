// backend/routes/subscriptions.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// Plans disponibles (exemple)
router.get('/subscriptions/plans', auth, requireRole('superadmin'), (_req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 9.9, currency: 'EUR', period: 'mois' },
      { id: 'pro', name: 'Pro', price: 19.9, currency: 'EUR', period: 'mois' },
      { id: 'premium', name: 'Premium', price: 39.9, currency: 'EUR', period: 'mois' },
    ],
  });
});

router.post('/subscriptions/:id/start', auth, requireRole('superadmin'), (req, res) => {
  res.json({ ok: true, status: 'active' });
});
router.post('/subscriptions/:id/renew', auth, requireRole('superadmin'), (req, res) => {
  res.json({ ok: true, status: 'active' });
});
router.post('/subscriptions/:id/cancel', auth, requireRole('superadmin'), (req, res) => {
  res.json({ ok: true, status: 'none' });
});

module.exports = router;

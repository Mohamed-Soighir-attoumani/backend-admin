const express = require('express');
const router = express.Router();
const Device = require('../models/Device');

/* helper commun */
async function upsertDevice({ deviceId, platform, appVersion, ip }) {
  if (!deviceId) throw new Error('deviceId requis');

  const now = new Date();

  const update = {
    $setOnInsert: {
      deviceId,
      registeredAt: now,
    },
    $set: {
      platform: platform || null,
      appVersion: appVersion || null,
      lastSeen: now,
      lastIp: ip || null,
    },
  };

  // upsert + retourne doc
  return Device.findOneAndUpdate({ deviceId }, update, {
    new: true,
    upsert: true,
  });
}

/* ───────── POST /api/devices/register ───────── */
router.post('/register', async (req, res) => {
  try {
    const { deviceId, platform, appVersion } = req.body || {};
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;

    const doc = await upsertDevice({ deviceId, platform, appVersion, ip });
    const isNew = doc.registeredAt && (+doc.registeredAt === +doc.lastSeen);

    console.log(isNew ? `✅ Nouveau device: ${deviceId}` : `🔁 Device vu: ${deviceId}`);
    res.json({ success: true, device: doc, isNew });
  } catch (err) {
    console.error('❌ Erreur /devices/register :', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/* ───────── ALIAS POST /api/devices ───────── */
router.post('/', async (req, res) => {
  try {
    const { deviceId, platform, appVersion } = req.body || {};
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;

    const doc = await upsertDevice({ deviceId, platform, appVersion, ip });
    const isNew = doc.registeredAt && (+doc.registeredAt === +doc.lastSeen);

    console.log(isNew ? `✅ Nouveau device (alias): ${deviceId}` : `🔁 Device vu (alias): ${deviceId}`);
    res.json({ success: true, device: doc, isNew });
  } catch (err) {
    console.error('❌ Erreur /devices (alias) :', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/* ───────── GET /api/devices/count ───────── */
router.get('/count', async (_req, res) => {
  try {
    const count = await Device.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error('❌ Erreur count devices :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ───────── GET /api/devices ───────── */
router.get('/', async (_req, res) => {
  try {
    const all = await Device.find().sort({ lastSeen: -1 });
    res.json(all);
  } catch (err) {
    console.error('❌ Erreur récupération devices :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ───────── GET /api/devices/recent?days=7 ───────── */
router.get('/recent', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days || '7', 10));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recent = await Device.find({ lastSeen: { $gte: since } }).sort({ lastSeen: -1 });
    res.json(recent);
  } catch (err) {
    console.error('❌ Erreur recent devices :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

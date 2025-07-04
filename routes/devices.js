const express = require('express');
const router = express.Router();
const Device = require('../models/Device');

/* ──────────────── POST /api/devices/register ──────────────── */
router.post('/register', async (req, res) => {
  const { deviceId, platform, appVersion } = req.body;

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId requis' });
  }

  try {
    let device = await Device.findOne({ deviceId });

    if (!device) {
      device = new Device({
        deviceId,
        platform,
        appVersion,
        registeredAt: new Date(),
      });
      await device.save();
      console.log('✅ Nouveau device enregistré :', deviceId);
    } else {
      console.log('ℹ️ Device déjà existant :', deviceId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur backend :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── ALIAS POST /api/devices (pour compatibilité mobile) ──────────────── */
router.post('/', async (req, res) => {
  const { deviceId, platform, appVersion } = req.body;

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId requis' });
  }

  try {
    let device = await Device.findOne({ deviceId });

    if (!device) {
      device = new Device({
        deviceId,
        platform,
        appVersion,
        registeredAt: new Date(),
      });
      await device.save();
      console.log('✅ Nouveau device enregistré via /api/devices :', deviceId);
    } else {
      console.log('ℹ️ Device déjà existant via /api/devices :', deviceId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur backend (alias):', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/devices/count ──────────────── */
router.get('/count', async (req, res) => {
  try {
    const count = await Device.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error('❌ Erreur count devices :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/devices (liste complète pour debug/admin) ──────────────── */
router.get('/', async (req, res) => {
  try {
    const all = await Device.find().sort({ registeredAt: -1 });
    res.json(all);
  } catch (err) {
    console.error('❌ Erreur récupération devices :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

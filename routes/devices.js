const express = require('express');
const router = express.Router();
const Device = require('../models/Device');

// POST /api/devices/register
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

// GET /api/devices/count
router.get('/count', async (req, res) => {
  try {
    const count = await Device.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error('❌ Erreur count devices :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// GET /api/devices (optionnel debug)
router.get('/', async (req, res) => {
  const all = await Device.find();
  res.json(all);
});

module.exports = router;

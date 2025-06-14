// backend/routes/devices.js
const express = require('express');
const router = express.Router();
const Device = require('../models/Device');

// 👉 POST /api/devices/register
router.post('/register', async (req, res) => {
  const { deviceId, platform, appVersion } = req.body;

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId requis' });
  }

  try {
    // Vérifie si déjà enregistré
    let device = await Device.findOne({ deviceId });

    if (!device) {
      // Crée un nouveau device
      device = new Device({
        deviceId,
        platform,
        appVersion
      });
      await device.save();
      console.log(`✅ Nouveau device enregistré : ${deviceId}`);
    } else {
      console.log(`ℹ️ Device déjà enregistré : ${deviceId}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur enregistrement device:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// 👉 GET /api/devices/count
router.get('/count', async (req, res) => {
  try {
    const count = await Device.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error('Erreur récupération count devices:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

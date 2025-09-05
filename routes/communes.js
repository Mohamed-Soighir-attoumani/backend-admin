// backend/routes/communes.js
const express = require('express');
const router = express.Router();
const Commune = require('../models/Commune');

// GET /api/communes?search=
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.search || '').trim();
    const filt = { active: true };
    if (q) {
      filt.$or = [
        { name: new RegExp(q, 'i') },
        { slug: new RegExp(q, 'i') },
        { region: new RegExp(q, 'i') },
      ];
    }
    const list = await Commune.find(filt).sort({ name: 1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('❌ GET /communes', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Seed rapide Dembéni (optionnel dev)
router.post('/seed-dembeni', async (req, res) => {
  try {
    const exists = await Commune.findOne({ slug: 'dembeni' });
    if (exists) return res.json(exists);
    const doc = await Commune.create({
      name: 'Dembéni',
      slug: 'dembeni',
      region: 'Mayotte',
      imageUrl: '',
      active: true,
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /communes/seed-dembeni', err);
    res.status(500).json({ message: 'Erreur seed' });
  }
});

module.exports = router;

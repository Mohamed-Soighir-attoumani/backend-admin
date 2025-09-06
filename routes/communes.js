const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// GET /api/communes?search=...  (public)
router.get('/', async (req, res) => {
  try {
    const q = (req.query.search || '').trim();
    const filter = q
      ? { $or: [
          { name:   { $regex: q, $options: 'i' } },
          { id:     { $regex: q, $options: 'i' } },
          { region: { $regex: q, $options: 'i' } },
        ] }
      : {};
    const items = await Commune.find(filter).sort({ name: 1 }).lean();
    res.json(items);
  } catch (e) {
    console.error('GET /communes error', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST /api/communes (superadmin uniquement)
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id, name, region = '', imageUrl = '' } = req.body || {};
    if (!id || !name) return res.status(400).json({ message: 'id et name requis' });

    const doc = await Commune.create({ id: String(id).trim(), name: String(name).trim(), region, imageUrl });
    res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'Cette commune existe déjà' });
    console.error('POST /communes error', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// DELETE /api/communes/:id (superadmin)
router.delete('/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const id = (req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'id requis' });
    const deleted = await Commune.findOneAndDelete({ id });
    if (!deleted) return res.status(404).json({ message: 'Commune non trouvée' });
    res.json({ message: 'Supprimée' });
  } catch (e) {
    console.error('DELETE /communes error', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

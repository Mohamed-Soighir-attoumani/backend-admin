// backend/routes/communes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const Commune = require('../models/Commune');

function slugify(input) {
  return String(input || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                      // séparateurs
    .replace(/^-+|-+$/g, '')                          // bords
    .replace(/--+/g, '-');                            // doublons
}

/* Liste des communes */
router.get('/', auth, async (_req, res) => {
  const items = await Commune.find().sort({ name: 1 }).lean();
  res.json(items);
});

/* Création d'une commune (superadmin) */
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { name, label, communeName, code, region, imageUrl } = req.body || {};
    const display = String(name || label || communeName || '').trim();
    if (!display) return res.status(400).json({ message: 'Nom de la commune requis' });

    let slug = req.body.slug ? String(req.body.slug).trim() : '';
    if (!slug) slug = slugify(display);

    const exists = await Commune.findOne({ slug });
    if (exists) return res.status(409).json({ message: 'Une commune avec ce slug existe déjà' });

    const doc = await Commune.create({
      name: display,
      label: label || display,
      communeName: communeName || display,
      code: code || '',
      region: region || '',
      imageUrl: imageUrl || '',
      slug,
    });

    res.status(201).json(doc);
  } catch (e) {
    console.error('POST /communes', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* Edition (superadmin) */
router.put('/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const updates = {};
    const { name, label, communeName, code, region, imageUrl, slug } = req.body || {};

    if (name) updates.name = String(name).trim();
    if (label) updates.label = String(label).trim();
    if (communeName) updates.communeName = String(communeName).trim();
    if (code != null) updates.code = String(code).trim();
    if (region != null) updates.region = String(region).trim();
    if (imageUrl != null) updates.imageUrl = String(imageUrl).trim();

    // slug : soit fourni, soit régénéré depuis le "meilleur" nom
    const basis = updates.name || updates.label || updates.communeName || name || label || communeName || '';
    if (slug) {
      updates.slug = String(slug).trim().toLowerCase();
    } else if (basis) {
      updates.slug = slugify(basis);
    }

    if (updates.slug) {
      const dup = await Commune.findOne({ slug: updates.slug, _id: { $ne: req.params.id } });
      if (dup) return res.status(409).json({ message: 'Slug déjà utilisé par une autre commune' });
    }

    const updated = await Commune.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Commune introuvable' });

    res.json(updated);
  } catch (e) {
    console.error('PUT /communes/:id', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* Suppression (superadmin) */
router.delete('/:id', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const deleted = await Commune.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Commune introuvable' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /communes/:id', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

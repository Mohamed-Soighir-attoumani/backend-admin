// backend/routes/communeRoutes.js
const express = require('express');
const router = express.Router();
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// util
const norm = (v) => String(v || '').trim().toLowerCase();
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ========== PUBLIC: liste des communes (utilisé par l’app mobile) ==========
router.get('/communes', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const find = { $or: [{ active: { $exists: false } }, { active: { $ne: false } }] };

    if (q) {
      const rx = new RegExp(escapeRegExp(String(q)), 'i');
      find.$or = [
        ...find.$or,
        { name: rx }, { label: rx }, { communeName: rx }, { slug: rx }, { code: rx }, { region: rx },
      ];
    }

    const items = await Commune.find(find)
      .select({ name:1, label:1, communeName:1, code:1, region:1, imageUrl:1, slug:1 })
      .sort({ name: 1 })
      .lean();

    // réponses non-cachées pour que l’app voie immédiatement les nouvelles communes
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.json(items);
  } catch (e) {
    console.error('GET /communes', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ========== ADMIN: liste complète (panel) ==========
router.get('/api/communes', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const items = await Commune.find().sort({ name: 1 }).lean();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ items, total: items.length });
  } catch (e) {
    console.error('GET /api/communes', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ========== ADMIN: création/modif rapide (optionnelle) ==========
router.post('/api/communes', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const { name = '', slug = '', code = '', region = '', imageUrl = '', active = true } = req.body || {};
    const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const slugify = (s) =>
      strip(String(s || ''))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/--+/g, '-');

    const base = slug || name;
    if (!base) return res.status(400).json({ message: 'Nom ou slug requis' });

    const baseSlug = slugify(base) || `commune-${Date.now()}`;
    let finalSlug = baseSlug;
    let i = 1;
    while (await Commune.findOne({ slug: finalSlug }).lean()) {
      i += 1;
      finalSlug = `${baseSlug}-${i}`;
    }

    const doc = await Commune.create({
      name: name || base,
      label: name || base,
      communeName: name || base,
      code,
      region,
      imageUrl,
      slug: finalSlug,
      active: !!active,
    });
    res.status(201).json(doc);
  } catch (e) {
    console.error('POST /api/communes', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

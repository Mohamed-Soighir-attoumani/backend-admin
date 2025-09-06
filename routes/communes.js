// backend/routes/communes.js
const express = require('express');
const router = express.Router();
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// Base: ce router sera monté sur /api/communes
// donc ici on expose '/' | '/:mongoId' | '/seed' etc.

// --------- GET public: liste + recherche ---------
router.get('/', async (req, res) => {
  try {
    const q = (req.query.search || '').trim();
    const filter = q
      ? {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { communeName: { $regex: q, $options: 'i' } },
            { id: { $regex: q, $options: 'i' } },
            { slug: { $regex: q, $options: 'i' } },
            { code: { $regex: q, $options: 'i' } },
          ],
        }
      : {};

    const communes = await Commune.find(filter)
      .select('_id id slug code name communeName region imageUrl photo createdAt')
      .sort({ name: 1 })
      .lean();

    res.json(communes); // renvoie un tableau
  } catch (e) {
    console.error('GET /api/communes error:', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- GET public: par id mongo (optionnel) ---------
router.get('/:mongoId', async (req, res) => {
  try {
    const c = await Commune.findById(req.params.mongoId).lean();
    if (!c) return res.status(404).json({ message: 'Commune introuvable' });
    res.json(c);
  } catch (e) {
    res.status(400).json({ message: 'ID invalide' });
  }
});

// --------- CREATE (superadmin) ---------
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { id, name, communeName, slug, code, region, imageUrl, photo } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name requis' });

    const norm = (v) => (v || '').toString().trim();
    const normId = norm(id || slug || name).toLowerCase().replace(/\s+/g, '-');

    const created = await Commune.create({
      id: normId,
      slug: norm(slug) || normId, // <= on force slug=id si vide
      code: norm(code),
      name: norm(name),
      communeName: norm(communeName || name),
      region: norm(region),
      imageUrl: norm(imageUrl),
      photo: norm(photo),
      createdById: req.user?.id || '',
      createdByEmail: req.user?.email || '',
    });

    res.status(201).json(created);
  } catch (e) {
    console.error('POST /api/communes', e);
    if (e.code === 11000) return res.status(409).json({ message: 'id déjà utilisé' });
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- UPDATE (superadmin) ---------
router.patch('/:mongoId', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const payload = {};
    const setIf = (k, v) => { if (v !== undefined) payload[k] = (''+v).trim(); };

    ['id','slug','code','name','communeName','region','imageUrl','photo'].forEach(k => {
      if (req.body[k] !== undefined) setIf(k, req.body[k]);
    });

    if (payload.id) {
      payload.id = payload.id.toLowerCase().replace(/\s+/g, '-');
      if (!payload.slug) payload.slug = payload.id; // garder cohérent
    }
    if (payload.slug) payload.slug = payload.slug.toLowerCase().replace(/\s+/g, '-');

    const updated = await Commune.findByIdAndUpdate(
      req.params.mongoId,
      { $set: payload },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Commune introuvable' });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /api/communes/:id', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- DELETE (superadmin) ---------
router.delete('/:mongoId', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const r = await Commune.deleteOne({ _id: req.params.mongoId });
    if (!r.deletedCount) return res.status(404).json({ message: 'Commune introuvable' });
    res.json({ message: 'Commune supprimée' });
  } catch (e) {
    console.error('DELETE /api/communes/:id', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- SEED rapide (superadmin) ---------
router.post('/seed', auth, requireRole('superadmin'), async (_req, res) => {
  try {
    const samples = [
      { id: 'dembeni',   name: 'Dembéni',   region: 'Mayotte', imageUrl: '/uploads/communes/dembeni.jpg' },
      { id: 'mamoudzou', name: 'Mamoudzou', region: 'Mayotte', imageUrl: '/uploads/communes/mamoudzou.jpg' },
      { id: 'chirongui', name: 'Chirongui', region: 'Mayotte', imageUrl: '/uploads/communes/chirongui.jpg' },
    ];

    for (const s of samples) {
      await Commune.updateOne(
        { id: s.id },
        { $setOnInsert: { ...s, slug: s.id } }, // slug=id
        { upsert: true }
      );
    }
    const all = await Commune.find().sort({ name: 1 }).lean();
    res.status(201).json(all);
  } catch (e) {
    console.error('POST /api/communes/seed', e);
    res.status(500).json({ message: 'Erreur seed' });
  }
});

module.exports = router;

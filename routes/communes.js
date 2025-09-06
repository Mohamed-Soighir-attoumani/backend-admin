// backend/routes/communes.js
const express = require('express');
const router = express.Router();
const Commune = require('../models/Commune');
const User = require('../models/User'); // <- on lit les admins pour déduire les communes
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

/* Utils */
const toKey = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

const normalizeCommuneFromAdminGroup = (g) => {
  const id = toKey(g._id || g.communeId || '');
  const name =
    g.name ||
    g.communeName ||
    (g._id ? g._id.charAt(0).toUpperCase() + g._id.slice(1) : 'Commune');
  return {
    _source: 'admins',
    _id: id,               // pas un ObjectId: juste une clé d’affichage
    id,
    slug: id,
    code: '',
    name,
    communeName: name,
    region: '',
    imageUrl: '',          // pas d’image côté admins: reste vide
    photo: '',
    createdAt: null,
  };
};

const normalizeCommuneDoc = (c) => ({
  _source: 'collection',
  _id: String(c._id || c.id || c.slug || c.code || c.name || ''),
  id: c.id || toKey(c.slug || c.code || c.name || ''),
  slug: c.slug || toKey(c.id || c.code || c.name || ''),
  code: c.code || '',
  name: c.name || c.communeName || 'Commune',
  communeName: c.communeName || c.name || 'Commune',
  region: c.region || '',
  imageUrl: c.imageUrl || '',
  photo: c.photo || '',
  createdAt: c.createdAt || null,
});

/**
 * Retourne l’union:
 *  - des communes “officielles” (collection Commune)
 *  - des communes déduites des admins (User.role='admin' avec communeId)
 * Filtre optionnel ?search=...
 */
router.get('/', async (req, res) => {
  try {
    const q = (req.query.search || '').trim();
    const rx = q ? new RegExp(q, 'i') : null;

    // 1) communes depuis la collection
    const filter = q
      ? {
          $or: [
            { name: rx },
            { communeName: rx },
            { id: rx },
            { slug: rx },
            { code: rx },
            { region: rx },
          ],
        }
      : {};
    const fromCollectionRaw = await Commune.find(filter)
      .select('_id id slug code name communeName region imageUrl photo createdAt')
      .sort({ name: 1 })
      .lean();
    const fromCollection = fromCollectionRaw.map(normalizeCommuneDoc);

    // 2) communes déduites des admins
    const pipeline = [
      { $match: { role: 'admin', communeId: { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$communeId',
          name: { $first: '$communeName' },
        },
      },
    ];
    const groups = await User.aggregate(pipeline);
    let fromAdmins = groups.map(normalizeCommuneFromAdminGroup);

    // si ?search, filtre aussi côté admins
    if (rx) {
      fromAdmins = fromAdmins.filter(
        (c) => rx.test(c.name) || rx.test(c.communeName) || rx.test(c.id) || rx.test(c.slug)
      );
    }

    // 3) union sans doublons (clé = id)
    const byId = new Map();
    // priorité à la collection (visuels, etc.)
    for (const c of fromAdmins) byId.set(c.id, c);
    for (const c of fromCollection) byId.set(c.id, c);

    // tableau final ordonné par nom
    const items = Array.from(byId.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' })
    );

    res.json(items);
  } catch (e) {
    console.error('GET /api/communes error:', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* =========== Endpoints d’admin (facultatifs) =========== */

/** CREATE (superadmin) — utile si tu veux enrichir avec image/region/etc. */
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let { id, name, communeName, slug, code, region, imageUrl, photo } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name requis' });

    const normId = toKey(id || slug || name);
    const doc = await Commune.create({
      id: normId,
      slug: toKey(slug || normId),
      code: (code || '').trim(),
      name: (name || '').trim(),
      communeName: (communeName || name || '').trim(),
      region: (region || '').trim(),
      imageUrl: (imageUrl || '').trim(),
      photo: (photo || '').trim(),
      createdById: req.user?.id || '',
      createdByEmail: req.user?.email || '',
    });

    res.status(201).json(normalizeCommuneDoc(doc));
  } catch (e) {
    console.error('POST /api/communes', e);
    if (e.code === 11000) return res.status(409).json({ message: 'id déjà utilisé' });
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** UPDATE (superadmin) */
router.patch('/:mongoId', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const payload = {};
    const setIf = (k, v) => {
      if (v !== undefined) payload[k] = String(v).trim();
    };

    ['id', 'slug', 'code', 'name', 'communeName', 'region', 'imageUrl', 'photo'].forEach((k) => {
      if (req.body[k] !== undefined) setIf(k, req.body[k]);
    });

    if (payload.id) payload.id = toKey(payload.id);
    if (payload.slug) payload.slug = toKey(payload.slug);
    if (!payload.slug && payload.id) payload.slug = payload.id;

    const updated = await Commune.findByIdAndUpdate(
      req.params.mongoId,
      { $set: payload },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Commune introuvable' });
    res.json(normalizeCommuneDoc(updated));
  } catch (e) {
    console.error('PATCH /api/communes/:id', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** DELETE (superadmin) */
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

module.exports = router;

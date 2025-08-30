// backend/routes/infos.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Info = require('../models/Info');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { buildVisibilityQuery } = require('../utils/visibility');

const multer = require('multer');
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

/** Auth optionnelle: pour la liste (panel/public) */
function optionalAuth(req, _res, next) {
  const authz = req.header('authorization') || '';
  if (authz.startsWith('Bearer ')) {
    const token = authz.slice(7).trim();
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        role: payload.role,
        communeId: payload.communeId || '',
        email: payload.email || '',
        id: payload.id ? String(payload.id) : '',
      };
    } catch (_) {}
  }
  next();
}

/* ============ CREATE (panel) ============ */
router.post('/', auth, requireRole('admin'), upload.single('image'), async (req, res) => {
  try {
    let {
      title, content, category,
      visibility, communeId, audienceCommunes,
      priority, startAt, endAt,
      locationName, locationAddress, locationLat, locationLng,
    } = req.body || {};

    if (!title || !content) return res.status(400).json({ message: 'Titre et contenu requis' });

    // normalisations
    title   = String(title).trim();
    content = String(content).trim();
    if (!['sante','proprete','autres'].includes(category)) category = 'sante';
    if (!['normal','pinned','urgent'].includes(priority)) priority = 'normal';

    const toDateOrNull = (v) => (v ? new Date(v) : null);

    const base = {
      title, content, category,
      imageUrl: req.file ? req.file.path : null,
      visibility: 'local',
      communeId: req.user.communeId || '',
      audienceCommunes: [],
      priority,
      startAt: toDateOrNull(startAt),
      endAt:   toDateOrNull(endAt),
      location: {
        name:    (locationName || '').trim(),
        address: (locationAddress || '').trim(),
        lat:     locationLat ? Number(locationLat) : null,
        lng:     locationLng ? Number(locationLng) : null,
      },
      authorId: req.user.id,
      authorEmail: req.user.email,
    };

    // superadmin peut publier global/custom ou sur une autre commune
    if (req.user.role === 'superadmin') {
      if (visibility && ['local','global','custom'].includes(visibility)) base.visibility = visibility;
      if (base.visibility === 'local') {
        base.communeId = String(communeId || '').trim();
        if (!base.communeId) return res.status(400).json({ message: 'communeId requis pour visibility=local' });
      } else if (base.visibility === 'custom') {
        base.communeId = '';
        base.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      // admin classique : forcément local et rattaché à SA commune
      if (!base.communeId) return res.status(403).json({ message: 'Compte non rattaché à une commune' });
    }

    const created = await Info.create(base);
    res.status(201).json(created);
  } catch (err) {
    console.error('❌ POST /infos', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ============ LIST (publique + panel) ============ */
/**
 * - ?category=sante|proprete|autres (optionnel)
 * - ?period=7|30 (optionnel)
 * - multi-commune: header x-commune-id ou ?communeId=
 * - public = respecte la fenêtre startAt/endAt ; panel (admin/superadmin) = ignore
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, period } = req.query;

    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid || '';

    const userRole = req.user?.role || null;

    const filter = buildVisibilityQuery({
      communeId,
      userRole,
      // panel (admin/superadmin) doit voir tout, même hors fenêtre temporelle
      ignoreTimeWindow: !!userRole,
    });

    if (category && ['sante','proprete','autres'].includes(category)) {
      filter.category = category;
    }

    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
    }

    // Inclure legacy (au cas où) : pas nécessaire ici car nouveau modèle,
    // mais on reste souple:
    // (rien à ajouter)

    const items = await Info.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(items);
  } catch (err) {
    console.error('❌ GET /infos', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ============ UPDATE (panel) ============ */
router.patch('/:id', auth, requireRole('admin'), upload.single('image'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const current = await Info.findById(id);
    if (!current) return res.status(404).json({ message: 'Info non trouvée' });

    // Admin: ne peut modifier QUE ses propres infos + dans SA commune (si local)
    if (req.user.role === 'admin') {
      const own = current.authorId && current.authorId === req.user.id;
      const sameCommune = current.visibility !== 'local' || current.communeId === (req.user.communeId || '');
      if (!own || !sameCommune) {
        return res.status(403).json({ message: 'Interdit (vous n’êtes pas l’auteur ou mauvaise commune)' });
      }
    }

    const payload = {};
    const setIf = (k, v) => { if (v !== undefined) payload[k] = v; };

    // Champs simples
    if (typeof req.body.title === 'string')   setIf('title',   req.body.title.trim());
    if (typeof req.body.content === 'string') setIf('content', req.body.content.trim());
    if (['sante','proprete','autres'].includes(req.body.category)) setIf('category', req.body.category);
    if (['normal','pinned','urgent'].includes(req.body.priority))  setIf('priority', req.body.priority);

    // Image (remplacement)
    if (req.file) setIf('imageUrl', req.file.path);

    // Dates
    const toDateOrNull = (v) => (v ? new Date(v) : null);
    if ('startAt' in req.body) setIf('startAt', toDateOrNull(req.body.startAt));
    if ('endAt'   in req.body) setIf('endAt',   toDateOrNull(req.body.endAt));

    // Localisation
    const loc = {};
    if ('locationName'    in req.body) loc.name    = (req.body.locationName    || '').trim();
    if ('locationAddress' in req.body) loc.address = (req.body.locationAddress || '').trim();
    if ('locationLat'     in req.body) loc.lat     = req.body.locationLat ? Number(req.body.locationLat) : null;
    if ('locationLng'     in req.body) loc.lng     = req.body.locationLng ? Number(req.body.locationLng) : null;
    if (Object.keys(loc).length) setIf('location', { ...current.location?.toObject?.() ?? {}, ...loc });

    // superadmin: peut changer la portée
    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body || {};
      if (visibility && ['local','global','custom'].includes(visibility)) {
        payload.visibility = visibility;
        if (visibility === 'local') {
          payload.communeId = String(communeId || '').trim();
          payload.audienceCommunes = [];
          if (!payload.communeId) return res.status(400).json({ message: 'communeId requis pour visibility=local' });
        } else if (visibility === 'custom') {
          payload.communeId = '';
          payload.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
        } else if (visibility === 'global') {
          payload.communeId = '';
          payload.audienceCommunes = [];
        }
      }
    }

    const updated = await Info.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PATCH /infos/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ============ DELETE (panel) ============ */
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const current = await Info.findById(id);
    if (!current) return res.status(404).json({ message: 'Info non trouvée' });

    if (req.user.role === 'admin') {
      const own = current.authorId && current.authorId === req.user.id;
      const sameCommune = current.visibility !== 'local' || current.communeId === (req.user.communeId || '');
      if (!own || !sameCommune) {
        return res.status(403).json({ message: 'Interdit (vous n’êtes pas l’auteur ou mauvaise commune)' });
      }
    }

    await Info.deleteOne({ _id: id });
    res.json({ message: 'Info supprimée avec succès' });
  } catch (err) {
    console.error('❌ DELETE /infos/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

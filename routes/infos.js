// backend/routes/infos.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Info = require('../models/Info');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const multer = require('multer');
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

// ───────────────────────── helpers ─────────────────────────
const normCid = (v) => String(v || '').trim().toLowerCase();

function optionalAuth(req, _res, next) {
  const authz = req.header('authorization') || '';
  if (authz.startsWith('Bearer ')) {
    const token = authz.slice(7).trim();
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
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

function adminCanSeeDoc(doc, adminCommuneId) {
  if (!doc) return false;
  const cid = normCid(adminCommuneId);
  if (!cid) return false;

  if (doc.visibility === 'local')  return normCid(doc.communeId) === cid;
  if (doc.visibility === 'custom') return Array.isArray(doc.audienceCommunes) && doc.audienceCommunes.includes(cid);
  if (doc.visibility === 'global') return true;
  return false;
}

function publicCanSeeDoc(doc, cid) {
  if (!doc) return false;

  const now = new Date();
  const okStart = !doc.startAt || doc.startAt <= now;
  const okEnd   = !doc.endAt   || doc.endAt   >= now;
  if (!okStart || !okEnd) return false;

  const communeId = normCid(cid);
  if (doc.visibility === 'global') return true;
  if (doc.visibility === 'local')  return !!communeId && normCid(doc.communeId) === communeId;
  if (doc.visibility === 'custom') return !!communeId && Array.isArray(doc.audienceCommunes) && doc.audienceCommunes.includes(communeId);
  return false;
}

// ───────────────────────── CREATE (panel) ─────────────────────────
// Autoriser admin ET superadmin + fournir un alias POST /create (évite 404 côté front)
async function handleCreate(req, res) {
  try {
    let {
      title, content, category,
      visibility, communeId, audienceCommunes,
      priority, startAt, endAt,
      locationName, locationAddress, locationLat, locationLng,
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ message: 'Titre et contenu requis' });
    }

    // normalisations
    title   = String(title).trim();
    content = String(content).trim();
    if (!['sante','proprete','autres'].includes(category)) category = 'sante';
    if (!['normal','pinned','urgent'].includes(priority))  priority  = 'normal';

    const toDateOrNull = (v) => (v ? new Date(v) : null);

    const base = {
      title, content, category,
      imageUrl: req.file ? req.file.path : null,
      visibility: 'local',
      communeId: normCid(req.user.communeId || ''),
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

    // superadmin : peut choisir la portée et la/les communes
    if (req.user.role === 'superadmin') {
      if (visibility && ['local','global','custom'].includes(visibility)) {
        base.visibility = visibility;
      }
      if (base.visibility === 'local') {
        base.communeId = normCid(communeId);
        if (!base.communeId) {
          return res.status(400).json({ message: 'communeId requis pour visibility=local' });
        }
        base.audienceCommunes = [];
      } else if (base.visibility === 'custom') {
        base.communeId = '';
        const arr = Array.isArray(audienceCommunes) ? audienceCommunes : [];
        base.audienceCommunes = arr.map(normCid).filter(Boolean);
      } else { // global
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      // admin : forcé local sur SA commune
      if (!base.communeId) {
        return res.status(403).json({ message: 'Compte non rattaché à une commune' });
      }
    }

    const created = await Info.create(base);
    res.status(201).json(created);
  } catch (err) {
    console.error('❌ POST /infos', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

router.post('/',       auth, requireRole(['admin','superadmin']), upload.single('image'), handleCreate);
router.post('/create', auth, requireRole(['admin','superadmin']), upload.single('image'), handleCreate);

// ───────────────────────── LIST (publique + panel) ─────────────────────────
/**
 * Query:
 *  - ?category=sante|proprete|autres (optionnel)
 *  - ?period=7|30 (optionnel)
 *  - multi-commune: header x-commune-id ou ?communeId=
 * Public => respecte startAt/endAt ; Panel (admin/superadmin) => ignore fenêtre temporelle
 * Admin => forcé sur sa commune, pas d’override via header/query
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, period } = req.query;

    const role = req.user?.role || null;
    const isPanel = role === 'admin' || role === 'superadmin';

    // Déterminer communeId à utiliser
    let communeId = '';
    if (role === 'admin') {
      communeId = normCid(req.user?.communeId || '');
      if (!communeId) {
        return res.status(403).json({ message: 'Compte admin non rattaché à une commune' });
      }
    } else {
      const headerCid = normCid(req.header('x-commune-id') || req.header('x-commune') || req.header('x-communeid') || '');
      const queryCid  = normCid(req.query?.communeId || req.query?.commune || '');
      communeId = headerCid || queryCid || '';
    }

    // Filtre visibilité
    const orClauses = [{ visibility: 'global' }];
    if (communeId) {
      orClauses.push({ visibility: 'local',  communeId });
      orClauses.push({ visibility: 'custom', audienceCommunes: { $in: [communeId] } });
    }

    // Legacy éventuel (documents anciens sans visibility) — on les mappe à la commune si fournie
    orClauses.push({
      $and: [
        { $or: [{ visibility: { $exists: false } }, { visibility: null }] },
        communeId
          ? { $or: [{ communeId }, { audienceCommunes: { $in: [communeId] } }] }
          : {},
      ].filter(Boolean),
    });

    const filter = { $or: orClauses };

    // Fenêtre d’affichage : seulement pour le public
    if (!isPanel) {
      const now = new Date();
      filter.$and = [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt:   null }, { endAt:   { $gte: now } }] },
      ];
    }

    // Catégorie
    if (category && ['sante','proprete','autres'].includes(category)) {
      filter.category = category;
    }

    // Période
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
    }

    const items = await Info.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(items);
  } catch (err) {
    console.error('❌ GET /infos', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ───────────────────────── DETAIL (publique + panel) ─────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const doc = await Info.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Info introuvable' });

    const role = req.user?.role || null;

    if (role === 'superadmin') {
      res.set('Cache-Control', 'no-store');
      return res.json(doc);
    }

    if (role === 'admin') {
      const ok = adminCanSeeDoc(doc, req.user?.communeId);
      if (!ok) return res.status(404).json({ message: 'Info introuvable' });
      res.set('Cache-Control', 'no-store');
      return res.json(doc);
    }

    // Public
    const cid = normCid(req.header('x-commune-id') || req.query?.communeId || '');
    const ok = publicCanSeeDoc(doc, cid);
    if (!ok) return res.status(404).json({ message: 'Info introuvable' });

    res.set('Cache-Control', 'no-store');
    res.json(doc);
  } catch (err) {
    console.error('❌ GET /infos/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ───────────────────────── UPDATE (panel) ─────────────────────────
router.patch('/:id', auth, requireRole(['admin','superadmin']), upload.single('image'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Info.findById(id);
    if (!current) return res.status(404).json({ message: 'Info non trouvée' });

    // Admin : limiter au périmètre de sa commune (pas forcément auteur)
    if (req.user.role === 'admin') {
      const sameScope =
        current.visibility === 'global' ||
        (current.visibility === 'local'  && normCid(current.communeId) === normCid(req.user.communeId)) ||
        (current.visibility === 'custom' && Array.isArray(current.audienceCommunes) &&
         current.audienceCommunes.includes(normCid(req.user.communeId)));
      if (!sameScope) return res.status(403).json({ message: 'Interdit pour votre commune' });
    }

    const payload = {};
    const setIf = (k, v) => { if (v !== undefined) payload[k] = v; };

    if (typeof req.body.title === 'string')   setIf('title',   req.body.title.trim());
    if (typeof req.body.content === 'string') setIf('content', req.body.content.trim());
    if (['sante','proprete','autres'].includes(req.body.category)) setIf('category', req.body.category);
    if (['normal','pinned','urgent'].includes(req.body.priority))  setIf('priority', req.body.priority);
    if ('isRead' in req.body) setIf('isRead', !!req.body.isRead);

    if (req.file) setIf('imageUrl', req.file.path);

    const toDateOrNull = (v) => (v ? new Date(v) : null);
    if ('startAt' in req.body) setIf('startAt', toDateOrNull(req.body.startAt));
    if ('endAt'   in req.body) setIf('endAt',   toDateOrNull(req.body.endAt));

    // Localisation
    const loc = {};
    if ('locationName'    in req.body) loc.name    = (req.body.locationName    || '').trim();
    if ('locationAddress' in req.body) loc.address = (req.body.locationAddress || '').trim();
    if ('locationLat'     in req.body) loc.lat     = req.body.locationLat ? Number(req.body.locationLat) : null;
    if ('locationLng'     in req.body) loc.lng     = req.body.locationLng ? Number(req.body.locationLng) : null;
    if (Object.keys(loc).length) setIf('location', { ...(current.location || {}), ...loc });

    // superadmin : peut changer la portée
    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body || {};
      if (visibility && ['local','global','custom'].includes(visibility)) {
        payload.visibility = visibility;
        if (visibility === 'local') {
          payload.communeId = normCid(communeId);
          payload.audienceCommunes = [];
          if (!payload.communeId) {
            return res.status(400).json({ message: 'communeId requis pour visibility=local' });
          }
        } else if (visibility === 'custom') {
          payload.communeId = '';
          const arr = Array.isArray(audienceCommunes) ? audienceCommunes : [];
          payload.audienceCommunes = arr.map(normCid).filter(Boolean);
        } else { // global
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

// ───────────────────────── DELETE (panel) ─────────────────────────
router.delete('/:id', auth, requireRole(['admin','superadmin']), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Info.findById(id);
    if (!current) return res.status(404).json({ message: 'Info non trouvée' });

    if (req.user.role === 'admin') {
      const sameScope =
        current.visibility === 'global' ||
        (current.visibility === 'local'  && normCid(current.communeId) === normCid(req.user.communeId)) ||
        (current.visibility === 'custom' && Array.isArray(current.audienceCommunes) &&
         current.audienceCommunes.includes(normCid(req.user.communeId)));
      if (!sameScope) return res.status(403).json({ message: 'Interdit pour votre commune' });
    }

    await Info.deleteOne({ _id: id });
    res.json({ message: 'Info supprimée avec succès' });
  } catch (err) {
    console.error('❌ DELETE /infos/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

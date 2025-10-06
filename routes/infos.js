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

/** Auth optionnelle: pour la liste/détail (panel/public) */
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

/* ===== Utilitaires ===== */

function adminCanSeeDoc(doc, adminCommuneId) {
  if (!doc) return false;
  const cid = String(adminCommuneId || '').trim();
  if (!cid) return false;

  if (doc.visibility === 'local') {
    return String(doc.communeId || '') === cid;
  }
  if (doc.visibility === 'custom') {
    const aud = Array.isArray(doc.audienceCommunes) ? doc.audienceCommunes : [];
    return aud.includes(cid);
  }
  if (doc.visibility === 'global') {
    return true;
  }
  return false;
}

function publicCanSeeDoc(doc, cid) {
  if (!doc) return false;

  const now = new Date();
  const okStart = !doc.startAt || doc.startAt <= now;
  const okEnd   = !doc.endAt   || doc.endAt   >= now;
  if (!okStart || !okEnd) return false;

  const communeId = String(cid || '').trim();

  if (doc.visibility === 'global') return true;
  if (doc.visibility === 'local')  return !!communeId && String(doc.communeId || '') === communeId;
  if (doc.visibility === 'custom') {
    const aud = Array.isArray(doc.audienceCommunes) ? doc.audienceCommunes : [];
    return !!communeId && aud.includes(communeId);
  }
  return false;
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
 * - public = respecte startAt/endAt ; panel (admin/superadmin) = ignoreTimeWindow
 * - 🔒 admin = forcé à SA commune (pas d’override par header/query)
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, period } = req.query;

    const userRole = req.user?.role || null;
    let communeId = '';

    if (userRole === 'admin') {
      // 🔒 admin : forcer la commune à son propre rattachement
      communeId = String(req.user?.communeId || '').trim();
      if (!communeId) {
        return res.status(403).json({ message: 'Compte admin non rattaché à une commune' });
      }
    } else {
      // public ou superadmin : on accepte header/query
      const headerCid = (req.header('x-commune-id') || '').trim();
      const queryCid  = (req.query.communeId || '').trim();
      communeId = headerCid || queryCid || '';
    }

    const filter = buildVisibilityQuery({
      communeId,
      userRole,
      ignoreTimeWindow: !!userRole, // panel : ignore fenêtre ; public : respecte
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

    const items = await Info.find(filter).sort({ priority: -1, createdAt: -1 }).lean();

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json(items);
  } catch (err) {
    console.error('❌ GET /infos', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ============ DETAIL (publique + panel) ============ */
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
      // superadmin voit tout
      res.set('Cache-Control', 'no-store');
      return res.json(doc);
    }

    if (role === 'admin') {
      // 🔒 admin seulement si autorisé par sa commune
      const ok = adminCanSeeDoc(doc, req.user?.communeId);
      if (!ok) return res.status(404).json({ message: 'Info introuvable' }); // 404 pour ne rien révéler
      res.set('Cache-Control', 'no-store');
      return res.json(doc);
    }

    // Public : respecter fenêtre temporelle + portée + commune fournie
    const cid = (req.header('x-commune-id') || req.query.communeId || '').trim();
    const ok = publicCanSeeDoc(doc, cid);
    if (!ok) return res.status(404).json({ message: 'Info introuvable' });

    res.set('Cache-Control', 'no-store');
    res.json(doc);
  } catch (err) {
    console.error('❌ GET /infos/:id', err);
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

    // Admin: ne peut modifier QUE ses propres infos + dans SA commune (si local/custom) – superadmin = passe
    if (req.user.role === 'admin') {
      const own = current.authorId && current.authorId === req.user.id;
      const sameScope =
        current.visibility === 'global' ||
        (current.visibility === 'local'   && current.communeId === (req.user.communeId || '')) ||
        (current.visibility === 'custom'  && Array.isArray(current.audienceCommunes) && current.audienceCommunes.includes(req.user.communeId || ''));
      if (!own || !sameScope) {
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

    // Image
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
      const sameScope =
        current.visibility === 'global' ||
        (current.visibility === 'local'   && current.communeId === (req.user.communeId || '')) ||
        (current.visibility === 'custom'  && Array.isArray(current.audienceCommunes) && current.audienceCommunes.includes(req.user.communeId || ''));
      if (!own || !sameScope) {
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

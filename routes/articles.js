// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');

const Article = require('../models/Article');
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
const { buildVisibilityQuery } = require('../utils/visibility');
const { storage, hasCloudinary } = require('../utils/cloudinary');
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// --- helpers existants ---
function publicUrlFromFile(file) {
  if (!file) return null;
  if (hasCloudinary) return file.path;
  const filename = file.filename || path.basename(file.path || '');
  return filename ? `/uploads/${filename}` : null;
}

// 🔧 NOUVEAUX HELPERS — unifient slug/ObjectId
async function communeKeys(anyId) {
  const raw = (anyId ?? '').toString().trim().toLowerCase();
  if (!raw) return { list: [] };

  const s = new Set([raw]); // garde toujours la valeur brute

  if (mongoose.Types.ObjectId.isValid(raw)) {
    // on a un ObjectId → récupère le slug
    const c = await Commune.findById(raw).lean();
    if (c?.slug) s.add(String(c.slug).trim().toLowerCase());
  } else {
    // on a un slug (ou code) → récupère aussi l’_id
    const c = await Commune.findOne({ slug: raw }).lean();
    if (c?._id) s.add(String(c._id).toLowerCase());
  }
  return { list: [...s] };
}

// Utilitaire: préférer stocker le slug quand on crée un article
async function preferSlug(rawIdOrSlug) {
  const raw = (rawIdOrSlug ?? '').toString().trim().toLowerCase();
  if (!raw) return '';
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    return (c?.slug ? String(c.slug).trim().toLowerCase() : raw);
  }
  return raw; // déjà un slug
}

// --- auth optionnel pour GET /:id ---
const jwt = require('jsonwebtoken');
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

/* ================== CREATE (panel) ================== */
router.post('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès réservé aux admins' });
    }

    const {
      title, content, visibility, communeId, priority, startAt, endAt,
      authorName, publisher, sourceUrl, status
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ message: 'Titre et contenu requis' });
    }

    let imageUrl = req.body.imageUrl || null;
    if (req.file) imageUrl = publicUrlFromFile(req.file);

    const toDateOrNull = v => (v ? new Date(v) : null);

    // 🔁 Toujours stocker un identifiant de commune **canonique (slug si dispo)**
    const userCidRaw = (req.user?.communeId || '').toString().trim().toLowerCase();
    const bodyCidRaw = (communeId || '').toString().trim().toLowerCase();
    const userCid = await preferSlug(userCidRaw);
    const bodyCid = await preferSlug(bodyCidRaw);

    const base = {
      title: String(title).trim(),
      content: String(content).trim(),
      imageUrl: imageUrl || null,

      visibility: 'local',
      communeId: userCid, // par défaut pour admin
      audienceCommunes: [],

      priority: ['normal','pinned','urgent'].includes(priority) ? priority : 'normal',
      startAt: toDateOrNull(startAt),
      endAt: toDateOrNull(endAt),

      authorId: req.user.id,
      authorEmail: req.user.email,

      publishedAt: new Date(),
      authorName: (authorName || '').trim(),
      publisher: (publisher && publisher.trim()) || 'Association Bellevue Dembeni',
      sourceUrl: (typeof sourceUrl === 'string' && /^https?:\/\//i.test(sourceUrl)) ? sourceUrl : '',
      status: status === 'draft' ? 'draft' : 'published',
    };

    if (req.user.role === 'superadmin') {
      if (visibility && ['local','global','custom'].includes(visibility)) {
        base.visibility = visibility;
      }
      if (base.visibility === 'local') {
        base.communeId = bodyCid;
        if (!base.communeId) {
          return res.status(400).json({ message: 'communeId requis pour visibility=local' });
        }
      } else if (base.visibility === 'custom') {
        base.communeId = '';
        const raw = req.body.audienceCommunes ?? req.body['audienceCommunes[]'] ?? [];
        let arr = raw;
        if (typeof raw === 'string') {
          try { const j = JSON.parse(raw); arr = Array.isArray(j) ? j : raw.split(','); }
          catch { arr = raw.split(','); }
        }
        // 🔁 normaliser toutes les communes en slug si possible
        base.audienceCommunes = Array.isArray(arr)
          ? (await Promise.all(arr.map(preferSlug))).map(s => s.trim().toLowerCase()).filter(Boolean)
          : [];
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      if (!base.communeId) {
        return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
      }
      base.visibility = 'local';
    }

    const doc = await Article.create(base);
    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /articles', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== LIST PUBLIQUE (app/mobile) ================== */
/**
 * GET /api/articles/public
 * Accès sans token.
 * Requiert ?communeId=... ou header x-commune-id: ...
 * ➜ Retourne les articles publiés qui concernent la commune :
 *    - local (communeId = slug OU ObjectId)
 *    - custom (audienceCommunes contient slug OU ObjectId)
 *    - global (toutes communes)
 */
router.get('/public', async (req, res) => {
  try {
    const headerCid = (req.header('x-commune-id') || '').trim().toLowerCase();
    const queryCid  = (req.query.communeId || '').trim().toLowerCase();
    const keys = await communeKeys(headerCid || queryCid);
    const ids = keys.list;

    if (!ids.length) return res.status(400).json({ message: 'communeId requis' });

    const days = Number.isFinite(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 90;
    const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const now = new Date();

    const timeWindow = {
      $and: [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt: null },   { endAt:   { $gte: now } }] },
      ]
    };

    const filter = {
      $and: [
        { status: 'published' },
        { publishedAt: { $gte: cutoff } },
        timeWindow,
        {
          $or: [
            { visibility: 'global' },
            { visibility: 'local',  communeId:        { $in: ids } },
            { visibility: 'custom', audienceCommunes: { $in: ids } },
          ]
        },
      ],
    };

    const docs = await Article.find(
      filter,
      {
        title: 1, content: 1, imageUrl: 1, publishedAt: 1,
        authorName: 1, publisher: 1, sourceUrl: 1, priority: 1, visibility: 1,
      }
    )
      .sort({ priority: -1, publishedAt: -1 })
      .limit(100)
      .lean();

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(docs);
  } catch (err) {
    console.error('❌ GET /articles/public', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== GET BY ID (public + panel) ================== */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const doc = await Article.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Article introuvable' });

    const role = req.user?.role || null;
    const isPanel = role === 'admin' || role === 'superadmin';

    if (!isPanel) {
      const rawCid = (req.header('x-commune-id') || req.query.communeId || '').trim().toLowerCase();
      const { list: ids } = await communeKeys(rawCid);
      const now = new Date();
      const okStart = !doc.startAt || doc.startAt <= now;
      const okEnd   = !doc.endAt   || doc.endAt   >= now;
      const okStatus = doc.status === 'published';

      let allowed = false;
      if (doc.visibility === 'global') {
        allowed = true;
      } else if (doc.visibility === 'local') {
        allowed = ids.includes(String(doc.communeId).toLowerCase());
      } else if (doc.visibility === 'custom') {
        const set = new Set((doc.audienceCommunes || []).map(s => String(s).toLowerCase()));
        allowed = ids.some(k => set.has(k));
      }

      if (!(allowed && okStatus && okStart && okEnd)) {
        return res.status(404).json({ message: 'Article introuvable' });
      }
    }

    res.json(doc);
  } catch (err) {
    console.error('❌ GET /articles/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

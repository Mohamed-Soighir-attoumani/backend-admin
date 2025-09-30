// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');

const Article = require('../models/Article');
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
const { storage, hasCloudinary } = require('../utils/cloudinary');
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ================= Helpers communs =================

function publicUrlFromFile(file) {
  if (!file) return null;
  if (hasCloudinary) return file.path; // déjà une URL https
  const filename = file.filename || path.basename(file.path || '');
  return filename ? `/uploads/${filename}` : null;
}

/**
 * Retourne toutes les formes « équivalentes » d’un identifiant de commune.
 * - Garde toujours la valeur brute
 * - Si ObjectId => ajoute slug/id/codeInsee/name si trouvés
 * - Si slug/id/code/codeInsee/name => ajoute aussi l’_id si trouvé
 */
async function communeAliases(anyId) {
  const raw = (anyId ?? '').toString().trim().toLowerCase();
  if (!raw) return [];

  const set = new Set([raw]);

  const add = (v) => {
    const s = (v ?? '').toString().trim().toLowerCase();
    if (s) set.add(s);
  };

  if (mongoose.Types.ObjectId.isValid(raw)) {
    // on part d’un ObjectId
    const c = await Commune.findById(raw).lean();
    if (c) {
      add(c._id);
      add(c.slug);
      add(c.id);           // beaucoup de jeux de données utilisent "id" comme slug
      add(c.code);
      add(c.codeInsee);
      add(c.name);         // par sécurité (au cas où des anciens enregistrements utilisaient le nom)
    }
  } else {
    // on part d’une clé textuelle (slug/id/code/etc.)
    const c = await Commune.findOne({
      $or: [
        { slug: raw },
        { id: raw },
        { code: raw },
        { codeInsee: raw },
        { name: new RegExp(`^${raw}$`, 'i') }, // souple sur la casse
      ],
    }).lean();

    if (c) {
      add(c._id);
      add(c.slug);
      add(c.id);
      add(c.code);
      add(c.codeInsee);
      add(c.name);
    }
  }

  return [...set];
}

/**
 * Canonicalise une clé de commune pour stockage dans Article.communeId
 * (on privilégie un slug si disponible, sinon id, sinon codeInsee, sinon la valeur brute)
 */
async function canonicalCommuneKey(rawIdOrSlug) {
  const raw = (rawIdOrSlug ?? '').toString().trim().toLowerCase();
  if (!raw) return '';

  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    if (!c) return raw; // laisse l'ObjectId si on ne trouve rien
    return (c.slug || c.id || c.codeInsee || String(c._id)).toString().trim().toLowerCase();
  }

  const c = await Commune.findOne({
    $or: [
      { slug: raw },
      { id: raw },
      { code: raw },
      { codeInsee: raw },
      { name: new RegExp(`^${raw}$`, 'i') },
    ],
  }).lean();

  if (c) {
    return (c.slug || c.id || c.codeInsee || String(c._id)).toString().trim().toLowerCase();
  }
  return raw;
}

// --- auth optionnel pour lecture publique par ID ---
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

// ================= CREATE (panel) =================
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin', 'superadmin'].includes(req.user.role)) {
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

    const toDateOrNull = (v) => (v ? new Date(v) : null);

    // toujours une commune canonique
    const userCidRaw = (req.user?.communeId || '').toString().trim().toLowerCase();
    const bodyCidRaw = (communeId || '').toString().trim().toLowerCase();

    const userCid = await canonicalCommuneKey(userCidRaw);
    const bodyCid = await canonicalCommuneKey(bodyCidRaw);

    const base = {
      title: String(title).trim(),
      content: String(content).trim(),
      imageUrl: imageUrl || null,

      visibility: 'local',
      communeId: userCid, // par défaut pour admin
      audienceCommunes: [],

      priority: ['normal', 'pinned', 'urgent'].includes(priority) ? priority : 'normal',
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
      if (visibility && ['local', 'global', 'custom'].includes(visibility)) {
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
        // normaliser toutes les communes
        base.audienceCommunes = Array.isArray(arr)
          ? (await Promise.all(arr.map(canonicalCommuneKey)))
              .map(s => s.trim().toLowerCase()).filter(Boolean)
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

// ================= LIST (panel protégée) =================
router.get('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès réservé aux admins' });
    }

    const { period } = req.query;
    const role = req.user.role;

    const headerCid = (req.header('x-commune-id') || '').trim().toLowerCase();
    const queryCid  = (req.query.communeId || '').trim().toLowerCase();

    let filter = {};

    if (role === 'admin') {
      const baseCid = headerCid || queryCid || (req.user.communeId || '');
      const ids = await communeAliases(baseCid);
      if (!ids.length) return res.json([]);

      filter = {
        $or: [
          { visibility: 'local',  communeId:        { $in: ids } },
          { visibility: 'custom', audienceCommunes: { $in: ids } },
          { visibility: 'global' },
        ],
      };
    } else if (role === 'superadmin') {
      if (headerCid || queryCid) {
        const ids = await communeAliases(headerCid || queryCid);
        filter = {
          $or: [
            { visibility: 'local',  communeId:        { $in: ids } },
            { visibility: 'custom', audienceCommunes: { $in: ids } },
            { visibility: 'global' },
          ],
        };
      } else {
        filter = {}; // toutes
      }
    }

    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
    }

    const docs = await Article.find(filter)
      .sort({ priority: -1, publishedAt: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /articles', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ================= LIST PUBLIQUE (mobile) =================
/**
 * GET /api/articles/public
 * Requiert ?communeId=... ou header x-commune-id
 * Renvoie les articles publiés:
 *  - global (tout le monde)
 *  - local (communeId ∈ alias)
 *  - custom (audienceCommunes ∩ alias ≠ ∅)
 * Fenêtre par défaut: 90 jours (extensible avec ?days=365)
 */
router.get('/public', async (req, res) => {
  try {
    const headerCid = (req.header('x-commune-id') || '').trim().toLowerCase();
    const queryCid  = (req.query.communeId || '').trim().toLowerCase();
    const ids = await communeAliases(headerCid || queryCid);

    if (!ids.length) return res.status(400).json({ message: 'communeId requis' });

    const days = Number.isFinite(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const timeWindow = {
      $and: [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt: null },   { endAt:   { $gte: now } }] },
      ],
    };

    const filter = {
      $and: [
        { status: 'published' },
        // accepte aussi les anciens articles sans publishedAt
        { $or: [{ publishedAt: { $gte: cutoff } }, { publishedAt: { $exists: false } }, { publishedAt: null }] },
        timeWindow,
        {
          $or: [
            { visibility: 'global' },
            { visibility: 'local',  communeId:        { $in: ids } },
            { visibility: 'custom', audienceCommunes: { $in: ids } },
          ],
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
      .sort({ priority: -1, publishedAt: -1, createdAt: -1 })
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

// ================= GET BY ID (public + panel) =================
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
      const ids = await communeAliases(rawCid);
      const now = new Date();
      const okStart = !doc.startAt || doc.startAt <= now;
      const okEnd   = !doc.endAt   || doc.endAt   >= now;
      const okStatus = doc.status === 'published';

      let allowed = false;
      if (doc.visibility === 'global') {
        allowed = true;
      } else if (doc.visibility === 'local') {
        const cand = String(doc.communeId || '').toLowerCase();
        allowed = ids.includes(cand);
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

// ================= UPDATE (panel) =================
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès réservé aux admins' });
    }

    const id = String(req.params.id || '').trim();
    if (!

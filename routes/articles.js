// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Article = require('../models/Article');
const { storage } = require('../utils/cloudinary'); // multer-storage-cloudinary
const { buildVisibilityQuery } = require('../utils/visibility');

const upload = multer({ storage });

/* -------------------- utils auth/role -------------------- */
function readBearer(req) {
  const h = req.header('authorization') || req.header('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}
function getUserFromReq(req) {
  // tente req.user (si déjà peuplé par un middleware), sinon décode le token
  if (req.user && (req.user.role || req.user.id)) return req.user;
  const token = readBearer(req);
  if (!token) return {};
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return {
      role: payload.role,
      communeId: payload.communeId || '',
      email: payload.email || '',
      id: payload.id ? String(payload.id) : '',
    };
  } catch {
    return {};
  }
}
function ensureAdminOrSuperadmin(req, res, next) {
  const u = getUserFromReq(req);
  if (!u || !u.role) return res.status(401).json({ message: 'Non authentifié' });
  if (u.role !== 'admin' && u.role !== 'superadmin') {
    return res.status(403).json({ message: 'Accès réservé aux admins' });
  }
  req.user = u; // s’assure que req.user existe pour la suite
  next();
}

/* -------------------- Auth optionnelle pour GET -------------------- */
function optionalAuth(req, _res, next) {
  const u = getUserFromReq(req);
  if (u && u.role) req.user = u;
  next();
}

/* ================== CREATE ================== */
router.post('/', ensureAdminOrSuperadmin, upload.single('image'), async (req, res) => {
  try {
    let { title, content, visibility, communeId, priority, startAt, endAt } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ message: 'Titre et contenu requis' });
    }

    // audienceCommunes: JSON, CSV ou tableau
    let audienceCommunes =
      req.body.audienceCommunes ??
      req.body['audienceCommunes[]'] ??
      [];

    if (typeof audienceCommunes === 'string') {
      try {
        const maybe = JSON.parse(audienceCommunes);
        audienceCommunes = Array.isArray(maybe) ? maybe : audienceCommunes.split(',');
      } catch {
        audienceCommunes = audienceCommunes.split(',');
      }
      audienceCommunes = audienceCommunes.map(s => String(s).trim()).filter(Boolean);
    }
    if (!Array.isArray(audienceCommunes)) audienceCommunes = [];

    const toDateOrNull = v => (v ? new Date(v) : null);
    const imageUrl = req.file ? req.file.path : null;

    const base = {
      title: String(title).trim(),
      content: String(content).trim(),
      imageUrl,
      visibility: 'local',
      communeId: req.user.communeId || '',
      audienceCommunes: [],
      priority: ['normal','pinned','urgent'].includes(priority) ? priority : 'normal',
      startAt: toDateOrNull(startAt),
      endAt: toDateOrNull(endAt),
      authorId: req.user.id,
      authorEmail: req.user.email,
    };

    if (req.user.role === 'superadmin') {
      if (visibility && ['local','global','custom'].includes(visibility)) {
        base.visibility = visibility;
      }
      if (base.visibility === 'local') {
        base.communeId = String(communeId || '').trim();
        if (!base.communeId) {
          return res.status(400).json({ message: 'communeId requis pour visibility=local' });
        }
      } else if (base.visibility === 'custom') {
        base.communeId = '';
        base.audienceCommunes = audienceCommunes;
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      if (!base.communeId) {
        return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
      }
    }

    const doc = await Article.create(base);
    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /articles', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== LIST ================== */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { period } = req.query;
    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid || '';

    const role = req.user?.role || null;
    const isPanel = role === 'admin' || role === 'superadmin';

    const filter = buildVisibilityQuery({
      communeId,
      userRole: role,
      includeLegacy: true,
      includeTimeWindow: false,
    }) || {};

    if (!isPanel) {
      const now = new Date();
      const timeClauses = [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt:   null }, { endAt:   { $gte: now } }] },
      ];
      if (filter.$and) filter.$and.push(...timeClauses);
      else filter.$and = timeClauses;
    }

    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
    }

    // Admin: ne voit que ses propres docs
    if (role === 'admin' && req.user?.id) {
      filter.authorId = String(req.user.id);
    }

    const docs = await Article.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /articles', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== GET BY ID ================== */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

    const doc = await Article.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Article introuvable' });

    res.json(doc);
  } catch (err) {
    console.error('❌ GET /articles/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== UPDATE ================== */
router.put('/:id', ensureAdminOrSuperadmin, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

    const current = await Article.findById(id);
    if (!current) return res.status(404).json({ message: 'Article introuvable' });

    // Admin : ne peut modifier QUE ses propres articles
    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res.status(403).json({ message: 'Interdit : vous ne pouvez modifier que vos articles' });
      }
    }

    const payload = {};
    if (req.body.title != null)   payload.title   = String(req.body.title).trim();
    if (req.body.content != null) payload.content = String(req.body.content).trim();

    if (req.file) payload.imageUrl = req.file.path;

    if (req.body.priority && ['normal','pinned','urgent'].includes(req.body.priority)) {
      payload.priority = req.body.priority;
    }

    const toDateOrNull = v => (v ? new Date(v) : null);
    if ('startAt' in req.body) payload.startAt = toDateOrNull(req.body.startAt);
    if ('endAt'   in req.body) payload.endAt   = toDateOrNull(req.body.endAt);

    if (req.user.role === 'superadmin') {
      const { visibility, communeId } = req.body || {};
      let audienceCommunes =
        req.body.audienceCommunes ??
        req.body['audienceCommunes[]'] ??
        undefined;

      if (visibility && ['local','global','custom'].includes(visibility)) {
        payload.visibility = visibility;
        if (visibility === 'local') {
          payload.communeId = String(communeId || '').trim();
          payload.audienceCommunes = [];
          if (!payload.communeId) {
            return res.status(400).json({ message: 'communeId requis pour visibility=local' });
          }
        } else if (visibility === 'custom') {
          payload.communeId = '';
          if (typeof audienceCommunes === 'string') {
            try {
              const maybe = JSON.parse(audienceCommunes);
              audienceCommunes = Array.isArray(maybe) ? maybe : audienceCommunes.split(',');
            } catch {
              audienceCommunes = audienceCommunes.split(',');
            }
          }
          payload.audienceCommunes = Array.isArray(audienceCommunes)
            ? audienceCommunes.map(s => String(s).trim()).filter(Boolean)
            : [];
        } else if (visibility === 'global') {
          payload.communeId = '';
          payload.audienceCommunes = [];
        }
      }
    }

    const updated = await Article.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PUT /articles/:id', err);
    res.status(500).json({ message: 'Erreur modification article' });
  }
});

/* ================== DELETE ================== */
router.delete('/:id', ensureAdminOrSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

    const current = await Article.findById(id);
    if (!current) return res.status(404).json({ message: 'Article introuvable' });

    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res.status(403).json({ message: 'Interdit : vous ne pouvez supprimer que vos articles' });
      }
    }

    await Article.deleteOne({ _id: id });
    res.json({ message: '✅ Article supprimé' });
  } catch (err) {
    console.error('❌ DELETE /articles/:id', err);
    res.status(500).json({ message: 'Erreur suppression article' });
  }
});

module.exports = router;

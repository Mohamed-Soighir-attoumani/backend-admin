// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');

const Article = require('../models/Article');
const auth = require('../middleware/authMiddleware'); // hydrate req.user depuis la BDD
const { storage } = require('../utils/cloudinary');   // multer-storage-cloudinary
const { buildVisibilityQuery } = require('../utils/visibility');

const upload = multer({ storage });

/* -------------------- Helpers Rôles -------------------- */
function ensureAdminOrSuperadmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Accès réservé aux admins' });
  }
  next();
}

/* ================== CREATE (panel) ================== */
router.post(
  '/',
  auth,
  ensureAdminOrSuperadmin,
  upload.single('image'),
  async (req, res) => {
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

      // Base du document
      const base = {
        title: String(title).trim(),
        content: String(content).trim(),
        imageUrl,
        visibility: 'local',             // par défaut
        communeId: req.user.communeId || '',
        audienceCommunes: [],
        priority: ['normal','pinned','urgent'].includes(priority) ? priority : 'normal',
        startAt: toDateOrNull(startAt),
        endAt: toDateOrNull(endAt),
        authorId: req.user.id,
        authorEmail: req.user.email,
      };

      if (req.user.role === 'superadmin') {
        // Le superadmin choisit la portée
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
        // Admin simple : doit être rattaché à une commune
        if (!base.communeId) {
          return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
        }
        base.visibility = 'local'; // force locale
      }

      const doc = await Article.create(base);
      res.status(201).json(doc);
    } catch (err) {
      console.error('❌ POST /articles', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
);

/* ================== LIST (panel, protégée) ================== */
router.get('/', auth, async (req, res) => {
  try {
    const { period } = req.query;

    // Commune explicite (prioritaire)
    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();

    const role = req.user?.role || null;
    const isPanel = role === 'admin' || role === 'superadmin';

    // Si rien n'est fourni et qu'on est admin (pas superadmin) → on prend la commune de l'admin
    const communeId =
      headerCid ||
      queryCid ||
      (isPanel && req.user.role !== 'superadmin' ? (req.user?.communeId || '') : '');

    // Filtre visibilité (pas de fenêtre de temps côté panel)
    const filter = buildVisibilityQuery({
      communeId,
      userRole: role,
      includeLegacy: true,
      includeTimeWindow: false,
    }) || {};

    // (Option) restreindre un admin à ses propres articles — laissé OFF par défaut
    // if (role === 'admin' && req.user?.id) {
    //   filter.authorId = String(req.user.id);
    // }

    // Période rapide
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
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

/* ================== LIST PUBLIQUE (app/mobile) ================== */
/**
 * GET /api/articles/public
 * Accès sans token.
 * Requiert la commune ciblée via ?communeId=... ou header x-commune-id: ...
 * Applique la fenêtre d’affichage (startAt/endAt).
 */
router.get('/public', async (req, res) => {
  try {
    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid;

    if (!communeId) {
      return res.status(400).json({ message: 'communeId requis' });
    }

    // Filtre visibilité pour le public, AVEC fenêtre d’affichage
    const filter = buildVisibilityQuery({
      communeId,
      userRole: null,              // public
      includeLegacy: true,
      includeTimeWindow: true,     // applique startAt/endAt
    }) || {};

    const docs = await Article.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /articles/public', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== GET BY ID (public + panel) ================== */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const doc = await Article.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Article introuvable' });

    res.json(doc);
  } catch (err) {
    console.error('❌ GET /articles/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== UPDATE (panel) ================== */
router.put(
  '/:id',
  auth,
  ensureAdminOrSuperadmin,
  upload.single('image'),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'ID invalide' });
      }

      const current = await Article.findById(id);
      if (!current) return res.status(404).json({ message: 'Article introuvable' });

      // Admin simple : ne peut modifier QUE ses propres articles
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
        // Seul le superadmin peut changer la visibilité/portée
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
  }
);

/* ================== DELETE (panel) ================== */
router.delete(
  '/:id',
  auth,
  ensureAdminOrSuperadmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'ID invalide' });
      }

      const current = await Article.findById(id);
      if (!current) return res.status(404).json({ message: 'Article introuvable' });

      // Admin simple : ne peut supprimer QUE ses propres articles
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
  }
);

module.exports = router;

// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const multer = require('multer');

const Article = require('../models/Article');
const auth = require('../middleware/authMiddleware'); // hydrate req.user
const { storage } = require('../utils/cloudinary');
const { buildVisibilityQuery } = require('../utils/visibility');

const upload = multer({ storage });

/* -------------------- Helpers Rôles -------------------- */
function ensureAdminOrSuperadmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Accès réservé aux admins' });
  }
  next();
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/* ================== CREATE (panel) ================== */
router.post(
  '/',
  auth,
  ensureAdminOrSuperadmin,
  upload.single('image'),
  async (req, res) => {
    try {
      let { title, content, visibility, communeId, priority, startAt, endAt,
            authorName, publisher, sourceUrl, status } = req.body || {};

      if (!title || !content) {
        return res.status(400).json({ message: 'Titre et contenu requis' });
      }

      const toDateOrNull = v => (v ? new Date(v) : null);
      const imageUrl = req.file ? req.file.path : (req.body.imageUrl || null);

      const base = {
        title: String(title).trim(),
        content: String(content).trim(),
        imageUrl: imageUrl || null,

        visibility: 'local', // par défaut
        communeId: req.user.communeId || '',
        audienceCommunes: [],

        priority: ['normal','pinned','urgent'].includes(priority) ? priority : 'normal',
        startAt: toDateOrNull(startAt),
        endAt: toDateOrNull(endAt),

        authorId: req.user.id,
        authorEmail: req.user.email,

        // 🔹 métadonnées Play
        publishedAt: new Date(),
        authorName: (authorName || '').trim(),
        publisher: (publisher && publisher.trim()) || 'Association Bellevue Dembeni',
        sourceUrl: isHttpUrl(sourceUrl) ? sourceUrl : '',
        status: status === 'draft' ? 'draft' : 'published',
      };

      if (req.user.role === 'superadmin') {
        if (visibility && ['local','global','custom'].includes(visibility)) {
          base.visibility = visibility;
        }
        if (base.visibility === 'local') {
          base.communeId = String(communeId || '').trim();
          if (!base.communeId) return res.status(400).json({ message: 'communeId requis pour visibility=local' });
        } else if (base.visibility === 'custom') {
          base.communeId = '';
          const raw = req.body.audienceCommunes ?? req.body['audienceCommunes[]'] ?? [];
          let arr = raw;
          if (typeof raw === 'string') {
            try { const j = JSON.parse(raw); arr = Array.isArray(j) ? j : raw.split(','); }
            catch { arr = raw.split(','); }
          }
          base.audienceCommunes = Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [];
        } else if (base.visibility === 'global') {
          base.communeId = '';
          base.audienceCommunes = [];
        }
      } else {
        if (!base.communeId) return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
        base.visibility = 'local';
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

    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();

    const role = req.user?.role || null;
    const isPanel = role === 'admin' || role === 'superadmin';

    const communeId =
      headerCid ||
      queryCid ||
      (isPanel && req.user.role !== 'superadmin' ? (req.user?.communeId || '') : '');

    const filter = buildVisibilityQuery({
      communeId,
      userRole: role,
      includeLegacy: true,
      includeTimeWindow: false,
    }) || {};

    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
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

/* ================== LIST PUBLIQUE (app/mobile) ================== */
/**
 * GET /api/articles/public
 * Accès sans token.
 * Requiert ?communeId=... ou header x-commune-id: ...
 * 🔹 Renvoie uniquement: status=published, publishedAt < 90j, dans fenêtre startAt/endAt
 */
router.get('/public', async (req, res) => {
  try {
    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid;

    if (!communeId) return res.status(400).json({ message: 'communeId requis' });

    const now = Date.now();
    const cutoff = new Date(now - NINETY_DAYS_MS);

    // visibilité + fenêtre temporelle (publique)
    const filter = buildVisibilityQuery({
      communeId,
      userRole: null,
      includeLegacy: true,
      includeTimeWindow: true,
    }) || {};

    // 🔹 Contraintes Play
    filter.status = 'published';
    filter.publishedAt = Object.assign(filter.publishedAt || {}, { $gte: cutoff });

    const docs = await Article.find(
      filter,
      {
        title: 1,
        content: 1,
        imageUrl: 1,
        publishedAt: 1,
        authorName: 1,
        publisher: 1,
        sourceUrl: 1,
        priority: 1,
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
router.get('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) {
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
      const id = String(req.params.id || '').trim();
      if (!id || id.length < 12) {
        return res.status(400).json({ message: 'ID invalide' });
      }

      const current = await Article.findById(id);
      if (!current) return res.status(404).json({ message: 'Article introuvable' });

      if (req.user.role === 'admin') {
        if (String(current.authorId || '') !== String(req.user.id || '')) {
          return res.status(403).json({ message: 'Interdit : vous ne pouvez modifier que vos articles' });
        }
      }

      const payload = {};
      const setIf = (k, v) => { if (v !== undefined) payload[k] = v; };
      const toDateOrNull = v => (v ? new Date(v) : null);

      if (req.body.title != null)   setIf('title',   String(req.body.title).trim());
      if (req.body.content != null) setIf('content', String(req.body.content).trim());

      if (req.file) setIf('imageUrl', req.file.path);
      if (req.body.imageUrl !== undefined && !req.file) setIf('imageUrl', req.body.imageUrl || null);

      if (req.body.priority && ['normal','pinned','urgent'].includes(req.body.priority)) {
        setIf('priority', req.body.priority);
      }
      if ('startAt' in req.body) setIf('startAt', toDateOrNull(req.body.startAt));
      if ('endAt'   in req.body) setIf('endAt',   toDateOrNull(req.body.endAt));

      // 🔹 métadonnées Play
      if ('publishedAt' in req.body) setIf('publishedAt', toDateOrNull(req.body.publishedAt) || current.publishedAt || new Date());
      if ('authorName'  in req.body) setIf('authorName', (req.body.authorName || '').trim());
      if ('publisher'   in req.body) setIf('publisher', (req.body.publisher || 'Association Bellevue Dembeni').trim());
      if ('sourceUrl'   in req.body) setIf('sourceUrl', isHttpUrl(req.body.sourceUrl) ? req.body.sourceUrl : '');
      if ('status'      in req.body) setIf('status', req.body.status === 'draft' ? 'draft' : 'published');

      if (req.user.role === 'superadmin' && req.body.visibility) {
        const v = req.body.visibility;
        if (['local','global','custom'].includes(v)) {
          payload.visibility = v;
          if (v === 'local') {
            const cid = String(req.body.communeId || '').trim();
            if (!cid) return res.status(400).json({ message: 'communeId requis pour visibility=local' });
            payload.communeId = cid;
            payload.audienceCommunes = [];
          } else if (v === 'custom') {
            payload.communeId = '';
            let arr = req.body.audienceCommunes ?? req.body['audienceCommunes[]'] ?? [];
            if (typeof arr === 'string') {
              try { const j = JSON.parse(arr); arr = Array.isArray(j) ? j : arr.split(','); }
              catch { arr = arr.split(','); }
            }
            payload.audienceCommunes = Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [];
          } else if (v === 'global') {
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
      const id = String(req.params.id || '').trim();
      if (!id || id.length < 12) {
        return res.status(400).json({ message: 'ID invalide' });
      }

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
  }
);

module.exports = router;

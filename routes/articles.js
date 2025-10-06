const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');

const Article = require('../models/Article');
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
// Gardé (même si non utilisé partout) pour compat descendante
const { buildVisibilityQuery } = require('../utils/visibility');

// ⚙️ Storage conforme à utils/cloudinary.js (Cloudinary ou disque)
const { storage, hasCloudinary } = require('../utils/cloudinary');
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

/* -------------------- Helpers -------------------- */

// Transforme le fichier uploadé en URL publique
function publicUrlFromFile(file) {
  if (!file) return null;
  if (hasCloudinary) return file.path; // Cloudinary: déjà une URL https
  const filename = file.filename || path.basename(file.path || '');
  return filename ? `/uploads/${filename}` : null; // Disque: /uploads/... (server.js doit servir ce dossier)
}

// Normalise et rassemble les clés possibles d’une commune (slug <-> ObjectId)
async function communeKeys(anyId) {
  const raw = (anyId ?? '').toString().trim().toLowerCase();
  if (!raw) return { list: [] };

  const s = new Set([raw]); // on garde toujours la valeur fournie
  if (mongoose.Types.ObjectId.isValid(raw)) {
    // raw est un ObjectId → récupérer le slug
    const c = await Commune.findById(raw).lean();
    if (c?.slug) s.add(String(c.slug).trim().toLowerCase());
  } else {
    // raw est un slug → récupérer le _id
    const c = await Commune.findOne({ slug: raw }).lean();
    if (c?._id) s.add(String(c._id).toLowerCase());
  }
  return { list: [...s] };
}

// Préférer stocker le slug quand on crée/maj un article
async function preferSlug(rawIdOrSlug) {
  const raw = (rawIdOrSlug ?? '').toString().trim().toLowerCase();
  if (!raw) return '';
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    return c?.slug ? String(c.slug).trim().toLowerCase() : raw;
  }
  return raw; // déjà un slug
}

// Auth optionnelle (lecture publique de /:id)
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
    } catch (_) {
      // token invalide → ignorer
    }
  }
  next();
}

/* ================== CREATE (panel) ================== */
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

    // Stockage canonique de la commune (slug si possible)
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

      priority: ['normal', 'pinned', 'urgent'].includes(priority) ? priority : 'normal',
      startAt: toDateOrNull(startAt),
      endAt: toDateOrNull(endAt),

      authorId: req.user.id,
      authorEmail: req.user.email,

      publishedAt: new Date(),
      authorName: (authorName || '').trim(),
      publisher: (publisher && publisher.trim()) || 'Association Bellevue Dembeni',
      sourceUrl:
        typeof sourceUrl === 'string' && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : '',
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
          try {
            const j = JSON.parse(raw);
            arr = Array.isArray(j) ? j : raw.split(',');
          } catch {
            arr = raw.split(',');
          }
        }
        base.audienceCommunes = Array.isArray(arr)
          ? (await Promise.all(arr.map(preferSlug)))
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          : [];
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      // admin simple
      if (!base.communeId) {
        return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
      }
      base.visibility = 'local'; // un admin ne peut publier que pour SA commune
    }

    const doc = await Article.create(base);
    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /articles', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== LIST (panel, protégée) ================== */
router.get('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès réservé aux admins' });
    }

    const { period } = req.query;
    const role = req.user.role;

    // commune depuis header ou query (priorité au header)
    const headerCid = (req.header('x-commune-id') || '').trim().toLowerCase();
    const queryCid = (req.query.communeId || '').trim().toLowerCase();

    let filter = {};

    if (role === 'admin') {
      // admin : SEULEMENT ses propres articles ET scoping commune
      const baseCid = headerCid || queryCid || (req.user.communeId || '');
      const { list: ids } = await communeKeys(baseCid);
      if (!ids.length) return res.json([]); // pas de commune => pas d’articles

      filter = {
        $and: [
          { authorId: String(req.user.id) }, // 👈 ne voir QUE ses propres articles
          {
            $or: [
              { visibility: 'local', communeId: { $in: ids } },
              { visibility: 'custom', audienceCommunes: { $in: ids } },
              { visibility: 'global' }, // au cas où (normalement les admins ne créent pas de global)
            ],
          },
        ],
      };
    } else if (role === 'superadmin') {
      // superadmin : si commune précisée => filtrer pour celle-ci ; sinon tout
      if (headerCid || queryCid) {
        const { list: ids } = await communeKeys(headerCid || queryCid);
        filter = {
          $or: [
            { visibility: 'local', communeId: { $in: ids } },
            { visibility: 'custom', audienceCommunes: { $in: ids } },
            { visibility: 'global' },
          ],
        };
      } else {
        filter = {}; // toutes les communes
      }
    }

    // Période optionnelle (sur createdAt)
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
    const queryCid = (req.query.communeId || '').trim().toLowerCase();
    const keys = await communeKeys(headerCid || queryCid);
    const ids = keys.list;

    if (!ids.length) return res.status(400).json({ message: 'communeId requis' });

    const days = Number.isFinite(parseInt(req.query.days, 10))
      ? parseInt(req.query.days, 10)
      : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const timeWindow = {
      $and: [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt: { $exists: false } }, { endAt: null }, { endAt: { $gte: now } }] },
      ],
    };

    const filter = {
      $and: [
        { status: 'published' },
        { publishedAt: { $gte: cutoff } },
        timeWindow,
        {
          $or: [
            { visibility: 'global' },
            { visibility: 'local', communeId: { $in: ids } },
            { visibility: 'custom', audienceCommunes: { $in: ids } },
          ],
        },
      ],
    };

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
        visibility: 1,
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

    // 🔒 Panel : un ADMIN ne peut lire que ses propres articles
    if (role === 'admin') {
      if (String(doc.authorId || '') !== String(req.user?.id || '')) {
        // 404 volontaire pour ne pas révéler l’existence
        return res.status(404).json({ message: 'Article introuvable' });
      }
      return res.json(doc);
    }

    // Superadmin : accès total
    if (role === 'superadmin') {
      return res.json(doc);
    }

    // Public (pas de token admin/superadmin) : vérifier la fenêtre & le ciblage de commune
    const headerCid = (req.header('x-commune-id') || '').trim().toLowerCase();
    const queryCid = (req.query.communeId || '').trim().toLowerCase();
    const { list: ids } = await communeKeys(headerCid || queryCid);

    const now = new Date();
    const okStart = !doc.startAt || doc.startAt <= now;
    const okEnd = !doc.endAt || doc.endAt >= now;
    const okStatus = doc.status === 'published';

    let allowed = false;
    if (doc.visibility === 'global') {
      allowed = true;
    } else if (doc.visibility === 'local') {
      allowed = ids.includes(String(doc.communeId).toLowerCase());
    } else if (doc.visibility === 'custom') {
      const set = new Set((doc.audienceCommunes || []).map((s) => String(s).toLowerCase()));
      allowed = ids.some((k) => set.has(k));
    }

    if (!(allowed && okStatus && okStart && okEnd)) {
      return res.status(404).json({ message: 'Article introuvable' });
    }

    res.json(doc);
  } catch (err) {
    console.error('❌ GET /articles/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== UPDATE (panel) ================== */
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès réservé aux admins' });
    }

    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const current = await Article.findById(id);
    if (!current) return res.status(404).json({ message: 'Article introuvable' });

    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res
          .status(403)
          .json({ message: 'Interdit : vous ne pouvez modifier que vos articles' });
      }
    }

    const payload = {};
    const setIf = (k, v) => {
      if (v !== undefined) payload[k] = v;
    };
    const toDateOrNull = (v) => (v ? new Date(v) : null);

    if (req.body.title != null) setIf('title', String(req.body.title).trim());
    if (req.body.content != null) setIf('content', String(req.body.content).trim());

    if (req.file) {
      setIf('imageUrl', publicUrlFromFile(req.file));
    } else if (req.body.imageUrl !== undefined) {
      setIf('imageUrl', req.body.imageUrl || null);
    }

    if (req.body.priority && ['normal', 'pinned', 'urgent'].includes(req.body.priority)) {
      setIf('priority', req.body.priority);
    }
    if ('startAt' in req.body) setIf('startAt', toDateOrNull(req.body.startAt));
    if ('endAt' in req.body) setIf('endAt', toDateOrNull(req.body.endAt));

    if ('publishedAt' in req.body)
      setIf('publishedAt', toDateOrNull(req.body.publishedAt) || current.publishedAt || new Date());
    if ('authorName' in req.body) setIf('authorName', (req.body.authorName || '').trim());
    if ('publisher' in req.body)
      setIf('publisher', (req.body.publisher || 'Association Bellevue Dembeni').trim());
    if ('sourceUrl' in req.body)
      setIf(
        'sourceUrl',
        typeof req.body.sourceUrl === 'string' && /^https?:\/\//i.test(req.body.sourceUrl)
          ? req.body.sourceUrl
          : ''
      );
    if ('status' in req.body) setIf('status', req.body.status === 'draft' ? 'draft' : 'published');

    if (req.user.role === 'superadmin' && req.body.visibility) {
      const v = req.body.visibility;
      if (['local', 'global', 'custom'].includes(v)) {
        payload.visibility = v;
        if (v === 'local') {
          const cid = await preferSlug(req.body.communeId || '');
          if (!cid) return res.status(400).json({ message: 'communeId requis pour visibility=local' });
          payload.communeId = cid;
          payload.audienceCommunes = [];
        } else if (v === 'custom') {
          payload.communeId = '';
          let arr = req.body.audienceCommunes ?? req.body['audienceCommunes[]'] ?? [];
          if (typeof arr === 'string') {
            try {
              const j = JSON.parse(arr);
              arr = Array.isArray(j) ? j : arr.split(',');
            } catch {
              arr = arr.split(',');
            }
          }
          payload.audienceCommunes = Array.isArray(arr)
            ? (await Promise.all(arr.map(preferSlug)))
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            : [];
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
});

/* ================== DELETE (panel) ================== */
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès réservé aux admins' });
    }

    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const current = await Article.findById(id);
    if (!current) return res.status(404).json({ message: 'Article introuvable' });

    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res
          .status(403)
          .json({ message: 'Interdit : vous ne pouvez supprimer que vos articles' });
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

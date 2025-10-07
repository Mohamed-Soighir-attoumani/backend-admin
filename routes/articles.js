// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');

const Article = require('../models/Article');
const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
// Compat descendante (pas forcément utilisé partout)
let buildVisibilityQuery = null;
try { ({ buildVisibilityQuery } = require('../utils/visibility')); } catch (_) { /* optional */ }

/* -------------------- Upload: Cloudinary si dispo, sinon fallback -------------------- */
let upload;
let USING_CLOUDINARY = false;

try {
  const cloud = require('../utils/cloudinary'); // doit exporter { storage, hasCloudinary? }
  const storage = cloud.storage;
  USING_CLOUDINARY = !!cloud.hasCloudinary;
  upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
} catch (_) {
  // Fallback: accepte la requête même sans image (JSON pur) sans casser l’API
  upload = multer({ storage: multer.memoryStorage() });
  USING_CLOUDINARY = false;
}

/* -------------------- Helpers -------------------- */

const norm = (v) => String(v || '').trim().toLowerCase();

function safeToDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// URL publique du fichier uploadé
function publicUrlFromFile(file) {
  if (!file) return null;
  // Cloudinary: multer-storage-cloudinary fixe déjà file.path = URL https
  if (USING_CLOUDINARY && file.path && /^https?:\/\//i.test(file.path)) return file.path;

  // Disque (ou fallback mémoire avec nom de fichier si présent)
  const filename = file.filename || path.basename(String(file.path || ''));
  return filename ? `/uploads/${filename}` : null;
}

// Normalise et rassemble les clés possibles d’une commune (slug <-> ObjectId)
async function communeKeys(anyId) {
  const raw = norm(anyId);
  if (!raw) return { list: [] };

  const s = new Set([raw]); // garder toujours la valeur fournie
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    if (c?.slug) s.add(norm(c.slug));
  } else {
    const c = await Commune.findOne({ slug: raw }).lean();
    if (c?._id) s.add(String(c._id).toLowerCase());
  }
  return { list: [...s] };
}

// Préférer stocker le slug quand on crée/maj un article
async function preferSlug(input) {
  const raw = norm(input);
  if (!raw) return '';
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    return c?.slug ? norm(c.slug) : raw;
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
      // token invalide → continuer en public
    }
  }
  next();
}

// Catégorie : sécuriser les valeurs (ton schéma autorise: annonce/actualite/evenement/autres)
function normalizeCategory(c) {
  const v = norm(c);
  const allowed = ['annonce', 'actualite', 'evenement', 'autres'];
  return allowed.includes(v) ? v : 'annonce';
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
      authorName, publisher, sourceUrl, status, category
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ message: 'Titre et contenu requis' });
    }

    const imageUrl = req.file ? publicUrlFromFile(req.file) : (req.body.imageUrl || null);

    // Stockage canonique de la commune (slug si possible)
    const userCid = await preferSlug(req.user?.communeId || '');
    const bodyCid = await preferSlug(communeId || '');

    const base = {
      title: String(title).trim(),
      content: String(content).trim(),
      imageUrl: imageUrl || null,

      category: normalizeCategory(category),

      visibility: 'local',
      communeId: userCid,               // par défaut pour admin
      audienceCommunes: [],

      priority: ['normal', 'pinned', 'urgent'].includes(priority) ? priority : 'normal',
      startAt: safeToDate(startAt),
      endAt:   safeToDate(endAt),

      authorId: req.user.id,
      authorEmail: req.user.email,

      // champs facultatifs (schema strict les ignore si absents)
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
        let raw = req.body.audienceCommunes ?? req.body['audienceCommunes[]'] ?? [];
        if (typeof raw === 'string') {
          try { const j = JSON.parse(raw); raw = Array.isArray(j) ? j : raw.split(','); }
          catch { raw = raw.split(','); }
        }
        base.audienceCommunes = Array.isArray(raw)
          ? (await Promise.all(raw.map(preferSlug))).map(norm).filter(Boolean)
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
    res.status(500).json({ message: err?.message || 'Erreur interne du serveur' });
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
    const headerCid = norm(req.header('x-commune-id') || '');
    const queryCid  = norm(req.query.communeId || '');

    let filter = {};

    if (role === 'admin') {
      // admin : SEULEMENT ses articles ET scoping commune
      const baseCid = headerCid || queryCid || (req.user.communeId || '');
      const { list: ids } = await communeKeys(baseCid);
      if (!ids.length) return res.json([]); // pas de commune => pas d’articles

      filter = {
        $and: [
          { authorId: String(req.user.id) },
          {
            $or: [
              { visibility: 'local',  communeId: { $in: ids } },
              { visibility: 'custom', audienceCommunes: { $in: ids } },
              { visibility: 'global' },
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
            { visibility: 'local',  communeId: { $in: ids } },
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
    res.status(500).json({ message: err?.message || 'Erreur serveur' });
  }
});

/* ================== LIST PUBLIQUE (app/mobile) ================== */
router.get('/public', async (req, res) => {
  try {
    const headerCid = norm(req.header('x-commune-id') || '');
    const queryCid  = norm(req.query.communeId || '');
    const { list: ids } = await communeKeys(headerCid || queryCid);

    if (!ids.length) return res.status(400).json({ message: 'communeId requis' });

    const days = Number.isFinite(parseInt(req.query.days, 10))
      ? parseInt(req.query.days, 10)
      : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const timeWindow = {
      $and: [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt: null }, { endAt:   { $gte: now } }] },
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
            { visibility: 'local',  communeId: { $in: ids } },
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
        category: 1,
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
    res.status(500).json({ message: err?.message || 'Erreur serveur' });
  }
});

/* ================== GET BY ID (public + panel) ================== */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const doc = await Article.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Article introuvable' });

    const role = req.user?.role || null;

    // 🔒 Panel admin: ne peut lire que ses propres articles
    if (role === 'admin') {
      if (String(doc.authorId || '') !== String(req.user?.id || '')) {
        return res.status(404).json({ message: 'Article introuvable' });
      }
      return res.json(doc);
    }

    // Superadmin : accès total
    if (role === 'superadmin') {
      return res.json(doc);
    }

    // Public : vérifier fenêtre & commune
    const headerCid = norm(req.header('x-commune-id') || '');
    const queryCid  = norm(req.query.communeId || '');
    const { list: ids } = await communeKeys(headerCid || queryCid);

    const now = new Date();
    const okStart = !doc.startAt || doc.startAt <= now;
    const okEnd   = !doc.endAt   || doc.endAt   >= now;
    const okStatus = doc.status === 'published';

    let allowed = false;
    if (doc.visibility === 'global') {
      allowed = true;
    } else if (doc.visibility === 'local') {
      allowed = ids.includes(norm(doc.communeId));
    } else if (doc.visibility === 'custom') {
      const set = new Set((doc.audienceCommunes || []).map(norm));
      allowed = ids.some((k) => set.has(k));
    }

    if (!(allowed && okStatus && okStart && okEnd)) {
      return res.status(404).json({ message: 'Article introuvable' });
    }

    res.json(doc);
  } catch (err) {
    console.error('❌ GET /articles/:id', err);
    res.status(500).json({ message: err?.message || 'Erreur serveur' });
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
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

    if (req.body.title   != null) setIf('title',   String(req.body.title).trim());
    if (req.body.content != null) setIf('content', String(req.body.content).trim());
    if (req.body.category != null) setIf('category', normalizeCategory(req.body.category));

    if (req.file) setIf('imageUrl', publicUrlFromFile(req.file));
    else if (req.body.imageUrl !== undefined) setIf('imageUrl', req.body.imageUrl || null);

    if (['normal','pinned','urgent'].includes(req.body.priority)) setIf('priority', req.body.priority);
    if ('startAt' in req.body) setIf('startAt', safeToDate(req.body.startAt));
    if ('endAt'   in req.body) setIf('endAt',   safeToDate(req.body.endAt));

    if ('publishedAt' in req.body) setIf('publishedAt', safeToDate(req.body.publishedAt) || current.publishedAt || new Date());
    if ('authorName'  in req.body) setIf('authorName',  (req.body.authorName || '').trim());
    if ('publisher'   in req.body) setIf('publisher',   (req.body.publisher   || 'Association Bellevue Dembeni').trim());
    if ('sourceUrl'   in req.body) setIf('sourceUrl',   (typeof req.body.sourceUrl === 'string' && /^https?:\/\//i.test(req.body.sourceUrl)) ? req.body.sourceUrl : '');
    if ('status'      in req.body) setIf('status',      req.body.status === 'draft' ? 'draft' : 'published');

    if (req.user.role === 'superadmin' && req.body.visibility) {
      const v = req.body.visibility;
      if (['local','global','custom'].includes(v)) {
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
            try { const j = JSON.parse(arr); arr = Array.isArray(j) ? j : arr.split(','); }
            catch { arr = arr.split(','); }
          }
          payload.audienceCommunes = Array.isArray(arr)
            ? (await Promise.all(arr.map(preferSlug))).map(norm).filter(Boolean)
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
    res.status(500).json({ message: err?.message || 'Erreur modification article' });
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
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
    res.status(500).json({ message: err?.message || 'Erreur suppression article' });
  }
});

module.exports = router;

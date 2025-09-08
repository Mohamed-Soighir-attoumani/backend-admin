// backend/routes/projects.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Project = require('../models/Project');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { storage } = require('../utils/cloudinary');
const { buildVisibilityQuery } = require('../utils/visibility');

const upload = multer({ storage });

/** Auth optionnelle pour /GET */
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

/* ================== CREATE ================== */
// ⬅️ Autoriser admin ET superadmin (sinon superadmin reçoit 403)
router.post('/', auth, requireRole(['admin','superadmin']), upload.single('image'), async (req, res) => {
  try {
    let { name, description, visibility, communeId, priority, startAt, endAt } = req.body || {};

    if (!name || !description) {
      return res.status(400).json({ message: 'Nom et description requis' });
    }

    // audienceCommunes
    let audienceCommunes =
      req.body.audienceCommunes ??
      req.body['audienceCommunes[]'] ??
      [];

    if (typeof audienceCommunes === 'string') {
      // support JSON ["a","b"] ou CSV "a,b"
      try {
        const maybeJson = JSON.parse(audienceCommunes);
        audienceCommunes = Array.isArray(maybeJson) ? maybeJson : audienceCommunes.split(',');
      } catch {
        audienceCommunes = audienceCommunes.split(',');
      }
      audienceCommunes = audienceCommunes.map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(audienceCommunes)) audienceCommunes = [];

    const toDateOrNull = v => (v ? new Date(v) : null);
    const imageUrl = req.file ? req.file.path : null;

    const base = {
      name: String(name).trim(),
      description: String(description).trim(),
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
        base.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      if (!base.communeId) {
        return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
      }
    }

    const doc = await Project.create(base);
    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ POST /projects', err);
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

    const docs = await Project.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /projects', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== GET BY ID ================== */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

    const doc = await Project.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Projet introuvable' });

    res.json(doc);
  } catch (err) {
    console.error('❌ GET /projects/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ================== UPDATE ================== */
// ⬅️ Autoriser admin ET superadmin
router.put('/:id', auth, requireRole(['admin','superadmin']), upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

    const current = await Project.findById(id);
    if (!current) return res.status(404).json({ message: 'Projet introuvable' });

    // Admin : ne peut modifier QUE ses propres projets
    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res.status(403).json({ message: 'Interdit : vous ne pouvez modifier que vos projets' });
      }
    }

    const payload = {};
    if (req.body.name != null)        payload.name = String(req.body.name).trim();
    if (req.body.description != null) payload.description = String(req.body.description).trim();
    if (req.file)                      payload.imageUrl = req.file.path;

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
            // support JSON ou CSV
            try {
              const maybeJson = JSON.parse(audienceCommunes);
              audienceCommunes = Array.isArray(maybeJson) ? maybeJson : audienceCommunes.split(',');
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

    const updated = await Project.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PUT /projects/:id', err);
    res.status(500).json({ message: 'Erreur modification projet' });
  }
});

/* ================== DELETE ================== */
// ⬅️ Autoriser admin ET superadmin
router.delete('/:id', auth, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

    const current = await Project.findById(id);
    if (!current) return res.status(404).json({ message: 'Projet introuvable' });

    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res.status(403).json({ message: 'Interdit : vous ne pouvez supprimer que vos projets' });
      }
    }

    await Project.deleteOne({ _id: id });
    res.json({ message: '✅ Projet supprimé' });
  } catch (err) {
    console.error('❌ DELETE /projects/:id', err);
    res.status(500).json({ message: 'Erreur suppression projet' });
  }
});

module.exports = router;

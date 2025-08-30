// backend/routes/projects.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Project = require('../models/Project');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { storage } = require('../utils/cloudinary');
const { buildVisibilityQuery } = require('../utils/visibility');

const upload = multer({ storage });

// optional auth
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

// CREATE
router.post('/', auth, requireRole('admin'), upload.single('image'), async (req, res) => {
  try {
    const { name, description, visibility, communeId, audienceCommunes, priority, startAt, endAt } = req.body;
    if (!name || !description) return res.status(400).json({ message: 'Nom et description requis' });

    const imageUrl = req.file ? req.file.path : '';

    let doc = {
      name, description, imageUrl,
      visibility: 'local',
      communeId: req.user.communeId || '',
      audienceCommunes: [],
      priority: priority || 'normal',
      startAt: startAt || null,
      endAt: endAt || null,
      authorId: req.user.id,
      authorEmail: req.user.email,
    };

    if (req.user.role === 'superadmin') {
      if (visibility) doc.visibility = visibility;
      if (visibility === 'local') doc.communeId = (communeId || '').trim();
      if (visibility === 'custom') doc.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
      if (visibility === 'global') { doc.communeId = ''; doc.audienceCommunes = []; }
    }

    const saved = await Project.create(doc);
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ POST /projects', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// LIST (publique + panel)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const userRole = req.user?.role || null;
    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid || '';

    const filter = buildVisibilityQuery({ communeId, userRole });
    const projects = await Project.find(filter).sort({ priority: -1, createdAt: -1 }).lean();
    res.json(projects);
  } catch (err) {
    console.error('❌ GET /projects', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// DETAIL
router.get('/:id', async (req, res) => {
  try {
    const p = await Project.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Projet introuvable' });
    res.json(p);
  } catch (err) {
    console.error('❌ GET /projects/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// UPDATE
router.put('/:id', auth, requireRole('admin'), upload.single('image'), async (req, res) => {
  try {
    const current = await Project.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Projet introuvable' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    const payload = {};
    ['name','description','priority','startAt','endAt'].forEach(k => {
      if (req.body[k] !== undefined) payload[k] = req.body[k];
    });
    if (req.file) payload.imageUrl = req.file.path;

    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body;
      if (visibility) payload.visibility = visibility;
      if (visibility === 'local') payload.communeId = (communeId || '').trim();
      if (visibility === 'custom') payload.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
      if (visibility === 'global') { payload.communeId = ''; payload.audienceCommunes = []; }
    }

    const updated = await Project.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PUT /projects/:id', err);
    res.status(500).json({ message: 'Erreur modification projet' });
  }
});

// DELETE
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const current = await Project.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Projet introuvable' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    await Project.deleteOne({ _id: req.params.id });
    res.json({ message: '✅ Projet supprimé' });
  } catch (err) {
    console.error('❌ DELETE /projects/:id', err);
    res.status(500).json({ message: 'Erreur suppression projet' });
  }
});

module.exports = router;

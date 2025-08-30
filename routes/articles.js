// backend/routes/articles.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const mongoose = require('mongoose');
const Article = require('../models/Article');
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
    const { title, content, visibility, communeId, audienceCommunes, priority, startAt, endAt } = req.body;
    if (!title || !content) return res.status(400).json({ message: 'Titre et contenu requis' });

    const imageUrl = req.file ? req.file.path : null;

    let doc = {
      title, content, imageUrl,
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

    const article = await Article.create(doc);
    res.status(201).json(article);
  } catch (error) {
    console.error('❌ POST /articles', error);
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
    const articles = await Article.find(filter).sort({ priority: -1, createdAt: -1 }).lean();
    res.json(articles);
  } catch (err) {
    console.error('❌ GET /articles', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// DETAIL
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const article = await Article.findById(id);
    if (!article) return res.status(404).json({ message: 'Article non trouvé' });
    res.json(article);
  } catch (error) {
    console.error('❌ GET /articles/:id', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// UPDATE
router.put('/:id', auth, requireRole('admin'), upload.single('image'), async (req, res) => {
  try {
    const current = await Article.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Article introuvable' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    const payload = {};
    ['title','content','priority','startAt','endAt'].forEach(k => {
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

    const updated = await Article.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PUT /articles/:id', err);
    res.status(500).json({ message: 'Erreur modification article' });
  }
});

// DELETE
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const current = await Article.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Article non trouvé' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    await Article.deleteOne({ _id: req.params.id });
    res.json({ message: '✅ Article supprimé' });
  } catch (err) {
    console.error('❌ DELETE /articles/:id', err);
    res.status(500).json({ message: 'Erreur suppression article' });
  }
});

module.exports = router;

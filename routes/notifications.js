// backend/routes/notifications.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Notification = require('../models/Notification');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { buildVisibilityQuery } = require('../utils/visibility');

/** Optional auth: si Authorization présent, on essaye d’extraire le rôle */
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
    } catch (_) {/* ignore */}
  }
  next();
}

// --------- CREATE (panel) ----------
router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { title, message, visibility, communeId, audienceCommunes, priority, startAt, endAt } = req.body;
    if (!title || !message) return res.status(400).json({ message: 'Titre et message requis' });

    let doc = {
      title, message,
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

    const created = await Notification.create(doc);
    res.status(201).json(created);
  } catch (err) {
    console.error('❌ POST /notifications', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- MARK ALL READ ----------
router.patch('/mark-all-read', async (_req, res) => {
  try {
    await Notification.updateMany({}, { isRead: true });
    res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
  } catch (err) {
    console.error('❌ PATCH /notifications/mark-all-read', err);
    res.status(500).json({ message: 'Erreur lors du marquage.' });
  }
});

// --------- UPDATE ----------
router.patch('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    // Admin ne peut modifier que LOCAL de sa commune
    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    const payload = {};
    ['title','message','isRead','priority','startAt','endAt'].forEach(k => {
      if (req.body[k] !== undefined) payload[k] = req.body[k];
    });

    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body;
      if (visibility) payload.visibility = visibility;
      if (visibility === 'local') payload.communeId = (communeId || '').trim();
      if (visibility === 'custom') payload.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
      if (visibility === 'global') { payload.communeId = ''; payload.audienceCommunes = []; }
    }

    const updated = await Notification.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PATCH /notifications/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- DELETE ----------
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    await Notification.deleteOne({ _id: id });
    res.json({ message: 'Notification supprimée avec succès' });
  } catch (err) {
    console.error('❌ DELETE /notifications/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- LIST (publique + panel) ----------
router.get('/', optionalAuth, async (req, res) => {
  const { period } = req.query;

  const headerCid = (req.header('x-commune-id') || '').trim();
  const queryCid = (req.query.communeId || '').trim();
  const communeId = headerCid || queryCid || '';

  const userRole = req.user?.role || null;

  const filter = buildVisibilityQuery({ communeId, userRole });

  // Période optionnelle
  if (period === '7' || period === '30') {
    const days = parseInt(period, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
  }

  try {
    const notifs = await Notification.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();
    res.json(notifs);
  } catch (err) {
    console.error('❌ GET /notifications', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --------- SEED (optionnel) ----------
router.post('/seed', async (_req, res) => {
  try {
    const n = await Notification.create({ title: 'Notification de test', message: '🔔 Ceci est une notification de test.' });
    res.status(201).json(n);
  } catch (err) {
    console.error('❌ POST /notifications/seed', err);
    res.status(500).json({ message: 'Erreur création notification' });
  }
});

module.exports = router;

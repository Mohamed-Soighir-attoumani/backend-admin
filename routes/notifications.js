// backend/routes/notifications.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Notification = require('../models/Notification');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { buildVisibilityQuery } = require('../utils/visibility');

/** Auth optionnelle: si Authorization présent, on essaie d’extraire quelques infos */
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
    } catch (_) { /* ignore */ }
  }
  next();
}

/* --------------------- CREATE (panel) --------------------- */
router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    let {
      title,
      message,
      visibility,
      communeId,
      audienceCommunes,
      priority,
      startAt,
      endAt,
    } = req.body || {};

    if (!title || !message) {
      return res.status(400).json({ message: 'Titre et message requis' });
    }

    // Normalisation basique
    title = String(title).trim();
    message = String(message).trim();
    priority = ['normal','pinned','urgent'].includes(priority) ? priority : 'normal';

    const toDateOrNull = (v) => (v ? new Date(v) : null);

    const base = {
      title,
      message,
      visibility: 'local',
      communeId: req.user.communeId || '',
      audienceCommunes: [],
      priority,
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
        base.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
        base.communeId = '';
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
      // Admin: forcé en local sur sa commune
      if (!base.communeId) {
        return res.status(403).json({ message: 'Votre compte n’est pas rattaché à une commune' });
      }
    }

    const created = await Notification.create(base);
    res.status(201).json(created);
  } catch (err) {
    console.error('❌ POST /notifications', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ----------------- MARK ALL READ (public) ----------------- */
router.patch('/mark-all-read', async (_req, res) => {
  try {
    await Notification.updateMany({}, { isRead: true });
    res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
  } catch (err) {
    console.error('❌ PATCH /notifications/mark-all-read', err);
    res.status(500).json({ message: 'Erreur lors du marquage.' });
  }
});

/* ------------------------ UPDATE ------------------------- */
router.patch('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    // 🔐 Admin: ne peut modifier QUE ses notifications
    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res.status(403).json({ message: 'Interdit : ce contenu ne vous appartient pas.' });
      }
    }

    const payload = {};
    const assignIf = (k, val) => { if (val !== undefined) payload[k] = val; };

    assignIf('title',   typeof req.body.title   === 'string' ? req.body.title.trim()   : undefined);
    assignIf('message', typeof req.body.message === 'string' ? req.body.message.trim() : undefined);
    if (req.body.priority && ['normal','pinned','urgent'].includes(req.body.priority)) {
      payload.priority = req.body.priority;
    }
    if (req.body.isRead !== undefined) payload.isRead = !!req.body.isRead;

    const toDateOrNull = (v) => (v ? new Date(v) : null);
    if ('startAt' in req.body) payload.startAt = toDateOrNull(req.body.startAt);
    if ('endAt'   in req.body) payload.endAt   = toDateOrNull(req.body.endAt);

    // 🛠 Superadmin: peut changer la visibilité
    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body || {};
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
          payload.audienceCommunes = Array.isArray(audienceCommunes) ? audienceCommunes : [];
        } else if (visibility === 'global') {
          payload.communeId = '';
          payload.audienceCommunes = [];
        }
      }
    }

    const updated = await Notification.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PATCH /notifications/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ------------------------ DELETE ------------------------- */
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    // 🔐 Admin: ne supprime QUE ses notifications
    if (req.user.role === 'admin') {
      if (String(current.authorId || '') !== String(req.user.id || '')) {
        return res.status(403).json({ message: 'Interdit : ce contenu ne vous appartient pas.' });
      }
    }

    await Notification.deleteOne({ _id: id });
    res.json({ message: 'Notification supprimée avec succès' });
  } catch (err) {
    console.error('❌ DELETE /notifications/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ------------------------- LIST -------------------------- */
/**
 * - superadmin : tout
 * - admin : uniquement SES notifications (authorId = req.user.id)
 * - public : filtrage par visibilité (global/custom/local avec commune)
 * - période ?period=7|30
 * - compat: inclut aussi anciens docs sans visibility
 * - respect startAt/endAt si renseignés
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { period } = req.query;

    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid || '';

    const userRole = req.user?.role || null;
    const userId   = req.user?.id || '';

    // base visibilité (global/custom/local)
    const baseFilter = buildVisibilityQuery({ communeId, userRole }) || {};

    // compat anciens docs (pas de visibility)
    const legacyOr = [
      { visibility: { $exists: false } },
      { visibility: '' },
    ];

    let filter = {};
    if (baseFilter.$or) {
      filter.$or = [...baseFilter.$or, ...legacyOr];
      Object.keys(baseFilter).forEach(k => {
        if (k !== '$or') filter[k] = baseFilter[k];
      });
    } else {
      filter = { $and: [ baseFilter, { $or: legacyOr } ] };
    }

    // 🔐 Restriction admin → ses propres docs
    if (userRole === 'admin' && userId) {
      // on ajoute authorId à l’AND global
      filter.$and = filter.$and || [];
      filter.$and.push({ authorId: userId });
    }

    // période
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
    }

    // fenêtre active (si dates renseignées)
    const now = new Date();
    const activeWindowAnd = [
      { $or: [{ startAt: null }, { startAt: { $exists: false } }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null },   { endAt:   { $exists: false } }, { endAt:   { $gte: now } }] },
    ];
    filter.$and = filter.$and || [];
    filter.$and.push(...activeWindowAnd);

    const docs = await Notification.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /notifications', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ------------------------- SEED -------------------------- */
router.post('/seed', async (_req, res) => {
  try {
    const n = await Notification.create({
      title: 'Notification de test',
      message: '🔔 Ceci est une notification de test.',
    });
    res.status(201).json(n);
  } catch (err) {
    console.error('❌ POST /notifications/seed', err);
    res.status(500).json({ message: 'Erreur création notification' });
  }
});

module.exports = router;

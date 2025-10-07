// backend/routes/notifications.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Notification = require('../models/Notification');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// Optionnel (legacy)
let buildVisibilityQuery = null;
try { ({ buildVisibilityQuery } = require('../utils/visibility')); } catch (_) {}

const normCid = (v) => String(v || '').trim().toLowerCase();

/* ======================= Helpers ======================= */
function getCommuneIdFromReq(req) {
  const h1 = req.header('x-commune-id');
  const h2 = req.header('x-commune');
  const h3 = req.header('x-communeid');
  const q1 = req.query?.communeId;
  const q2 = req.query?.commune;
  const u  = req.user?.communeId;
  return normCid(h1 || h2 || h3 || q1 || q2 || u || '');
}

/** Auth optionnelle: si Authorization présent, on essaie d’extraire quelques infos */
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
    } catch { /* token invalide => public */ }
  }
  next();
}

/* ======================= CREATE (panel) ======================= */
router.post('/', auth, requireRole(['admin', 'superadmin']), async (req, res) => {
  try {
    let {
      title, message, visibility, communeId, audienceCommunes,
      priority, startAt, endAt,
    } = req.body || {};

    if (!title || !message) {
      return res.status(400).json({ message: 'Titre et message requis' });
    }

    title = String(title).trim();
    message = String(message).trim();
    priority = ['normal','pinned','urgent'].includes(priority) ? priority : 'normal';
    const toDateOrNull = (v) => (v ? new Date(v) : null);

    const base = {
      title, message,
      visibility: 'local',
      communeId: normCid(req.user.communeId || ''),
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
        base.communeId = normCid(communeId);
        if (!base.communeId) {
          return res.status(400).json({ message: 'communeId requis pour visibility=local' });
        }
        base.audienceCommunes = [];
      } else if (base.visibility === 'custom') {
        const arr = Array.isArray(audienceCommunes) ? audienceCommunes : [];
        base.audienceCommunes = arr.map((s) => normCid(s)).filter(Boolean);
        base.communeId = '';
      } else if (base.visibility === 'global') {
        base.communeId = '';
        base.audienceCommunes = [];
      }
    } else {
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

/* ============== MARK ALL READ (public, multi-commune) ============== */
router.patch('/mark-all-read', async (req, res) => {
  try {
    const fromBody   = normCid(req.body?.communeId || '');
    const fromHeader = normCid(req.header('x-commune-id') || req.header('x-commune') || req.header('x-communeid') || '');
    const fromQuery  = normCid(req.query?.communeId || req.query?.commune || '');
    const communeId  = fromBody || fromHeader || fromQuery || '';

    const orClauses = [{ visibility: 'global' }];
    if (communeId) {
      orClauses.push({ visibility: 'local',  communeId });
      orClauses.push({ visibility: 'custom', audienceCommunes: { $in: [communeId] } });
    }

    const result = await Notification.updateMany({ $or: orClauses }, { $set: { isRead: true } });
    res.json({
      message: 'Notifications marquées comme lues.',
      matched: result?.matchedCount ?? undefined,
      modified: result?.modifiedCount ?? undefined,
    });
  } catch (err) {
    console.error('❌ PATCH /notifications/mark-all-read', err);
    res.status(500).json({ message: 'Erreur lors du marquage.' });
  }
});

/* =========================== UPDATE =========================== */
router.patch('/:id', auth, requireRole(['admin','superadmin']), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== normCid(req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
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

    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body || {};
      if (visibility && ['local','global','custom'].includes(visibility)) {
        payload.visibility = visibility;
        if (visibility === 'local') {
          payload.communeId = normCid(communeId);
          payload.audienceCommunes = [];
          if (!payload.communeId) {
            return res.status(400).json({ message: 'communeId requis pour visibility=local' });
          }
        } else if (visibility === 'custom') {
          payload.communeId = '';
          const arr = Array.isArray(audienceCommunes) ? audienceCommunes : [];
          payload.audienceCommunes = arr.map((s) => normCid(s)).filter(Boolean);
        } else if (visibility === 'global') {
          payload.communeId = '';
          payload.audienceCommunes = [];
        }
      }
    }

    const updated = await Notification.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PATCH /notifications/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* =========================== DELETE =========================== */
router.delete('/:id', auth, requireRole(['admin','superadmin']), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== normCid(req.user.communeId || '')) {
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

/* ============================ LIST ============================ */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { period } = req.query;
    const role = req.user?.role || null;
    const isPanel = role === 'admin' || role === 'superadmin';
    const communeId = getCommuneIdFromReq(req);

    let filter = {};

    if (role === 'superadmin') {
      // 🔓 Superadmin : TOUTES communes (sans filtrer sur communeId)
      filter.$or = [
        { visibility: 'global' },
        { visibility: 'local'  },
        { visibility: 'custom' },
        { $and: [{ $or: [{ visibility: { $exists: false } }, { visibility: null }] }] }, // legacy
      ];
      // pas de fenêtre temporelle pour le panel
    } else if (role === 'admin') {
      // 🔒 Admin : seulement SA commune (+ globales)
      const cid = normCid(req.user.communeId || '');
      if (!cid) return res.json([]);
      filter.$or = [
        { visibility: 'global' },
        { visibility: 'local',  communeId: cid },
        { visibility: 'custom', audienceCommunes: { $in: [cid] } },
        {
          $and: [
            { $or: [{ visibility: { $exists: false } }, { visibility: null }] }, // legacy
            { $or: [{ communeId: cid }, { audienceCommunes: { $in: [cid] } }, { commune: cid }] },
          ],
        },
      ];
      // pas de fenêtre temporelle pour le panel
    } else {
      // 🌐 Public (ou sans token) : global + ciblées sur communeId, dans la fenêtre d’affichage
      const orClauses = [{ visibility: 'global' }];
      if (communeId) {
        orClauses.push({ visibility: 'local',  communeId });
        orClauses.push({ visibility: 'custom', audienceCommunes: { $in: [communeId] } });
      }
      orClauses.push({
        $and: [
          { $or: [{ visibility: { $exists: false } }, { visibility: null }] }, // legacy
          communeId ? { $or: [{ communeId }, { audienceCommunes: { $in: [communeId] } }, { commune: communeId }] } : {},
        ].filter(Boolean),
      });

      filter.$or = orClauses;

      const now = new Date();
      filter.$and = [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt:   null }, { endAt:   { $gte: now } }] },
      ];
    }

    // Période (7 ou 30 derniers jours)
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = Object.assign(filter.createdAt || {}, { $gte: fromDate });
    }

    const docs = await Notification.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /notifications', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ============================ SEED ============================ */
router.post('/seed', async (_req, res) => {
  try {
    const n = await Notification.create({
      title: 'Notification de test',
      message: '🔔 Ceci est une notification de test.',
      visibility: 'global',
    });
    res.status(201).json(n);
  } catch (err) {
    console.error('❌ POST /notifications/seed', err);
    res.status(500).json({ message: 'Erreur création notification' });
  }
});

module.exports = router;

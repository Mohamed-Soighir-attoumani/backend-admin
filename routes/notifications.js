// backend/routes/notifications.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Notification = require('../models/Notification');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const { buildVisibilityQuery } = require('../utils/visibility');

/**
 * Auth optionnelle :
 * - si "Authorization: Bearer <token>" est présent, on décode le JWT
 * - on récupère l'id utilisateur même si le champ diffère (id/userId/_id/sub)
 */
function optionalAuth(req, _res, next) {
  const authz = req.header('authorization') || '';
  if (authz.startsWith('Bearer ')) {
    const token = authz.slice(7).trim();
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);

      const userId =
        (payload.id && String(payload.id)) ||
        (payload.userId && String(payload.userId)) ||
        (payload._id && String(payload._id)) ||
        (payload.sub && String(payload.sub)) ||
        '';

      req.user = {
        id: userId,
        email: payload.email || '',
        role: payload.role || null,
        communeId: payload.communeId || '',
      };
    } catch (_) {
      // token invalide → on continue en anonyme
    }
  }
  next();
}

/* =========================================================================
 *                               CREATE (panel)
 * ========================================================================= */
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

    title = String(title).trim();
    message = String(message).trim();
    priority = ['normal', 'pinned', 'urgent'].includes(priority) ? priority : 'normal';

    const toDateOrNull = (v) => (v ? new Date(v) : null);

    const base = {
      title,
      message,
      visibility: 'local',                // par défaut
      communeId: req.user.communeId || '',// admin => sa commune
      audienceCommunes: [],
      priority,
      startAt: toDateOrNull(startAt),
      endAt: toDateOrNull(endAt),
      authorId: req.user.id || '',
      authorEmail: req.user.email || '',
    };

    if (req.user.role === 'superadmin') {
      if (visibility && ['local', 'global', 'custom'].includes(visibility)) {
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
      // Admin simple : forcé en local sur SA commune
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

/* =========================================================================
 *                        MARK ALL READ (public)
 * ========================================================================= */
router.patch('/mark-all-read', async (_req, res) => {
  try {
    await Notification.updateMany({}, { isRead: true });
    res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
  } catch (err) {
    console.error('❌ PATCH /notifications/mark-all-read', err);
    res.status(500).json({ message: 'Erreur lors du marquage.' });
  }
});

/* =========================================================================
 *                                UPDATE
 * ========================================================================= */
router.patch('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const current = await Notification.findById(id);
    if (!current) return res.status(404).json({ message: 'Notification non trouvée' });

    // Admin simple : peut modifier uniquement LOCAL de SA commune
    if (req.user.role === 'admin') {
      if (current.visibility !== 'local' || current.communeId !== (req.user.communeId || '')) {
        return res.status(403).json({ message: 'Interdit pour votre commune' });
      }
    }

    const payload = {};
    const assignIf = (k, val) => { if (val !== undefined) payload[k] = val; };

    assignIf('title',   typeof req.body.title   === 'string' ? req.body.title.trim()   : undefined);
    assignIf('message', typeof req.body.message === 'string' ? req.body.message.trim() : undefined);

    if (req.body.priority && ['normal', 'pinned', 'urgent'].includes(req.body.priority)) {
      payload.priority = req.body.priority;
    }
    if (req.body.isRead !== undefined) payload.isRead = !!req.body.isRead;

    const toDateOrNull = (v) => (v ? new Date(v) : null);
    if ('startAt' in req.body) payload.startAt = toDateOrNull(req.body.startAt);
    if ('endAt'   in req.body) payload.endAt   = toDateOrNull(req.body.endAt);

    if (req.user.role === 'superadmin') {
      const { visibility, communeId, audienceCommunes } = req.body || {};
      if (visibility && ['local', 'global', 'custom'].includes(visibility)) {
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

    const updated = await Notification.findByIdAndUpdate(id, { $set: payload }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error('❌ PATCH /notifications/:id', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* =========================================================================
 *                                DELETE
 * ========================================================================= */
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

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

/* =========================================================================
 *                                 LIST
 * - Public + panel (auth optionnelle)
 * - Filtrage période (?period=7|30)
 * - Multi-commune via header x-commune-id ou ?communeId=
 * - Compatibilité anciennes données (sans visibility)
 * - Fenêtre d’affichage startAt/endAt
 * - Admin simple = ne voit que ses propres notifications
 * ========================================================================= */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { period } = req.query;

    const headerCid = (req.header('x-commune-id') || '').trim();
    const queryCid  = (req.query.communeId || '').trim();
    const communeId = headerCid || queryCid || '';

    const userRole = req.user?.role || null;
    const userId   = (req.user?.id || '').trim();

    // 1) Base via util : local/custom/global selon la commune ciblée
    const baseFilter = buildVisibilityQuery({ communeId, userRole }) || {};

    // 2) Compatibilité anciennes données (pas de visibility)
    const legacyOr = [
      { visibility: { $exists: false } },
      { visibility: '' },
    ];

    // On combine prudemment les filtres
    let filter = {};

    if (baseFilter.$or) {
      filter.$or = [...baseFilter.$or, ...legacyOr];
      // Recopie des autres conditions éventuelles
      Object.keys(baseFilter).forEach((k) => {
        if (k !== '$or') filter[k] = baseFilter[k];
      });
    } else if (Object.keys(baseFilter).length > 0) {
      filter.$and = [ baseFilter, { $or: legacyOr } ];
    } else {
      filter.$or = legacyOr;
    }

    // 3) Filtre période
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      const createdCond = { createdAt: { $gte: fromDate } };
      if (filter.$and) filter.$and.push(createdCond);
      else filter.$and = [createdCond];
    }

    // 4) Fenêtre d’affichage active
    const now = new Date();
    const activeWindowAnd = [
      { $or: [{ startAt: null }, { startAt: { $exists: false } }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null },   { endAt:   { $exists: false } }, { endAt:   { $gte: now } }] },
    ];
    if (filter.$and) filter.$and.push(...activeWindowAnd);
    else filter.$and = activeWindowAnd;

    // 5) Admin simple → ne voit que SES notifications (crées par lui)
    if (userRole === 'admin') {
      const who = [];
      if (userId) who.push({ authorId: userId });
      if (req.user?.email) who.push({ authorEmail: req.user.email });

      if (who.length) {
        if (filter.$and) filter.$and.push({ $or: who });
        else filter.$and = [{ $or: who }];
      }
    }

    // 6) Récup
    const docs = await Notification.find(filter)
      // NB: "priority" est une string; l’ordre alphabétique n’est pas idéal
      // mais on garde tel quel (urgent > pinned > normal si vous changez en valeur numérique).
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json(docs);
  } catch (err) {
    console.error('❌ GET /notifications', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* =========================================================================
 *                                 SEED
 * ========================================================================= */
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

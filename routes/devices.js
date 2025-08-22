// backend/routes/devices.js
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const Device = require('../models/Device');

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const APP_KEY = process.env.MOBILE_APP_KEY || null;

// --------- Protection côté app (clé) ---------
function requireAppKey(req, res, next) {
  if (!APP_KEY) return res.status(500).json({ message: 'MOBILE_APP_KEY manquante côté serveur' });
  const k = req.header('x-app-key');
  if (k !== APP_KEY) return res.status(403).json({ message: 'Clé app invalide' });
  next();
}

// Petit log
router.use((req, _res, next) => { console.log(`[devices] ${req.method} ${req.originalUrl}`); next(); });

/**
 * POST /api/devices/register  (côté app)
 * body: { installationId, platform, brand, model, osVersion, appVersion, pushToken?, userId?, communeId?, communeName? }
 */
router.post('/register', requireAppKey, async (req, res) => {
  try {
    let {
      installationId, platform, brand, model, osVersion, appVersion, pushToken,
      userId, communeId, communeName,
    } = req.body || {};

    if (!installationId) return res.status(400).json({ message: 'installationId requis' });

    const update = {
      platform: (platform || '').toLowerCase(),
      brand: brand || '',
      model: model || '',
      osVersion: osVersion || '',
      appVersion: appVersion || '',
      pushToken: pushToken || '',
      lastSeenAt: new Date(),
    };
    if (userId && isObjectId(userId)) update.userId = userId;
    if (communeId)   update.communeId = String(communeId);
    if (communeName) update.communeName = String(communeName);

    // ✅ Upsert en 1 seul appel (crée si n'existe pas, met à jour sinon)
    const doc = await Device.findOneAndUpdate(
      { installationId },
      { $set: update, $setOnInsert: { firstSeenAt: new Date(), installationId } },
      { upsert: true, new: true }
    );

    const created = doc && doc.createdAt && (doc.createdAt.getTime() === doc.updatedAt.getTime());
    return res.status(created ? 201 : 200).json({ ok: true, created: !!created, updated: !created });
  } catch (e) {
    console.error('POST /devices/register', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * POST /api/devices/ping  (côté app)
 * body: { installationId, appVersion?, osVersion?, pushToken?, brand?, model?, platform?, communeId?, communeName? }
 */
router.post('/ping', requireAppKey, async (req, res) => {
  try {
    const { installationId } = req.body || {};
    if (!installationId) return res.status(400).json({ message: 'installationId requis' });

    const set = { lastSeenAt: new Date() };
    ['appVersion','osVersion','brand','model','platform','pushToken','communeId','communeName'].forEach(k => {
      if (req.body[k] !== undefined && req.body[k] !== null) set[k] = String(req.body[k]);
    });

    // ✅ On accepte la création via ping si register a raté (robuste)
    await Device.findOneAndUpdate(
      { installationId },
      { $set: set, $setOnInsert: { firstSeenAt: new Date(), installationId } },
      { upsert: true, new: false }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /devices/ping', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices/count  (admin)
 * ?activeDays=30  => nombre total et actifs sur N jours
 */
router.get('/count', auth, requireRole('admin','superadmin'), async (req, res) => {
  try {
    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    const [total, active] = await Promise.all([
      Device.countDocuments({}),
      Device.countDocuments({ lastSeenAt: { $gte: since } }),
    ]);

    res.json({ count: total, active, activeDays: nd });
  } catch (e) {
    console.error('GET /devices/count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices/brands  (admin)
 * Retour { items: [{ brand, count }] }
 */
router.get('/brands', auth, requireRole('admin','superadmin'), async (_req, res) => {
  try {
    const aggr = await Device.aggregate([
      { $group: { _id: { $ifNull: ['$brand', ''] }, count: { $sum: 1 } } },
      { $project: { _id: 0, brand: '$_id', count: 1 } },
      { $sort: { count: -1 } },
    ]);
    res.json({ items: aggr });
  } catch (e) {
    console.error('GET /devices/brands', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices (admin) — liste brute (optionnel, pour DevicesTable)
 */
router.get('/', auth, requireRole('admin','superadmin'), async (req, res) => {
  try {
    const p  = Math.max(1,  parseInt(req.query.page || '1', 10));
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

    const list = await Device.find({})
      .select('installationId platform brand model osVersion appVersion lastSeenAt firstSeenAt communeId communeName')
      .sort({ lastSeenAt: -1 })
      .skip((p-1)*ps)
      .limit(ps)
      .lean();

    res.json({ items: list, page: p, pageSize: ps });
  } catch (e) {
    console.error('GET /devices', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

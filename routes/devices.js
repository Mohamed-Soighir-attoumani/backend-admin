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

// --------- Utils affichage legacy ---------
function normalizeLegacy(d) {
  const installationId = d.installationId || d.deviceId || '';

  let brand = (d.brand || '').trim();
  let model = (d.model || '').trim();
  let osVersion = (d.osVersion || '').trim();

  // Si vide, essaie de parser l’ancien "platform"
  // Ex 1: "Xiaomi/22120RN86G/14"
  // Ex 2: "samsung/a05mxx/a05m:15/AP3A...:user/release-keys"
  if ((!brand || !model || !osVersion) && d.platform) {
    const p = String(d.platform);
    const parts = p.split('/');
    if (parts.length >= 3) {
      brand ||= parts[0];
      if (!model) {
        model = parts[1];
        if (model.includes(':')) model = model.split(':')[0];
      }
      if (!osVersion) {
        osVersion = parts[2].includes(':') ? parts[2].split(':')[1] : parts[2];
      }
    }
  }

  const firstSeenAt = d.firstSeenAt || d.registeredAt || d.createdAt || null;
  const lastSeenAt  = d.lastSeenAt  || d.updatedAt   || null;

  return {
    installationId,
    platform: d.platform || (brand && model && osVersion ? `${brand}/${model}/${osVersion}` : ''),
    brand,
    model,
    osVersion,
    appVersion: d.appVersion || '',
    firstSeenAt,
    lastSeenAt,
    communeId: d.communeId || '',
    communeName: d.communeName || '',
  };
}

/**
 * POST /api/devices/register  (côté app)
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
      brand: (brand || '').trim(),
      model: (model || '').trim(),
      osVersion: (osVersion || '').trim(),
      appVersion: (appVersion || '').trim(),
      pushToken: (pushToken || '').trim(),
      lastSeenAt: new Date(),
    };
    if (userId && isObjectId(userId)) update.userId = userId;
    if (communeId)   update.communeId = String(communeId);
    if (communeName) update.communeName = String(communeName);

    const doc = await Device.findOneAndUpdate(
      { installationId },
      { $set: update, $setOnInsert: { firstSeenAt: new Date(), installationId } },
      { upsert: true, new: true }
    );

    // createdAt/updatedAt existent si timestamps: true sur le schema
    const created = !!(doc.createdAt && doc.updatedAt && doc.createdAt.getTime() === doc.updatedAt.getTime());
    return res.status(created ? 201 : 200).json({ ok: true, created, updated: !created });
  } catch (e) {
    console.error('POST /devices/register', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * POST /api/devices/ping  (côté app)
 */
router.post('/ping', requireAppKey, async (req, res) => {
  try {
    const { installationId } = req.body || {};
    if (!installationId) return res.status(400).json({ message: 'installationId requis' });

    const set = { lastSeenAt: new Date() };
    ['appVersion','osVersion','brand','model','platform','pushToken','communeId','communeName'].forEach(k => {
      if (req.body[k] !== undefined && req.body[k] !== null) set[k] = String(req.body[k]);
    });

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
 * GET /api/devices/metrics  (admin)
 */
router.get('/metrics', auth, requireRole('admin','superadmin'), async (_req, res) => {
  try {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, active30, brands] = await Promise.all([
      Device.countDocuments({}),
      Device.countDocuments({ lastSeenAt: { $gte: since30 } }),
      Device.aggregate([
        { $group: { _id: { $ifNull: ['$brand',''] }, count: { $sum: 1 } } },
        { $project: { _id: 0, brand: '$_id', count: 1 } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);
    res.json({ total, active30, brands });
  } catch (e) {
    console.error('GET /devices/metrics', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices (admin) — liste
 */
router.get('/', auth, requireRole('admin','superadmin'), async (req, res) => {
  try {
    const p  = Math.max(1,  parseInt(req.query.page || '1', 10));
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

    const [list, total] = await Promise.all([
      Device.find({})
        .select('installationId deviceId platform brand model osVersion appVersion lastSeenAt firstSeenAt registeredAt communeId communeName createdAt updatedAt')
        .sort({ lastSeenAt: -1, createdAt: -1 })
        .skip((p-1)*ps)
        .limit(ps)
        .lean(),
      Device.countDocuments({}),
    ]);

    const items = list.map(normalizeLegacy);
    res.json({ items, page: p, pageSize: ps, total });
  } catch (e) {
    console.error('GET /devices', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

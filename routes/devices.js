const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const Device = require('../models/Device');
const Commune = require('../models/Commune');

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const lc = (v) => String(v ?? '').trim().toLowerCase();

const APP_KEY = process.env.MOBILE_APP_KEY || null;

// --------- Protection côté app (clé) ---------
function requireAppKey(req, res, next) {
  if (!APP_KEY) return res.status(500).json({ message: 'MOBILE_APP_KEY manquante côté serveur' });
  const k = req.header('x-app-key');
  if (k !== APP_KEY) return res.status(403).json({ message: 'Clé app invalide' });
  next();
}

// --------- Helpers commune: slug <-> ObjectId (toutes formes) ---------
async function communeKeys(anyId) {
  const raw = lc(anyId);
  if (!raw) return { list: [] };

  const out = new Set();
  out.add(raw);

  if (isObjectId(raw)) {
    try { out.add(new mongoose.Types.ObjectId(raw)); } catch {}
    out.add(String(raw));
    const c = await Commune.findById(raw).lean();
    if (c?.slug) out.add(lc(c.slug));
  } else {
    const c = await Commune.findOne({ slug: raw }).lean();
    if (c?._id) {
      out.add(String(c._id));
      try { out.add(new mongoose.Types.ObjectId(String(c._id))); } catch {}
    }
  }
  return { list: Array.from(out) };
}

// --------- Utils affichage legacy ---------
function normalizeLegacy(d) {
  const installationId = d.installationId || d.deviceId || '';

  let brand = (d.brand || '').trim();
  let model = (d.model || '').trim();
  let osVersion = (d.osVersion || '').trim();

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
  const lastSeenAt  = d.lastSeenAt  || d.lastActiveAt || d.updatedAt || null;

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

// --------- Helper filtrage commune pour panel ---------
function getPanelCommuneRaw(req) {
  return lc(req.headers['x-commune-id'] || req.query.communeId || '');
}

/* Petit log (facultatif)
router.use((req, _res, next) => { console.log(`[devices] ${req.method} ${req.originalUrl}`); next(); });
*/

// =====================================
//  App mobile
// =====================================

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

    // 201 si tout juste créé (approximatif)
    const created = doc && doc.firstSeenAt && Math.abs(doc.firstSeenAt.getTime() - Date.now()) < 2000;
    return res.status(created ? 201 : 200).json({ ok: true, created: !!created, updated: !created });
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
 * GET /api/devices/public-count  (public app, sécurisée par x-app-key)
 * ?activeDays=30 (par défaut)
 * ?communeId=<id> (optionnel) -> filtre par commune (slug ou ObjectId)
 */
router.get('/public-count', requireAppKey, async (req, res) => {
  try {
    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    const baseFilter = {};
    const activeAndFilter = [{ lastSeenAt: { $gte: since } }, { lastActiveAt: { $gte: since } }, { updatedAt: { $gte: since } }, { createdAt: { $gte: since } }];

    if (req.query.communeId) {
      const { list: ids } = await communeKeys(req.query.communeId);
      if (!ids.length) return res.json({ count: 0, active: 0, activeDays: nd });
      baseFilter.communeId = { $in: ids };
    }

    const activeFilter = baseFilter.communeId ? { $and: [ { communeId: baseFilter.communeId }, { $or: activeAndFilter } ] }
                                             : { $or: activeAndFilter };

    const [total, active] = await Promise.all([
      Device.countDocuments(baseFilter),
      Device.countDocuments(activeFilter),
    ]);

    res.json({ count: total, active, activeDays: nd });
  } catch (e) {
    console.error('GET /devices/public-count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// =====================================
//  Panel (admin/superadmin)
// =====================================

/**
 * GET /api/devices/count
 * Filtre commune :
 *  - admin      : forcer sa commune
 *  - superadmin : x-commune-id ou ?communeId (vide => toutes)
 */
router.get('/count', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    let baseFilter = {};
    if (req.user.role === 'admin') {
      const { list: ids } = await communeKeys(req.user.communeId || '');
      if (!ids.length) return res.json({ count: 0, active: 0, activeDays: nd, communeId: null });
      baseFilter.communeId = { $in: ids };
    } else if (req.user.role === 'superadmin') {
      const raw = lc(req.headers['x-commune-id'] || req.query.communeId || '');
      if (raw) {
        const { list: ids } = await communeKeys(raw);
        if (!ids.length) return res.json({ count: 0, active: 0, activeDays: nd, communeId: raw });
        baseFilter.communeId = { $in: ids };
      }
    }

    const activeOr = [
      { lastSeenAt:  { $gte: since } },
      { lastActiveAt:{ $gte: since } },
      { updatedAt:   { $gte: since } },
      { createdAt:   { $gte: since } },
    ];
    const activeFilter = Object.keys(baseFilter).length
      ? { $and: [ baseFilter, { $or: activeOr } ] }
      : { $or: activeOr };

    const [total, active] = await Promise.all([
      Device.countDocuments(baseFilter),
      Device.countDocuments(activeFilter),
    ]);

    res.json({
      count: total,
      active,
      activeDays: nd,
      communeId: req.user.role === 'admin' ? (req.user.communeId || null)
                : (lc(req.headers['x-commune-id'] || req.query.communeId || '') || null),
    });
  } catch (e) {
    console.error('GET /devices/count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices
 * Filtre commune identique à /count
 */
router.get('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const p  = Math.max(1,  parseInt(req.query.page || '1', 10));
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

    let baseFilter = {};
    if (req.user.role === 'admin') {
      const { list: ids } = await communeKeys(req.user.communeId || '');
      if (!ids.length) return res.json({ items: [], page: p, pageSize: ps, total: 0 });
      baseFilter.communeId = { $in: ids };
    } else if (req.user.role === 'superadmin') {
      const raw = lc(req.headers['x-commune-id'] || req.query.communeId || '');
      if (raw) {
        const { list: ids } = await communeKeys(raw);
        if (!ids.length) return res.json({ items: [], page: p, pageSize: ps, total: 0 });
        baseFilter.communeId = { $in: ids };
      }
    }

    const [list, total] = await Promise.all([
      Device.find(baseFilter)
        .select('installationId deviceId platform brand model osVersion appVersion lastSeenAt lastActiveAt firstSeenAt registeredAt communeId communeName createdAt updatedAt')
        .sort({ lastSeenAt: -1, lastActiveAt: -1, updatedAt: -1, createdAt: -1 })
        .skip((p-1)*ps)
        .limit(ps)
        .lean(),
      Device.countDocuments(baseFilter),
    ]);

    const items = list.map(normalizeLegacy);
    res.json({ items, page: p, pageSize: ps, total });
  } catch (e) {
    console.error('GET /devices', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

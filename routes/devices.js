// backend/routes/devices.js
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
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

// --------- Helpers filtre commune (admin/superadmin) ---------
function getFilteredCommuneId(req) {
  const hdr = (req.headers['x-commune-id'] || '').toString().trim();

  if (req.user?.role === 'superadmin') {
    // superadmin : header présent => l’utiliser ; sinon => toutes communes
    if (hdr || hdr === '') return hdr; // '' => pas de filtre
    return '';
  }

  // admin : forcer sa commune (ignorer header)
  if (req.user?.role === 'admin' && req.user?.communeId) {
    return String(req.user.communeId);
  }

  return ''; // défaut : pas de filtre
}

/**
 * POST /api/devices/register  (app)
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

    const created = !!(doc.createdAt && doc.updatedAt && doc.createdAt.getTime() === doc.updatedAt.getTime());
    return res.status(created ? 201 : 200).json({ ok: true, created, updated: !created });
  } catch (e) {
    console.error('POST /devices/register', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * POST /api/devices/ping  (app)
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
 * GET /api/devices/public-count  (app, via x-app-key)
 */
router.get('/public-count', requireAppKey, async (req, res) => {
  try {
    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    const filter = {};
    const activeFilter = { lastSeenAt: { $gte: since } };
    if (req.query.communeId) {
      filter.communeId = String(req.query.communeId);
      activeFilter.communeId = String(req.query.communeId);
    }

    const [total, active] = await Promise.all([
      Device.countDocuments(filter),
      Device.countDocuments(activeFilter),
    ]);

    res.json({ count: total, active, activeDays: nd });
  } catch (e) {
    console.error('GET /devices/public-count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices/count  (panel)
 * Superadmin : sans header => global ; avec x-commune-id => filtre
 * Admin      : force sa commune
 * TOUJOURS renvoyer countAll (total global) en plus.
 */
router.get('/count', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    const communeId = getFilteredCommuneId(req); // '' => toutes (superadmin)
    const baseFilter = communeId ? { communeId } : {};
    const activeFilter = { ...baseFilter, lastSeenAt: { $gte: since } };

    const [totalScoped, activeScoped, totalAll, activeAll] = await Promise.all([
      Device.countDocuments(baseFilter),
      Device.countDocuments(activeFilter),
      Device.countDocuments({}),                                // 🔑 GLOBAL
      Device.countDocuments({ lastSeenAt: { $gte: since } }),   // 🔑 GLOBAL ACTIF
    ]);

    res.json({
      count: totalScoped,        // filtré (utile si vous l’affichez ailleurs)
      active: activeScoped,
      countAll: totalAll,        // 🔑 total global (à utiliser pour le KPI)
      activeAll: activeAll,      // (optionnel si besoin)
      activeDays: nd,
      communeId: communeId || null,
    });
  } catch (e) {
    console.error('GET /devices/count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/devices (panel, listing)
 */
router.get('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const p  = Math.max(1,  parseInt(req.query.page || '1', 10));
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

    const communeId = getFilteredCommuneId(req); // '' => toutes
    const filter = communeId ? { communeId } : {};

    const [list, total] = await Promise.all([
      Device.find(filter)
        .select('installationId deviceId platform brand model osVersion appVersion lastSeenAt firstSeenAt registeredAt communeId communeName createdAt updatedAt')
        .sort({ lastSeenAt: -1, createdAt: -1 })
        .skip((p-1)*ps)
        .limit(ps)
        .lean(),
      Device.countDocuments(filter),
    ]);

    const items = list.map(normalizeLegacy);
    res.json({ items, page: p, pageSize: ps, total });
  } catch (e) {
    console.error('GET /devices', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

// backend/routes/devices.js
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const Device = require('../models/Device');
const Incident = require('../models/Incident');
const Commune = require('../models/Commune');

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const lc = (v) => String(v ?? '').trim().toLowerCase();

const APP_KEY = process.env.MOBILE_APP_KEY || null;

/* ---------- Commune helpers ---------- */
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function buildCommuneClause(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;

  const exact = [];
  const strings = new Set();

  for (const id of ids) {
    if (typeof id === 'string') strings.add(id);
    else exact.push(id);
  }
  ids.forEach((x) => {
    const s = (x && x.toString) ? x.toString() : null;
    if (s) strings.add(s);
  });

  const regexes = Array.from(strings).map((s) => new RegExp(`^${escapeRegExp(s)}$`, 'i'));
  const ors = [];
  if (exact.length || strings.size) ors.push({ communeId: { $in: [...exact, ...Array.from(strings)] } });
  if (regexes.length) ors.push({ communeId: { $in: regexes } });

  return ors.length ? { $or: ors } : null;
}

/* --------- Protection côté app (clé) --------- */
function requireAppKey(req, res, next) {
  if (!APP_KEY) return res.status(500).json({ message: 'MOBILE_APP_KEY manquante côté serveur' });
  const k = req.header('x-app-key');
  if (k !== APP_KEY) return res.status(403).json({ message: 'Clé app invalide' });
  next();
}

/* --------- Utils affichage legacy --------- */
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

/* ====================================
 *        App mobile
 * ==================================== */

/** POST /api/devices/register */
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
    if (communeId)   update.communeId = lc(communeId);     // ✅ normalise
    if (communeName) update.communeName = String(communeName);

    const doc = await Device.findOneAndUpdate(
      { installationId },
      { $set: update, $setOnInsert: { firstSeenAt: new Date(), installationId } },
      { upsert: true, new: true }
    );

    const created = doc && doc.firstSeenAt && Math.abs(doc.firstSeenAt.getTime() - Date.now()) < 2000;
    return res.status(created ? 201 : 200).json({ ok: true, created: !!created, updated: !created });
  } catch (e) {
    console.error('POST /devices/register', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** POST /api/devices/ping */
router.post('/ping', requireAppKey, async (req, res) => {
  try {
    const { installationId } = req.body || {};
    if (!installationId) return res.status(400).json({ message: 'installationId requis' });

    const set = { lastSeenAt: new Date() };
    ['appVersion','osVersion','brand','model','platform','pushToken','communeId','communeName'].forEach(k => {
      if (req.body[k] !== undefined && req.body[k] !== null) {
        set[k] = (k === 'communeId') ? lc(req.body[k]) : String(req.body[k]); // ✅ normalise communeId
      }
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

/** GET /api/devices/public-count */
router.get('/public-count', requireAppKey, async (req, res) => {
  try {
    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    const andActive = [
      { lastSeenAt:  { $gte: since } },
      { lastActiveAt:{ $gte: since } },
      { updatedAt:   { $gte: since } },
      { createdAt:   { $gte: since } },
    ];

    const andBase = [];
    if (req.query.communeId) {
      const { list } = await communeKeys(req.query.communeId);
      const clause = buildCommuneClause(list);
      if (!clause) return res.json({ count: 0, active: 0, activeDays: nd });
      andBase.push(clause);
    }

    const baseFilter   = andBase.length ? { $and: andBase } : {};
    const activeFilter = andBase.length ? { $and: [...andBase, { $or: andActive }] } : { $or: andActive };

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

/* ====================================
 *        Panel admin / superadmin
 * ==================================== */

function getPanelCommuneRaw(req) {
  return lc(req.headers['x-commune-id'] || req.query.communeId || '');
}

/**
 * Construit un filtre Device pour une commune, avec **fallback** :
 *  - match Device.communeId (tolérant)
 *  - OU installationId présent dans des Incidents de la commune
 */
async function buildDeviceFilterWithFallbackForCommune(rawCommune) {
  if (!rawCommune) return { filter: {}, usedFallback: false };

  const { list } = await communeKeys(rawCommune);
  const clause = buildCommuneClause(list);
  if (!clause) return { filter: { _id: { $exists: false } }, usedFallback: false }; // vide

  // 🔁 Récupère tous les deviceIds qui ont posté un incident dans cette commune
  const incidentDeviceIds = await Incident.distinct('deviceId', clause);

  const orParts = [];
  if (clause.$or && clause.$or.length) orParts.push(...clause.$or);
  if (incidentDeviceIds.length) orParts.push({ installationId: { $in: incidentDeviceIds } });

  if (!orParts.length) return { filter: { _id: { $exists: false } }, usedFallback: false };

  return { filter: { $or: orParts }, usedFallback: incidentDeviceIds.length > 0 };
}

/** GET /api/devices/count */
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
      const raw = req.user.communeId || '';
      const built = await buildDeviceFilterWithFallbackForCommune(raw);
      baseFilter = built.filter;
    } else {
      const raw = getPanelCommuneRaw(req); // vide => toutes
      if (raw) {
        const built = await buildDeviceFilterWithFallbackForCommune(raw);
        baseFilter = built.filter;
      } else {
        baseFilter = {}; // toutes communes
      }
    }

    const activeOr = [
      { lastSeenAt:  { $gte: since } },
      { lastActiveAt:{ $gte: since } },
      { updatedAt:   { $gte: since } },
      { createdAt:   { $gte: since } },
    ];

    const activeFilter = Object.keys(baseFilter).length
      ? { $and: [baseFilter, { $or: activeOr }] }
      : { $or: activeOr };

    const [total, active] = await Promise.all([
      Device.countDocuments(baseFilter),
      Device.countDocuments(activeFilter),
    ]);

    res.json({
      count: total,
      active,
      activeDays: nd,
      communeId: req.user.role === 'admin'
        ? (req.user.communeId || null)
        : (getPanelCommuneRaw(req) || null),
    });
  } catch (e) {
    console.error('GET /devices/count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** GET /api/devices */
router.get('/', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const p  = Math.max(1,  parseInt(req.query.page || '1', 10));
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

    let filter = {};
    if (req.user.role === 'admin') {
      const raw = req.user.communeId || '';
      const built = await buildDeviceFilterWithFallbackForCommune(raw);
      filter = built.filter;
    } else {
      const raw = getPanelCommuneRaw(req); // vide => toutes
      if (raw) {
        const built = await buildDeviceFilterWithFallbackForCommune(raw);
        filter = built.filter;
      } else {
        filter = {};
      }
    }

    const [list, total] = await Promise.all([
      Device.find(filter)
        .select('installationId deviceId platform brand model osVersion appVersion lastSeenAt lastActiveAt firstSeenAt registeredAt communeId communeName createdAt updatedAt')
        .sort({ lastSeenAt: -1, lastActiveAt: -1, updatedAt: -1, createdAt: -1 })
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

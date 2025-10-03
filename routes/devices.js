// backend/routes/devices.js
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const Device = require('../models/Device');
const Commune = require('../models/Commune');

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const lc = (v) => String(v ?? '').trim().toLowerCase();

const APP_KEY = process.env.MOBILE_APP_KEY || null;

/* ------------------- APP KEY (côté mobile) ------------------- */
function requireAppKey(req, res, next) {
  if (!APP_KEY) return res.status(500).json({ message: 'MOBILE_APP_KEY manquante côté serveur' });
  const k = req.header('x-app-key');
  if (k !== APP_KEY) return res.status(403).json({ message: 'Clé app invalide' });
  next();
}

/* ------------------- Helpers d’affichage (legacy) ------------------- */
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

/* ------------------- Helpers COMMUNE (slug <-> ObjectId) ------------------- */
async function communeKeys(anyId) {
  const raw = lc(anyId);
  if (!raw) return { list: [] };

  const out = new Set();
  out.add(raw);

  if (isObjectId(raw)) {
    // garde la string de l’ObjectId
    out.add(String(raw));
    // et l’instance ObjectId (au cas où)
    try { out.add(new mongoose.Types.ObjectId(raw)); } catch {}
    // slug correspondant
    const c = await Commune.findById(raw).lean();
    if (c?.slug) out.add(lc(c.slug));
  } else {
    // raw est un slug → récupérer _id
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

/**
 * Device.communeId est stocké en **string** (slug ou id).
 * On construit une **clause tolérante** qui matche :
 *  - les valeurs exactes (string)
 *  - et insensible à la casse via RegExp ^...$ (i)
 */
function buildCommuneClauseForStringField(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;

  const strings = new Set();
  ids.forEach(x => strings.add(String(x)));

  const exact = Array.from(strings);
  const regexes = exact.map(s => new RegExp(`^${escapeRegExp(s)}$`, 'i'));

  return { $or: [{ communeId: { $in: exact } }, { communeId: { $in: regexes } }] };
}

/**
 * Renvoie la clause de filtre par commune “côté panel” :
 *  - admin      : toujours sa commune (on ne lit PAS le header)
 *  - superadmin : si header x-commune-id → filtre ; sinon → pas de filtre
 *  - autres     : null (non autorisé)
 */
async function panelCommuneFilter(req) {
  if (!req.user) return { error: { status: 401, message: 'Non connecté' } };

  if (req.user.role === 'admin') {
    const { list } = await communeKeys(req.user.communeId || '');
    const clause = buildCommuneClauseForStringField(list);
    if (!clause) return { empty: true };
    return { clause };
  }

  if (req.user.role === 'superadmin') {
    const raw = lc(req.headers['x-commune-id'] || req.query.communeId || '');
    if (!raw) return { clause: {} }; // pas de filtre → toutes communes
    const { list } = await communeKeys(raw);
    const clause = buildCommuneClauseForStringField(list);
    if (!clause) return { empty: true };
    return { clause };
  }

  return { error: { status: 403, message: 'Accès interdit' } };
}

/* ------------------- LOG (optionnel) ------------------- */
router.use((req, _res, next) => { console.log(`[devices] ${req.method} ${req.originalUrl}`); next(); });

/* ===================== CÔTÉ APP ===================== */

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

/** POST /api/devices/ping */
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

/** GET /api/devices/public-count  (protégé par x-app-key)
 *  ?activeDays=30
 *  ?communeId=<slug|ObjectId>  ← tolérant slug/ObjectId
 */
router.get('/public-count', requireAppKey, async (req, res) => {
  try {
    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    let baseFilter = {};
    let activeFilter = { lastSeenAt: { $gte: since } };

    const raw = lc(req.query.communeId || '');
    if (raw) {
      const { list } = await communeKeys(raw);
      const clause = buildCommuneClauseForStringField(list);
      if (!clause) return res.json({ count: 0, active: 0, activeDays: nd });

      baseFilter   = { ...baseFilter, ...clause };
      activeFilter = { ...activeFilter, ...clause };
    }

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

/* ===================== CÔTÉ PANEL (admin/superadmin) ===================== */

/** GET /api/devices/count
 *  Admin : sa commune forcée (tolérance slug/ObjectId)
 *  Superadmin : header x-commune-id facultatif (tolérant)
 */
router.get('/count', auth, requireRole('admin','superadmin'), async (req, res) => {
  try {
    const nd = Math.max(1, parseInt(req.query.activeDays || '30', 10));
    const since = new Date(Date.now() - nd * 24 * 60 * 60 * 1000);

    const { clause, empty, error } = await panelCommuneFilter(req);
    if (error) return res.status(error.status).json({ message: error.message });
    if (empty)  return res.json({ count: 0, active: 0, activeDays: nd, communeId: null });

    const baseFilter   = clause || {};
    const activeFilter = { ...(clause || {}), lastSeenAt: { $gte: since } };

    const [total, active] = await Promise.all([
      Device.countDocuments(baseFilter),
      Device.countDocuments(activeFilter),
    ]);

    res.json({ count: total, active, activeDays: nd, communeId: clause ? true : null });
  } catch (e) {
    console.error('GET /devices/count', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** GET /api/devices (liste paginée)
 *  Même logique de filtre que /count
 */
router.get('/', auth, requireRole('admin','superadmin'), async (req, res) => {
  try {
    const p  = Math.max(1,  parseInt(req.query.page || '1', 10));
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)));

    const { clause, empty, error } = await panelCommuneFilter(req);
    if (error) return res.status(error.status).json({ message: error.message });
    if (empty)  return res.json({ items: [], page: p, pageSize: ps, total: 0 });

    const filter = clause || {};

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

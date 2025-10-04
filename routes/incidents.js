// backend/routes/incidents.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');

const Incident = require('../models/Incident');
const Commune  = require('../models/Commune');

const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

const auth = require('../middleware/authMiddleware');

const APP_KEY = process.env.MOBILE_APP_KEY || null;
const isMobile = (req) => APP_KEY && req.header('x-app-key') === APP_KEY;

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const lc = (v) => String(v ?? '').trim().toLowerCase();

/* ------------------------ Helpers communes ------------------------ */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recherche d'une commune par plusieurs champs (tolérant et insensible à la casse) :
 *  - _id
 *  - slug
 *  - name / label / communeName / nom
 *  - code
 */
async function findCommuneByAny(anyId) {
  const raw = String(anyId ?? '').trim();
  if (!raw) return null;

  // 1) par _id direct
  if (isObjectId(raw)) {
    const c = await Commune.findById(raw).lean();
    if (c) return c;
  }

  // 2) par slug exact (case-insensitive)
  let c = await Commune.findOne({ slug: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  // 3) par noms possibles
  const nameFields = ['name', 'label', 'communeName', 'nom'];
  for (const f of nameFields) {
    c = await Commune.findOne({ [f]: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
    if (c) return c;
  }

  // 4) par code exact
  c = await Commune.findOne({ code: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  return null;
}

/**
 * Retourne une **clé canonique** pour stockage (préférence au slug, sinon _id string, sinon la valeur lowercased)
 */
async function toCanonicalCommuneKey(anyId) {
  const raw = lc(anyId);
  if (!raw) return null;
  const c = await findCommuneByAny(raw);
  if (!c) return raw; // fallback : garde la valeur fournie (en minuscule)
  return lc(c.slug || String(c._id));
}

/**
 * Construit une clause $or tolérante pour filtrer communeId (slug / _id / nom / code + regex)
 */
async function buildCommuneClauseFrom(anyId) {
  const raw = lc(anyId);
  if (!raw) return null;

  const variants = new Set();
  variants.add(raw);

  const c = await findCommuneByAny(raw);
  if (c) {
    if (c.slug) variants.add(lc(c.slug));
    if (c._id) {
      variants.add(String(c._id));
      try { variants.add(new mongoose.Types.ObjectId(String(c._id))); } catch {}
    }
    // On ajoute aussi les variantes textuelles connues si présentes
    ['name', 'label', 'communeName', 'nom', 'code'].forEach((f) => {
      if (c[f]) variants.add(lc(String(c[f])));
    });
  }

  // Si raw ressemble à un ObjectId, ajoute aussi l’ObjectId natif
  if (isObjectId(raw)) {
    try { variants.add(new mongoose.Types.ObjectId(raw)); } catch {}
    variants.add(String(raw));
  }

  const strings = [];
  const objectIds = [];
  for (const v of variants) {
    if (typeof v === 'string') strings.push(v);
    else objectIds.push(v);
  }
  const regexes = strings.map((s) => new RegExp(`^${escapeRegExp(s)}$`, 'i'));

  const ors = [];
  if (objectIds.length || strings.length) ors.push({ communeId: { $in: [...strings, ...objectIds] } });
  if (regexes.length) ors.push({ communeId: { $in: regexes } });

  return ors.length ? { $or: ors } : null;
}

/** lit la commune envoyée par le panel (header ou query) */
function getPanelCommuneRaw(req) {
  return lc(req.header('x-commune-id') || req.query.communeId || '');
}

/* ===== Auth optionnelle : l’app mobile passe avec x-app-key, le panel avec JWT ===== */
function authOptional(req, res, next) {
  if (isMobile(req)) return next();
  return auth(req, res, next);
}

/* ========================== ROUTES ========================== */

/**
 * GET /api/incidents
 *  - MOBILE : deviceId requis ; communeId optionnel (si fourni → filtre)
 *  - PANEL  :
 *      * admin      -> filtre sur x-commune-id/query si présent, sinon req.user.communeId ; sinon retourne []
 *      * superadmin -> filtre sur x-commune-id/query si présent, sinon global (toutes communes)
 *  - period=7|30 pour limiter par date de création
 */
router.get('/', authOptional, async (req, res) => {
  try {
    const and = [];

    if (isMobile(req)) {
      // ---- Mobile
      const deviceId = String(req.query.deviceId || req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
      and.push({ deviceId });

      // Filtre commune (optionnel côté app)
      const raw = lc(req.query.communeId || req.header('x-commune-id') || '');
      if (raw) {
        const clause = await buildCommuneClauseFrom(raw);
        if (clause) and.push(clause);
      }
    } else {
      // ---- Panel
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });

      if (req.user.role === 'admin') {
        // priorité au header/query ; sinon sa commune
        const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
        if (raw) {
          const clause = await buildCommuneClauseFrom(raw);
          if (clause) and.push(clause);
          else return res.json([]); // admin sans commune reconnue → 200 []
        } else {
          return res.json([]); // admin sans commune → 200 []
        }
      } else if (req.user.role === 'superadmin') {
        const raw = getPanelCommuneRaw(req);
        if (raw) {
          const clause = await buildCommuneClauseFrom(raw);
          if (clause) and.push(clause);
        }
        // sinon pas de filtre → superadmin voit tout
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      // période (facultatif)
      const { period } = req.query;
      if (period === '7' || period === '30') {
        const days = parseInt(period, 10);
        and.push({ createdAt: { $gte: new Date(Date.now() - days * 86400000) } });
      }

      // filtre device (facultatif panel)
      if (req.query.deviceId) and.push({ deviceId: String(req.query.deviceId) });
    }

    const filter = and.length ? { $and: and } : {};
    const incidents = await Incident.find(filter).sort({ createdAt: -1 }).lean();
    return res.json(incidents);
  } catch (err) {
    console.error('❌ GET /incidents', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/incidents/count
 * Compte les incidents (mêmes règles de filtre que GET /api/incidents, sans deviceId obligatoire).
 */
router.get('/count', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const and = [];
    if (req.user.role === 'admin') {
      const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (raw) {
        const clause = await buildCommuneClauseFrom(raw);
        if (clause) and.push(clause);
        else return res.json({ total: 0 });
      } else {
        return res.json({ total: 0 });
      }
    } else {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const clause = await buildCommuneClauseFrom(raw);
        if (clause) and.push(clause);
      }
      // sinon global pour superadmin
    }

    const { period } = req.query;
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      and.push({ createdAt: { $gte: new Date(Date.now() - days * 86400000) } });
    }

    const filter = and.length ? { $and: and } : {};
    const total = await Incident.countDocuments(filter);
    res.json({ total });
  } catch (err) {
    console.error('❌ GET /incidents/count', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * POST /api/incidents  (mobile + panel)
 * Mobile : deviceId requis + communeId (corps ou header) requis → on stocke en clé canonique.
 * Panel  : si admin sans commune dans le body → on rattache automatiquement à sa commune (clé canonique).
 */
router.post('/', upload.single('media'), async (req, res) => {
  try {
    const {
      title, description, lieu, status,
      latitude, longitude, adresse,
      adminComment, deviceId, communeId,
    } = req.body || {};

    // Exigences champs de base
    if (!title || !description || !lieu || !latitude || !longitude || !deviceId) {
      return res.status(400).json({ message: '❌ Champs requis manquants.' });
    }

    // Contraintes mobile
    if (isMobile(req)) {
      if (!deviceId)  return res.status(400).json({ message: 'deviceId requis (mobile)' });
      // il faut absolument une commune (corps ou header)
      if (!communeId && !req.header('x-commune-id')) {
        return res.status(400).json({ message: 'communeId requis (mobile)' });
      }
    }

    const mediaUrl  = req.file ? (req.file.path || req.file.secure_url || req.file.url) : null;
    const mimeType  = req.file ? (req.file.mimetype || '') : '';
    const mediaType = mimeType.startsWith('video') ? 'video' : 'image';

    const newIncident = new Incident({
      title,
      description,
      lieu,
      status: status || 'En cours',
      latitude,
      longitude,
      adresse,
      adminComment,
      deviceId,
      mediaUrl,
      mediaType,
      createdAt: new Date(),
    });

    // Détermine la commune et stocke la **clé canonique**
    const rawFromReq =
      communeId ||
      req.header('x-commune-id') ||
      (req.user?.role === 'admin' ? req.user.communeId : '');

    const canonicalKey = await toCanonicalCommuneKey(rawFromReq);
    if (canonicalKey) newIncident.communeId = canonicalKey;

    const saved = await newIncident.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error("❌ POST /incidents", err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement." });
  }
});

/**
 * PUT /api/incidents/:id
 * Mobile : deviceId requis, remet updated=false (acquittement)
 * Panel  : filtre d’accès par commune tolérant
 */
router.put('/:id', authOptional, async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: '❌ ID invalide' });

  try {
    if (isMobile(req)) {
      const deviceId = String(req.query.deviceId || req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });

      const incident = await Incident.findOne({ _id: id, deviceId });
      if (!incident) return res.status(404).json({ message: '⚠️ Incident introuvable pour ce device' });

      const updatedIncident = await Incident.findByIdAndUpdate(
        id,
        { $set: { updated: false } },
        { new: true, runValidators: true }
      );
      return res.json(updatedIncident);
    }

    if (!req.user) return res.status(401).json({ message: 'Non connecté' });

    const and = [{ _id: id }];
    if (req.user.role === 'admin') {
      const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw) return res.status(403).json({ message: 'Accès interdit' });
      const clause = await buildCommuneClauseFrom(raw);
      if (!clause) return res.status(403).json({ message: 'Accès interdit' });
      and.push(clause);
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const clause = await buildCommuneClauseFrom(raw);
        if (!clause) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
        and.push(clause);
      }
    } else {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const body = { ...req.body, updated: true };
    if (body.communeId) body.communeId = await toCanonicalCommuneKey(body.communeId);

    const updatedIncident = await Incident.findOneAndUpdate({ $and: and }, body, {
      new: true,
      runValidators: true,
    });
    if (!updatedIncident) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    res.json(updatedIncident);
  } catch (error) {
    console.error('❌ PUT /incidents/:id', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
});

/**
 * DELETE /api/incidents/:id
 * Panel : filtre d’accès par commune tolérant
 */
router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: '❌ ID invalide' });

  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });

    const and = [{ _id: id }];
    if (req.user.role === 'admin') {
      const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw) return res.status(403).json({ message: 'Accès interdit' });
      const clause = await buildCommuneClauseFrom(raw);
      if (!clause) return res.status(403).json({ message: 'Accès interdit' });
      and.push(clause);
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const clause = await buildCommuneClauseFrom(raw);
        if (!clause) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
        and.push(clause);
      }
    } else {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const deleted = await Incident.findOneAndDelete({ $and: and });
    if (!deleted) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    res.json({ message: '✅ Incident supprimé' });
  } catch (error) {
    console.error('❌ DELETE /incidents/:id', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/incidents/:id
 * Mobile : deviceId requis
 * Panel  : filtre d’accès par commune tolérant
 */
router.get('/:id', authOptional, async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide' });

  try {
    let incident;
    if (isMobile(req)) {
      const deviceId = String(req.query.deviceId || req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
      incident = await Incident.findOne({ _id: id, deviceId }).lean();
    } else {
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });

      const and = [{ _id: id }];
      if (req.user.role === 'admin') {
        const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
        if (!raw) return res.status(403).json({ message: 'Accès interdit' });
        const clause = await buildCommuneClauseFrom(raw);
        if (!clause) return res.status(403).json({ message: 'Accès interdit' });
        and.push(clause);
      } else if (req.user.role === 'superadmin') {
        const raw = getPanelCommuneRaw(req);
        if (raw) {
          const clause = await buildCommuneClauseFrom(raw);
          if (!clause) return res.status(404).json({ message: 'Incident non trouvé' });
          and.push(clause);
        }
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      incident = await Incident.findOne({ $and: and }).lean();
    }

    if (!incident) return res.status(404).json({ message: 'Incident non trouvé' });
    res.json(incident);
  } catch (error) {
    console.error('❌ GET /incidents/:id', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

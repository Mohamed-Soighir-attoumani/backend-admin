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

/* ---------- helpers communes ---------- */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cherche une commune par (slug | _id | name | code), insensible à la casse
async function findCommuneByAny(anyId) {
  const raw = String(anyId ?? '').trim();
  if (!raw) return null;

  // 1) _id
  if (isObjectId(raw)) {
    const c = await Commune.findById(raw).lean();
    if (c) return c;
  }

  // 2) slug exact (case-insensitive)
  let c = await Commune.findOne({ slug: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  // 3) name exact (case-insensitive) — si ton modèle a "name" ou "label", ajuste ici
  c = await Commune.findOne({ name: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  // 4) code exact (case-insensitive) — optionnel selon ton schéma
  c = await Commune.findOne({ code: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  return null;
}

// Retourne une **clé canonique** (slug si dispo, sinon _id string, sinon la valeur lowercased)
async function toCanonicalCommuneKey(anyId) {
  const raw = lc(anyId);
  if (!raw) return null;
  const c = await findCommuneByAny(raw);
  if (!c) return raw; // fallback: on garde la valeur telle qu’envoyée en minuscule
  return lc(c.slug || String(c._id));
}

/** Construit une clause $or tolérante pour filtrer communeId */
async function buildCommuneClauseFrom(anyId) {
  const raw = lc(anyId);
  if (!raw) return null;

  const variants = new Set();
  variants.add(raw);

  // Ajoute les infos de la commune trouvée (slug + _id)
  const c = await findCommuneByAny(raw);
  if (c) {
    if (c.slug) variants.add(lc(c.slug));
    if (c._id) {
      variants.add(String(c._id));
      try { variants.add(new mongoose.Types.ObjectId(String(c._id))); } catch {}
    }
  }

  // Si raw ressemble à un ObjectId, ajoute aussi l’ObjectId
  if (isObjectId(raw)) {
    try { variants.add(new mongoose.Types.ObjectId(raw)); } catch {}
    variants.add(String(raw));
  }

  // Construire la clause (match exact strings/ids + regex insensible à la casse)
  const strings = [];
  const objectIds = [];
  for (const v of variants) {
    if (typeof v === 'string') strings.push(v);
    else objectIds.push(v); // ObjectId
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

/* ===== auth optionnelle (mobile passe avec x-app-key) ===== */
function authOptional(req, res, next) {
  if (isMobile(req)) return next();
  return auth(req, res, next);
}

/* ─────────────── GET /api/incidents ───────────────
   - MOBILE : deviceId obligé ; communeId optionnelle (filtre si fourni)
   - PANEL  :
       * admin      -> x-commune-id/query si présent, sinon req.user.communeId ; sinon → []
       * superadmin -> x-commune-id/query facultatif (sinon toutes)
*/
router.get('/', authOptional, async (req, res) => {
  try {
    const and = [];

    // ====== Mobile
    if (isMobile(req)) {
      const deviceId = String(req.query.deviceId || req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
      and.push({ deviceId });

      const raw = lc(req.query.communeId || req.header('x-commune-id') || '');
      if (raw) {
        const clause = await buildCommuneClauseFrom(raw);
        if (clause) and.push(clause);
      }
    } else {
      // ====== Panel
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });

      if (req.user.role === 'admin') {
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
        // sinon : pas de filtre → voit tout
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      const { period } = req.query;
      if (period === '7' || period === '30') {
        const days = parseInt(period, 10);
        and.push({ createdAt: { $gte: new Date(Date.now() - days * 86400000) } });
      }

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

/* ─────────────── GET /api/incidents/count ─────────────── */
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
      // sinon global
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

/* ─────────────── POST /api/incidents (mobile + panel) ─────────────── */
router.post('/', upload.single('media'), async (req, res) => {
  try {
    const {
      title, description, lieu, status,
      latitude, longitude, adresse,
      adminComment, deviceId, communeId,
    } = req.body || {};

    if (isMobile(req)) {
      if (!deviceId)  return res.status(400).json({ message: 'deviceId requis (mobile)' });
      // On **exige** une commune pour correctement rattacher côté multi-commune
      if (!communeId && !req.header('x-commune-id')) {
        return res.status(400).json({ message: 'communeId requis (mobile)' });
      }
    }

    if (!title || !description || !lieu || !latitude || !longitude || !deviceId) {
      return res.status(400).json({ message: '❌ Champs requis manquants.' });
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

    // Normalisation robuste de la commune
    const rawFromReq =
      communeId ||
      req.header('x-commune-id') || // app mobile peut aussi le mettre en header
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

/* ─────────────── PUT /api/incidents/:id ─────────────── */
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

/* ─────────────── DELETE /api/incidents/:id ─────────────── */
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

/* ─────────────── GET /api/incidents/:id ─────────────── */
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

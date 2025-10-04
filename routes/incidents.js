// backend/routes/incidents.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');

const Incident = require('../models/Incident');
const Commune  = require('../models/Commune');
const User     = require('../models/User');

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

/** Cherche une commune par (_id | slug | name/label/communeName/nom | code) */
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

  // 3) nom exact (différents champs)
  const nameFields = ['name', 'label', 'communeName', 'nom'];
  for (const f of nameFields) {
    c = await Commune.findOne({ [f]: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
    if (c) return c;
  }

  // 4) code exact
  c = await Commune.findOne({ code: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  return null;
}

/**
 * 🔒 Version STRICTE : retourne { key, commune }
 * - key = slug (minuscule) si dispo, sinon String(_id)
 * - si aucune commune trouvée → null (on NE stocke pas une valeur inconnue)
 */
async function resolveCommuneStrict(anyId) {
  const c = await findCommuneByAny(anyId);
  if (!c) return null;
  const key = lc(c.slug || String(c._id));
  return { key, commune: c };
}

/**
 * Construit une clause de filtre commune robuste à partir d'un identifiant "au hasard".
 * On essaie d’abord de résoudre une commune connue ; si trouvée on matche sur sa clé canonique
 * + son _id string (compat). Sinon on tente des équivalences par regex pour rester tolérant.
 */
async function buildCommuneClauseFrom(anyId) {
  const raw = lc(anyId);
  if (!raw) return null;

  const known = await resolveCommuneStrict(raw);
  if (known) {
    const idStr = String(known.commune._id);
    return { $or: [{ communeId: known.key }, { communeId: idStr }] };
  }

  // Fallback "tolérant" (si aucun match direct en base commune)
  const regex = new RegExp(`^${escapeRegExp(raw)}$`, 'i');
  return { $or: [{ communeId: raw }, { communeId: regex }] };
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
        let raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');

        // filet de sécurité : si vide, recharger l'utilisateur
        if (!raw && req.user?.id) {
          const u = await User.findById(req.user.id).select('communeId').lean();
          raw = lc(u?.communeId || '');
        }

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
        // sinon superadmin voit tout
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
      let raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw && req.user?.id) {
        const u = await User.findById(req.user.id).select('communeId').lean();
        raw = lc(u?.communeId || '');
      }
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
 * 👉 STRICT : on n’enregistre l’incident que si la commune envoyée correspond
 * à une commune en base. Sinon 400.
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

    // 🔒 Commune STRICTE (slug minuscule ou _id string)
    const rawFromReq =
      communeId ||
      req.header('x-commune-id') ||
      (req.user?.role === 'admin' ? req.user.communeId : '');

    const resolved = await resolveCommuneStrict(rawFromReq);
    if (!resolved) {
      return res.status(400).json({ message: "communeId inconnu : fournissez un slug/_id/nom/code d'une commune existante" });
    }
    newIncident.communeId = resolved.key;

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
      let raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw && req.user?.id) {
        const u = await User.findById(req.user.id).select('communeId').lean();
        raw = lc(u?.communeId || '');
      }
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
    if (body.communeId) {
      const r = await resolveCommuneStrict(body.communeId);
      if (!r) return res.status(400).json({ message: "communeId inconnu" });
      body.communeId = r.key;
    }

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
      let raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw && req.user?.id) {
        const u = await User.findById(req.user.id).select('communeId').lean();
        raw = lc(u?.communeId || '');
      }
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
        let raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
        if (!raw && req.user?.id) {
          const u = await User.findById(req.user.id).select('communeId').lean();
          raw = lc(u?.communeId || '');
        }
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

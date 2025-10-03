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

/* ---------- Commune helpers ---------- */
async function communeKeys(anyId) {
  const raw = lc(anyId);
  if (!raw) return { list: [] };

  const out = new Set();
  out.add(raw);

  // Ajoute variantes ObjectId et slug
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

/** Clause tolérante (string/ObjectId/casse) */
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

/** lit la commune envoyée par le panel (header ou query) */
function getPanelCommuneRaw(req) {
  return lc(req.header('x-commune-id') || req.query.communeId || '');
}

/* ===== auth optionnelle pour laisser passer l’app mobile ===== */
function authOptional(req, res, next) {
  if (isMobile(req)) return next();
  return auth(req, res, next);
}

/* ─────────────── GET /api/incidents ───────────────
   - MOBILE : deviceId oblig., communeId optionnel (filtre si fourni)
   - PANEL  :
       * admin      -> PRIORITÉ à x-commune-id/query ; sinon req.user.communeId ; sinon 400
       * superadmin -> x-commune-id/query facultatif (sinon toutes communes)
*/
router.get('/', authOptional, async (req, res) => {
  try {
    const and = [];

    if (isMobile(req)) {
      const deviceId = String(req.query.deviceId || req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
      and.push({ deviceId });

      if (req.query.communeId || req.header('x-commune-id')) {
        const raw = lc(req.query.communeId || req.header('x-commune-id'));
        const { list } = await communeKeys(raw);
        const clause = buildCommuneClause(list);
        if (clause) and.push(clause);
      }
    } else {
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });

      if (req.user.role === 'admin') {
        // 🔴 FIX: on accepte x-commune-id/query si présent, sinon token
        const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
        if (!raw) return res.status(400).json({ message: 'communeId requis' });

        const { list } = await communeKeys(raw);
        const clause = buildCommuneClause(list);
        if (!clause) return res.json([]);
        and.push(clause);
      } else if (req.user.role === 'superadmin') {
        const raw = getPanelCommuneRaw(req);
        if (raw) {
          const { list } = await communeKeys(raw);
          const clause = buildCommuneClause(list);
          if (!clause) return res.json([]);
          and.push(clause);
        }
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
    res.json(incidents);
  } catch (err) {
    console.error('❌ GET /incidents', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ─────────────── GET /api/incidents/count ─────────────── */
router.get('/count', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const and = [];
    if (req.user.role === 'admin') {
      // 🔴 FIX: priorité header/query
      const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw) return res.status(400).json({ message: 'communeId requis' });

      const { list } = await communeKeys(raw);
      const clause = buildCommuneClause(list);
      if (!clause) return res.json({ total: 0 });
      and.push(clause);
    } else {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const { list } = await communeKeys(raw);
        const clause = buildCommuneClause(list);
        if (!clause) return res.json({ total: 0 });
        and.push(clause);
      }
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
      if (!communeId) return res.status(400).json({ message: 'communeId requis (mobile)' });
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

    if (communeId) newIncident.communeId = lc(communeId); // normalise
    else if (!isMobile(req) && req.user?.role === 'admin' && req.user?.communeId) {
      newIncident.communeId = lc(req.user.communeId);
    }

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
      // 🔴 FIX: priorité header/query
      const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw) return res.status(400).json({ message: 'communeId requis' });

      const { list } = await communeKeys(raw);
      const clause = buildCommuneClause(list);
      if (!clause) return res.status(403).json({ message: 'Accès interdit' });
      and.push(clause);
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const { list } = await communeKeys(raw);
        const clause = buildCommuneClause(list);
        if (!clause) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
        and.push(clause);
      }
    } else {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const body = { ...req.body, updated: true };
    if (body.communeId) body.communeId = lc(body.communeId);

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
      // 🔴 FIX: priorité header/query
      const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
      if (!raw) return res.status(400).json({ message: 'communeId requis' });

      const { list } = await communeKeys(raw);
      const clause = buildCommuneClause(list);
      if (!clause) return res.status(403).json({ message: 'Accès interdit' });
      and.push(clause);
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const { list } = await communeKeys(raw);
        const clause = buildCommuneClause(list);
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
        // 🔴 FIX: priorité header/query
        const raw = getPanelCommuneRaw(req) || lc(req.user.communeId || '');
        if (!raw) return res.status(400).json({ message: 'communeId requis' });

        const { list } = await communeKeys(raw);
        const clause = buildCommuneClause(list);
        if (!clause) return res.status(403).json({ message: 'Accès interdit' });
        and.push(clause);
      } else if (req.user.role === 'superadmin') {
        const raw = getPanelCommuneRaw(req);
        if (raw) {
          const { list } = await communeKeys(raw);
          const clause = buildCommuneClause(list);
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

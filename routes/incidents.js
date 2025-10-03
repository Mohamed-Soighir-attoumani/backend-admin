const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');

const Incident = require('../models/Incident');
const Commune  = require('../models/Commune');

const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

const auth = require('../middleware/authMiddleware');

// 🔐 même valeur que MOBILE_APP_KEY dans .env serveur
const APP_KEY = process.env.MOBILE_APP_KEY || null;
const isMobile = (req) => APP_KEY && req.header('x-app-key') === APP_KEY;

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const getDeviceIdFromReq = (req) =>
  String(req.query.deviceId || req.body?.deviceId || '').trim();

const lc = (v) => String(v ?? '').trim().toLowerCase();

/* ------------------------------------------------------------------ */
/* Helpers commune : accepte slug ET ObjectId, et renvoie toutes formes
   (slug, string(ObjectId), ObjectId natif) pour matcher tous schémas  */
async function communeKeys(anyId) {
  const raw = lc(anyId);
  if (!raw) return { list: [] };

  const out = new Set();

  // Toujours garder la valeur brute en string minuscule
  out.add(raw);

  if (isObjectId(raw)) {
    // Ajouter l'ObjectId natif + sa string
    try { out.add(new mongoose.Types.ObjectId(raw)); } catch {}
    out.add(String(raw));

    // Tenter de récupérer le slug relié
    const c = await Commune.findById(raw).lean();
    if (c?.slug) out.add(lc(c.slug));
  } else {
    // raw semble être un slug -> récupérer l'_id
    const c = await Commune.findOne({ slug: raw }).lean();
    if (c?._id) {
      out.add(String(c._id));
      try { out.add(new mongoose.Types.ObjectId(String(c._id))); } catch {}
    }
  }

  return { list: Array.from(out) };
}

/* Utilitaire: récupère la commune côté panel depuis header OU query */
function getPanelCommuneRaw(req) {
  return lc(req.header('x-commune-id') || req.query.communeId || '');
}

/* ===== helper pour autoriser anonyme (mobile) ou connecté (panel) ===== */
function authOptional(req, res, next) {
  if (isMobile(req)) return next(); // mobile → pas d’auth JWT
  return auth(req, res, next);      // panel → JWT requis
}
/* ------------------------------------------------------------------ */

/* ──────────────── GET /api/incidents ────────────────
   - MOBILE : deviceId obligatoire (communeId optionnel)
   - PANEL  : 
       * admin      -> force sa commune
       * superadmin -> communeId facultatif (toutes si absent)
*/
router.get('/', authOptional, async (req, res) => {
  try {
    const filter = {};

    if (isMobile(req)) {
      const deviceId = getDeviceIdFromReq(req);
      if (!deviceId) {
        return res.status(400).json({ message: 'deviceId requis (mobile)' });
      }
      filter.deviceId = deviceId;

      // (optionnel) filtre commune envoyé par l’app
      if (req.query.communeId) {
        const { list: ids } = await communeKeys(req.query.communeId);
        if (ids.length) filter.communeId = { $in: ids };
      }
    } else {
      // PANEL
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });

      if (req.user.role === 'admin') {
        // ✅ toujours forcer la commune de l’admin (pas d’erreur si header diffère)
        const { list: ids } = await communeKeys(req.user.communeId || '');
        if (!ids.length) return res.json([]); // admin sans commune rattachée
        filter.communeId = { $in: ids };
      } else if (req.user.role === 'superadmin') {
        const raw = getPanelCommuneRaw(req);
        if (raw) {
          const { list: ids } = await communeKeys(raw);
          if (!ids.length) return res.json([]);
          filter.communeId = { $in: ids };
        }
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      // Période (optionnelle)
      const { period } = req.query;
      if (period === '7' || period === '30') {
        const days = parseInt(period, 10);
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: fromDate };
      }

      // (optionnel) filtre deviceId depuis le panel
      if (req.query.deviceId) filter.deviceId = String(req.query.deviceId);
    }

    const incidents = await Incident.find(filter).sort({ createdAt: -1 }).lean();
    res.json(incidents);
  } catch (err) {
    console.error('❌ Erreur récupération incidents:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/count ──────────────── */
router.get('/count', auth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    if (!['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const filter = {};

    if (req.user.role === 'admin') {
      const { list: ids } = await communeKeys(req.user.communeId || '');
      if (!ids.length) return res.json({ total: 0 });
      filter.communeId = { $in: ids };
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const { list: ids } = await communeKeys(raw);
        if (!ids.length) return res.json({ total: 0 });
        filter.communeId = { $in: ids };
      }
    }

    const { period } = req.query;
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filter.createdAt = { $gte: fromDate };
    }

    const total = await Incident.countDocuments(filter);
    res.json({ total });
  } catch (err) {
    console.error('❌ Erreur récupération count incidents:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── POST /api/incidents ────────────────
   - Mobile (clé app) : multipart/form-data, communeId OBLIGATOIRE
   - Panel : passe aussi
*/
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

    if (communeId) newIncident.communeId = String(communeId);

    const saved = await newIncident.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error("❌ Erreur serveur (POST /incidents) :", err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement." });
  }
});

/* ──────────────── PUT /api/incidents/:id ──────────────── */
router.put('/:id', authOptional, async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    if (isMobile(req)) {
      const deviceId = getDeviceIdFromReq(req);
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

    // PANEL
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });

    const filter = { _id: id };
    if (req.user.role === 'admin') {
      const { list: ids } = await communeKeys(req.user.communeId || '');
      if (!ids.length) return res.status(403).json({ message: 'Accès interdit' });
      filter.communeId = { $in: ids };
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const { list: ids } = await communeKeys(raw);
        if (!ids.length) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
        filter.communeId = { $in: ids };
      }
    } else {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const body = { ...req.body, updated: true };
    const updatedIncident = await Incident.findOneAndUpdate(filter, body, {
      new: true,
      runValidators: true,
    });
    if (!updatedIncident) {
      return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    }
    res.json(updatedIncident);
  } catch (error) {
    console.error('❌ Erreur modification :', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
});

/* ──────────────── DELETE /api/incidents/:id ──────────────── */
router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });

    const filter = { _id: id };
    if (req.user.role === 'admin') {
      const { list: ids } = await communeKeys(req.user.communeId || '');
      if (!ids.length) return res.status(403).json({ message: 'Accès interdit' });
      filter.communeId = { $in: ids };
    } else if (req.user.role === 'superadmin') {
      const raw = getPanelCommuneRaw(req);
      if (raw) {
        const { list: ids } = await communeKeys(raw);
        if (!ids.length) return res.status(404).json({ message: '⚠️ Incident non trouvé' });
        filter.communeId = { $in: ids };
      }
    } else {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const deleted = await Incident.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    }
    res.json({ message: '✅ Incident supprimé' });
  } catch (error) {
    console.error('❌ Erreur suppression :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/:id ──────────────── */
router.get('/:id', authOptional, async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    let incident;
    if (isMobile(req)) {
      const deviceId = getDeviceIdFromReq(req);
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
      incident = await Incident.findOne({ _id: id, deviceId }).lean();
    } else {
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });

      const filter = { _id: id };
      if (req.user.role === 'admin') {
        const { list: ids } = await communeKeys(req.user.communeId || '');
        if (!ids.length) return res.status(403).json({ message: 'Accès interdit' });
        filter.communeId = { $in: ids };
      } else if (req.user.role === 'superadmin') {
        const raw = getPanelCommuneRaw(req);
        if (raw) {
          const { list: ids } = await communeKeys(raw);
          if (!ids.length) return res.status(404).json({ message: 'Incident non trouvé' });
          filter.communeId = { $in: ids };
        }
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      incident = await Incident.findOne(filter).lean();
    }

    if (!incident) {
      return res.status(404).json({ message: 'Incident non trouvé' });
    }
    res.json(incident);
  } catch (error) {
    console.error('❌ Erreur récupération incident par ID :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

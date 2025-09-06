const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Incident = require('../models/Incident');

const multer = require('multer');
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// 🔐 même valeur que MOBILE_APP_KEY dans .env serveur
const APP_KEY = process.env.MOBILE_APP_KEY || null;
const isMobile = (req) => APP_KEY && req.header('x-app-key') === APP_KEY;

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const getDeviceIdFromReq = (req) =>
  String(req.query.deviceId || req.body?.deviceId || '').trim();

/* Utilitaire: récupère le communeId "côté panel" depuis header ou query */
function getPanelCommuneId(req) {
  return String(
    req.header('x-commune-id') || req.query.communeId || ''
  ).trim();
}

/* ===== helper pour autoriser anonyme (mobile) ou connecté (panel) ===== */
function authOptional(req, res, next) {
  if (isMobile(req)) return next(); // mobile → pas d’auth JWT
  return auth(req, res, next);      // panel → JWT requis
}

/* ──────────────── GET /api/incidents ────────────────
   - MOBILE : deviceId obligatoire (communeId optionnel)
   - PANEL  : 
       * superadmin -> communeId facultatif (renvoie tout si absent)
       * admin      -> communeId obligatoire et doit correspondre à son compte
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

      // (optionnel) si l’app envoie aussi communeId
      if (req.query.communeId) filter.communeId = String(req.query.communeId);
    } else {
      // PANEL
      if (!req.user) {
        return res.status(401).json({ message: 'Non connecté' });
      }
      const cid = getPanelCommuneId(req);

      if (req.user.role === 'admin') {
        if (!cid) return res.status(400).json({ message: 'communeId requis' });
        if (String(req.user.communeId || '') !== cid) {
          return res.status(403).json({ message: 'Accès interdit à cette commune' });
        }
        filter.communeId = cid;
      } else if (req.user.role === 'superadmin') {
        // superadmin : si cid présent → filtre ; sinon → tout
        if (cid) filter.communeId = cid;
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      // Période (optionnelle)
      const { period } = req.query;
      if (period === '7' || period === '30') {
        const days = parseInt(period, 10);
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        filter.createdAt = { $gte: fromDate };
      }

      // (optionnel) filtre deviceId depuis le panel
      if (req.query.deviceId) filter.deviceId = String(req.query.deviceId);
    }

    const incidents = await Incident.find(filter).sort({ createdAt: -1 });
    res.json(incidents);
  } catch (err) {
    console.error('Erreur récupération incidents:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/count ──────────────── */
router.get('/count', auth, requireRole('admin'), async (req, res) => {
  try {
    const cid = getPanelCommuneId(req);
    const filter = {};

    if (req.user.role === 'admin') {
      if (!cid) return res.status(400).json({ message: 'communeId requis' });
      if (String(req.user.communeId || '') !== cid) {
        return res.status(403).json({ message: 'Accès interdit à cette commune' });
      }
      filter.communeId = cid;
    } else if (req.user.role === 'superadmin') {
      if (cid) filter.communeId = cid; // sinon total global
    }

    const { period } = req.query;
    if (period === '7' || period === '30') {
      const days = parseInt(period, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      filter.createdAt = { $gte: fromDate };
    }

    const total = await Incident.countDocuments(filter);
    res.json({ total });
  } catch (err) {
    console.error('Erreur récupération count incidents:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── POST /api/incidents ────────────────
   - Mobile (clé app) : multipart/form-data, communeId OBLIGATOIRE
   - Panel (si jamais utilisé) : passe aussi
*/
router.post('/', upload.single('media'), async (req, res) => {
  try {
    const {
      title,
      description,
      lieu,
      status,        // peut être omis par le mobile → défaut "En cours"
      latitude,
      longitude,
      adresse,
      adminComment,
      deviceId,
      communeId,     // 🔑 on veut le stocker si fourni par le mobile
    } = req.body || {};

    // 🔒 si requête mobile → communeId et deviceId obligatoires
    if (isMobile(req)) {
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
      if (!communeId) return res.status(400).json({ message: 'communeId requis (mobile)' });
    }

    if (!title || !description || !lieu || !latitude || !longitude || !deviceId) {
      return res.status(400).json({ message: '❌ Champs requis manquants.' });
    }

    // Cloudinary / multer-storage-cloudinary : path/secure_url/url selon config
    const mediaUrl = req.file ? (req.file.path || req.file.secure_url || req.file.url) : null;
    const mimeType = req.file ? (req.file.mimetype || '') : '';
    const mediaType = mimeType.startsWith('video') ? 'video' : 'image';

    const newIncident = new Incident({
      title,
      description,
      lieu,
      status: status || 'En cours',   // ✅ défaut si absent
      latitude,
      longitude,
      adresse,
      adminComment,
      deviceId,
      mediaUrl,
      mediaType,
      createdAt: new Date()
    });

    // multi-commune si fourni
    if (communeId) newIncident.communeId = String(communeId);

    const saved = await newIncident.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error("Erreur serveur (POST /incidents) :", err);
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

      // Mobile : ACK uniquement
      const updatedIncident = await Incident.findByIdAndUpdate(
        id,
        { $set: { updated: false } },
        { new: true, runValidators: true }
      );
      return res.json(updatedIncident);
    }

    // PANEL
    if (!req.user) return res.status(401).json({ message: 'Non connecté' });
    const cid = getPanelCommuneId(req);

    let panelFilter = { _id: id };
    if (req.user.role === 'admin') {
      if (!cid) return res.status(400).json({ message: 'communeId requis' });
      if (String(req.user.communeId || '') !== cid) {
        return res.status(403).json({ message: 'Accès interdit à cette commune' });
      }
      panelFilter.communeId = cid;
    } else if (req.user.role === 'superadmin') {
      if (cid) panelFilter.communeId = cid;
    } else {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const body = { ...req.body, updated: true };
    const updatedIncident = await Incident.findOneAndUpdate(panelFilter, body, {
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
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    const cid = getPanelCommuneId(req);
    let filter = { _id: id };

    if (req.user.role === 'admin') {
      if (!cid) return res.status(400).json({ message: 'communeId requis' });
      if (String(req.user.communeId || '') !== cid) {
        return res.status(403).json({ message: 'Accès interdit à cette commune' });
      }
      filter.communeId = cid;
    } else if (req.user.role === 'superadmin') {
      if (cid) filter.communeId = cid;
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
      incident = await Incident.findOne({ _id: id, deviceId });
    } else {
      if (!req.user) return res.status(401).json({ message: 'Non connecté' });
      const cid = getPanelCommuneId(req);

      let filter = { _id: id };
      if (req.user.role === 'admin') {
        if (!cid) return res.status(400).json({ message: 'communeId requis' });
        if (String(req.user.communeId || '') !== cid) {
          return res.status(403).json({ message: 'Accès interdit à cette commune' });
        }
        filter.communeId = cid;
      } else if (req.user.role === 'superadmin') {
        if (cid) filter.communeId = cid;
      } else {
        return res.status(403).json({ message: 'Accès interdit' });
      }

      incident = await Incident.findOne(filter);
    }

    if (!incident) {
      return res.status(404).json({ message: 'Incident non trouvé' });
    }
    res.json(incident);
  } catch (error) {
    console.error('Erreur récupération incident par ID :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

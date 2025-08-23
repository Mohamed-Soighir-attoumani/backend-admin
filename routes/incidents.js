// backend/routes/incidents.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Incident = require('../models/Incident');

const multer = require('multer');
const { storage } = require('../utils/cloudinary'); // disque local si cloudinary non configuré
const upload = multer({ storage });

/**
 * Base publique à utiliser pour fabriquer les URLs absolues des médias.
 * - Si PUBLIC_BASE_URL est défini (ex: https://backend-admin-tygd.onrender.com), on l'utilise.
 * - Sinon, on reconstruit avec req.protocol + req.get('host').
 */
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

function toAbsUrl(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel; // déjà absolu (cloudinary par ex.)
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  // s'assurer qu'on ne duplique pas les slashes
  return `${base.replace(/\/+$/, '')}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

/**
 * Sérialise un Incident en forçant mediaUrl à une URL absolue,
 * pour que le panel puisse l'afficher directement.
 */
function serializeIncident(req, doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    ...obj,
    mediaUrl: obj.mediaUrl ? toAbsUrl(req, obj.mediaUrl) : null,
  };
}

/* ──────────────── GET /api/incidents ──────────────── */
router.get("/", async (req, res) => {
  const { period, deviceId } = req.query;
  const filter = {};

  if (period === "7" || period === "30") {
    const days = parseInt(period, 10);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: fromDate };
  }

  if (deviceId) {
    filter.deviceId = deviceId;
  }

  try {
    const incidents = await Incident.find(filter).sort({ createdAt: -1 });
    res.json(incidents.map((d) => serializeIncident(req, d)));
  } catch (err) {
    console.error("Erreur récupération incidents:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/* ──────────────── GET /api/incidents/count ──────────────── */
router.get("/count", async (req, res) => {
  const { period } = req.query;
  const filter = {};

  if (period === "7" || period === "30") {
    const days = parseInt(period, 10);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: fromDate };
  }

  try {
    const total = await Incident.countDocuments(filter);
    res.json({ total });
  } catch (err) {
    console.error("Erreur récupération count incidents:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/* ──────────────── POST /api/incidents ──────────────── */
router.post('/', upload.single('media'), async (req, res) => {
  const {
    title,
    description,
    lieu,
    status,
    latitude,
    longitude,
    adresse,
    adminComment,
    deviceId
  } = req.body;

  if (!title || !description || !lieu || !status || !latitude || !longitude || !deviceId) {
    return res.status(400).json({ message: "❌ Champs requis manquants." });
  }

  // Si Cloudinary n'est pas configuré, req.file.path ressemble à "/uploads/xxx.jpg"
  // On garde la valeur relative en DB mais on renverra une URL absolue au client.
  const mediaUrl = req.file ? (req.file.path || req.file.secure_url || null) : null;
  const mimeType = req.file ? req.file.mimetype : null;
  const mediaType = mimeType?.startsWith('video') ? 'video' : 'image';

  try {
    const created = await Incident.create({
      title,
      description,
      lieu,
      status,
      latitude,
      longitude,
      adresse,
      adminComment,
      deviceId,
      mediaUrl,
      mediaType,
      createdAt: new Date()
    });

    // ⚠️ On renvoie mediaUrl déjà absolu
    res.status(201).json(serializeIncident(req, created));
  } catch (err) {
    console.error("Erreur serveur :", err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement." });
  }
});

/* ──────────────── PUT /api/incidents/:id ──────────────── */
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    req.body.updated = true;
    const updatedIncident = await Incident.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedIncident) {
      return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    }

    // ⚠️ Renvoi avec mediaUrl absolu
    res.json(serializeIncident(req, updatedIncident));
  } catch (error) {
    console.error("❌ Erreur modification :", error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
});

/* ──────────────── DELETE /api/incidents/:id ──────────────── */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    const deleted = await Incident.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    }
    res.json({ message: '✅ Incident supprimé' });
  } catch (error) {
    console.error("❌ Erreur suppression :", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/:id ──────────────── */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ message: 'Incident non trouvé' });
    }
    // ⚠️ Renvoi avec mediaUrl absolu
    res.json(serializeIncident(req, incident));
  } catch (error) {
    console.error("Erreur récupération incident par ID :", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

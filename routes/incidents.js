const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Incident = require('../models/Incident');

const multer = require('multer');
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

/* ──────────────── GET /api/incidents ──────────────── */
router.get("/", async (req, res) => {
  const { period, deviceId } = req.query;
  const filter = {};

  if (period === "7" || period === "30") {
    const days = parseInt(period);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    filter.createdAt = { $gte: fromDate };
  }

  if (deviceId) {
    filter.deviceId = deviceId;
  }

  try {
    const incidents = await Incident.find(filter).sort({ createdAt: -1 });
    res.json(incidents);
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
    const days = parseInt(period);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
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

  const mediaUrl = req.file ? req.file.path : null;
  const mimeType = req.file ? req.file.mimetype : null;
  const mediaType = mimeType?.startsWith('video') ? 'video' : 'image';

  try {
    const newIncident = new Incident({
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

    const saved = await newIncident.save();
    res.status(201).json(saved);
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

    res.json(updatedIncident);
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
    res.json(incident);
  } catch (error) {
    console.error("Erreur récupération incident par ID :", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

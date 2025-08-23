// backend/routes/incidents.js
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { storage } = require('../utils/cloudinary');
const Incident = require('../models/Incident');

const router = express.Router();
const upload = multer({ storage });

/* ──────────────── GET /api/incidents ──────────────── */
router.get('/', async (req, res) => {
  const { period, deviceId } = req.query;
  const filter = {};

  if (period === '7' || period === '30') {
    const days = parseInt(period, 10);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: fromDate };
  }

  if (deviceId) {
    filter.deviceId = String(deviceId);
  }

  try {
    const incidents = await Incident.find(filter).sort({ createdAt: -1 });
    res.json(incidents);
  } catch (err) {
    console.error('GET /incidents error:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/count ──────────────── */
router.get('/count', async (req, res) => {
  const { period } = req.query;
  const filter = {};

  if (period === '7' || period === '30') {
    const days = parseInt(period, 10);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: fromDate };
  }

  try {
    const total = await Incident.countDocuments(filter);
    res.json({ total });
  } catch (err) {
    console.error('GET /incidents/count error:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── POST /api/incidents ──────────────── */
router.post('/', upload.single('media'), async (req, res) => {
  try {
    const {
      title,
      description,
      lieu,
      status,
      latitude,
      longitude,
      adresse,
      adminComment,
      deviceId,
    } = req.body || {};

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!title || !description || !lieu || !status || Number.isNaN(lat) || Number.isNaN(lon) || !deviceId) {
      console.warn('POST /incidents – payload invalide', {
        title: !!title, description: !!description, lieu: !!lieu, status: !!status,
        latitude, longitude, deviceId
      });
      return res.status(400).json({ message: '❌ Champs requis manquants.' });
    }

    const mediaUrl = req.file ? req.file.path : null;
    const mimeType = req.file ? req.file.mimetype : null;
    const mediaType = mimeType?.startsWith('video') ? 'video' : 'image';

    const doc = new Incident({
      title: String(title).trim(),
      description: String(description).trim(),
      lieu: String(lieu).trim(),
      status: String(status).trim(),
      latitude: lat,
      longitude: lon,
      adresse: adresse ? String(adresse) : '',
      adminComment: adminComment ? String(adminComment) : '',
      deviceId: String(deviceId),
      mediaUrl,
      mediaType,
      createdAt: new Date(),
    });

    const saved = await doc.save();
    return res.status(201).json(saved);
  } catch (err) {
    console.error('POST /incidents error:', err);
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
    const updatedIncident = await Incident.findByIdAndUpdate(
      id,
      { ...req.body, updated: true },
      { new: true, runValidators: true }
    );

    if (!updatedIncident) {
      return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    }

    res.json(updatedIncident);
  } catch (error) {
    console.error('PUT /incidents/:id error:', error);
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
    console.error('DELETE /incidents/:id error:', error);
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
    console.error('GET /incidents/:id error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

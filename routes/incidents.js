// backend/routes/incidents.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Incident = require('../models/Incident');

const multer = require('multer');
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

// 🔐 même valeur que MOBILE_APP_KEY dans .env serveur
const APP_KEY = process.env.MOBILE_APP_KEY || null;
const isMobile = (req) => APP_KEY && req.header('x-app-key') === APP_KEY;

// ───────── helpers
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

function getDeviceIdFromReq(req) {
  return String(req.query.deviceId || req.body?.deviceId || '').trim();
}

/* ──────────────── GET /api/incidents ────────────────
   - MOBILE (x-app-key valide) => deviceId OBLIGATOIRE, filtrage STRICT
   - PANEL/ADMIN => période optionnelle (period=7|30)
*/
router.get('/', async (req, res) => {
  try {
    const filter = {};

    if (isMobile(req)) {
      const deviceId = getDeviceIdFromReq(req);
      if (!deviceId) {
        return res.status(400).json({ message: 'deviceId requis (mobile)' });
      }
      filter.deviceId = deviceId;
    } else {
      const { period } = req.query;
      if (period === '7' || period === '30') {
        const days = parseInt(period, 10);
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        filter.createdAt = { $gte: fromDate };
      }
      // (optionnel) autoriser filtrage deviceId depuis le panel
      if (req.query.deviceId) filter.deviceId = String(req.query.deviceId);
    }

    const incidents = await Incident.find(filter).sort({ createdAt: -1 });
    res.json(incidents);
  } catch (err) {
    console.error('Erreur récupération incidents:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/count ────────────────
   Utilisé par le panel
*/
router.get('/count', async (req, res) => {
  const { period } = req.query;
  const filter = {};

  if (period === '7' || period === '30') {
    const days = parseInt(period, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    filter.createdAt = { $gte: fromDate };
  }

  try {
    const total = await Incident.countDocuments(filter);
    res.json({ total });
  } catch (err) {
    console.error('Erreur récupération count incidents:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── POST /api/incidents ────────────────
   Création depuis l’app (et potentiellement d’autres front).
   (On n’impose pas x-app-key ici si tu veux garder d’autres clients,
    mais deviceId reste requis pour lier l’incident à l’appareil.)
*/
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
      deviceId
    } = req.body;

    if (!title || !description || !lieu || !status || !latitude || !longitude || !deviceId) {
      return res.status(400).json({ message: '❌ Champs requis manquants.' });
    }

    const mediaUrl = req.file ? req.file.path : null;
    const mimeType = req.file ? req.file.mimetype : null;
    const mediaType = mimeType?.startsWith('video') ? 'video' : 'image';

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
    console.error("Erreur serveur (POST /incidents) :", err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement." });
  }
});

/* ──────────────── PUT /api/incidents/:id ────────────────
   - MOBILE : peut uniquement faire un ACK (updated:false) sur SON propre incident
   - PANEL/ADMIN : libre; on force updated:true pour signaler un changement à l’app
*/
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    if (isMobile(req)) {
      // 🔒 Mobile : contrôle propriétaire + payload limité
      const deviceId = getDeviceIdFromReq(req);
      if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });

      const incident = await Incident.findOne({ _id: id, deviceId });
      if (!incident) return res.status(404).json({ message: '⚠️ Incident introuvable pour ce device' });

      // Seul ack autorisé
      const updatedIncident = await Incident.findByIdAndUpdate(
        id,
        { $set: { updated: false } },
        { new: true, runValidators: true }
      );
      return res.json(updatedIncident);
    }

    // PANEL/ADMIN : MàJ libre + on marque updated:true pour notifier l’app
    const body = { ...req.body, updated: true };
    const updatedIncident = await Incident.findByIdAndUpdate(id, body, {
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

/* ──────────────── DELETE /api/incidents/:id ────────────────
   - MOBILE : interdit (la suppression sur téléphone est LOCALE uniquement)
   - PANEL/ADMIN : autorisé
*/
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: '❌ ID invalide' });
  }

  try {
    if (isMobile(req)) {
      return res.status(403).json({ message: 'Suppression interdite côté mobile (supprimez localement seulement).' });
    }

    const deleted = await Incident.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: '⚠️ Incident non trouvé' });
    }
    res.json({ message: '✅ Incident supprimé' });
  } catch (error) {
    console.error('❌ Erreur suppression :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* ──────────────── GET /api/incidents/:id ────────────────
   - MOBILE : ne peut lire que son propre incident
   - PANEL/ADMIN : accès total
*/
router.get('/:id', async (req, res) => {
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
      incident = await Incident.findById(id);
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

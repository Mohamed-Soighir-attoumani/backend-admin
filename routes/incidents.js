const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');

const Incident = require('../models/Incident');
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage });

const tenant = require('../middleware/tenant');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const requireCommuneAccess = require('../middleware/requireCommuneAccess');

// 🔐 même valeur que MOBILE_APP_KEY dans .env serveur
const APP_KEY = process.env.MOBILE_APP_KEY || null;
const isMobile = (req) => APP_KEY && req.header('x-app-key') === APP_KEY;

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const getDeviceIdFromReq = (req) => String(req.query.deviceId || req.body?.deviceId || '').trim();

/* ============ LISTE ============ */
router.get('/',
  // Panel/admin : on exige communeId + auth + rôle + accès à la commune
  (req, res, next) => isMobile(req) ? next() : tenant({ require: true })(req, res, next),
  (req, res, next) => isMobile(req) ? next() : auth(req, res, next),
  (req, res, next) => isMobile(req) ? next() : requireRole('admin')(req, res, next),
  (req, res, next) => isMobile(req) ? next() : requireCommuneAccess()(req, res, next),
  async (req, res) => {
    try {
      const filter = {};
      if (isMobile(req)) {
        const deviceId = getDeviceIdFromReq(req);
        if (!deviceId) return res.status(400).json({ message: 'deviceId requis (mobile)' });
        filter.deviceId = deviceId;

        // Optionnel si l’app envoie communeId (utile si tu veux filtrer côté app)
        if (req.query.communeId) filter.communeId = String(req.query.communeId);
      } else {
        filter.communeId = req.communeId;

        const { period } = req.query;
        if (period === '7' || period === '30') {
          const days = parseInt(period, 10);
          const from = new Date();
          from.setDate(from.getDate() - days);
          filter.createdAt = { $gte: from };
        }
        if (req.query.deviceId) filter.deviceId = String(req.query.deviceId);
      }

      const incidents = await Incident.find(filter).sort({ createdAt: -1 });
      res.json(incidents);
    } catch (err) {
      console.error('Erreur récupération incidents:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
);

/* ============ COUNT (panel) ============ */
router.get('/count',
  tenant({ require: true }), auth, requireRole('admin'), requireCommuneAccess(),
  async (req, res) => {
    const { period } = req.query;
    const filter = { communeId: req.communeId };

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
  }
);

/* ============ CREATE (app + autres clients) ============ */
router.post('/', upload.single('media'), async (req, res) => {
  try {
    const {
      title, description, lieu, status,
      latitude, longitude, adresse, adminComment,
      deviceId, communeId
    } = req.body;

    if (!title || !description || !lieu || !status || !latitude || !longitude || !deviceId) {
      return res.status(400).json({ message: '❌ Champs requis manquants.' });
    }

    const mediaUrl = req.file ? req.file.path : null;
    const mimeType = req.file ? req.file.mimetype : null;
    const mediaType = mimeType?.startsWith('video') ? 'video' : 'image';

    const newIncident = await Incident.create({
      title, description, lieu, status,
      latitude, longitude, adresse, adminComment,
      deviceId,
      communeId: communeId ? String(communeId) : undefined, // 🔑 multi-commune si fourni
      mediaUrl, mediaType
    });

    res.status(201).json(newIncident);
  } catch (err) {
    console.error("Erreur serveur (POST /incidents) :", err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement." });
  }
});

/* ============ UPDATE ============ */
router.put('/:id',
  (req, res, next) => isMobile(req) ? next() :
    tenant({ require: true })(req, res, () =>
      auth(req, res, () =>
        requireRole('admin')(req, res, () =>
          requireCommuneAccess()(req, res, next)
        ))),
  async (req, res) => {
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

        // Mobile : ACK seulement
        const updatedIncident = await Incident.findByIdAndUpdate(
          id,
          { $set: { updated: false } },
          { new: true, runValidators: true }
        );
        return res.json(updatedIncident);
      }

      // Panel : impose la commune + déclenche updated:true (pour notifier l’app)
      const body = { ...req.body, updated: true, communeId: req.communeId };
      const updatedIncident = await Incident.findOneAndUpdate(
        { _id: id, communeId: req.communeId },
        { $set: body },
        { new: true, runValidators: true }
      );
      if (!updatedIncident) {
        return res.status(404).json({ message: '⚠️ Incident non trouvé' });
      }
      res.json(updatedIncident);
    } catch (error) {
      console.error('❌ Erreur modification :', error);
      res.status(500).json({ message: 'Erreur lors de la mise à jour' });
    }
  }
);

/* ============ DELETE (panel) ============ */
router.delete('/:id',
  tenant({ require: true }), auth, requireRole('admin'), requireCommuneAccess(),
  async (req, res) => {
    const { id } = req.params;
    if (!isObjectId(id)) {
      return res.status(400).json({ message: '❌ ID invalide' });
    }

    try {
      const deleted = await Incident.findOneAndDelete({ _id: id, communeId: req.communeId });
      if (!deleted) {
        return res.status(404).json({ message: '⚠️ Incident non trouvé' });
      }
      res.json({ message: '✅ Incident supprimé' });
    } catch (error) {
      console.error('❌ Erreur suppression :', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
);

/* ============ GET BY ID ============ */
router.get('/:id',
  (req, res, next) => isMobile(req) ? next() :
    tenant({ require: true })(req, res, () =>
      auth(req, res, () =>
        requireRole('admin')(req, res, () =>
          requireCommuneAccess()(req, res, next)
        ))),
  async (req, res) => {
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
        incident = await Incident.findOne({ _id: id, communeId: req.communeId });
      }

      if (!incident) {
        return res.status(404).json({ message: 'Incident non trouvé' });
      }
      res.json(incident);
    } catch (error) {
      console.error('Erreur récupération incident par ID :', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
);

module.exports = router;

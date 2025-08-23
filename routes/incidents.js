const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Incident = require('../models/Incident');

const multer = require('multer');
const { storage } = require('../utils/cloudinary'); // cloudinary OU disque (fallback)
const upload = multer({ storage });

// --- util pour fabriquer une URL absolue côté API (Render/Proxy) ---
function toAbsUrl(req, u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.get('host');
  const path  = u.startsWith('/') ? u : `/${u}`;
  return `${proto}://${host}${path}`;
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
  if (deviceId) filter.deviceId = deviceId;

  try {
    const incidents = await Incident.find(filter).sort({ createdAt: -1 }).lean();

    const mapped = incidents.map(it => ({
      ...it,
      mediaAbsUrl: toAbsUrl(req, it.mediaUrl || null),
    }));

    res.json(mapped);
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

  let mediaUrl = null;
  let mediaType = null;

  try {
    if (req.file) {
      // Si Cloudinary : req.file.path est déjà une URL http(s)
      // Si stockage disque : on fabrique un chemin public servi par Express (/uploads/...)
      const isHttp = req.file.path && /^https?:\/\//i.test(req.file.path);
      mediaUrl = isHttp ? req.file.path : `/uploads/${req.file.filename}`;

      const mime = req.file.mimetype || '';
      mediaType = mime.startsWith('video') ? 'video' : 'image';
    }

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

    // renvoie aussi l’URL absolue pour usage immédiat si besoin
    const out = saved.toObject();
    out.mediaAbsUrl = toAbsUrl(req, out.mediaUrl || null);

    res.status(201).json(out);
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

    const out = updatedIncident.toObject();
    out.mediaAbsUrl = toAbsUrl(req, out.mediaUrl || null);

    res.json(out);
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
    const incident = await Incident.findById(id).lean();
    if (!incident) {
      return res.status(404).json({ message: 'Incident non trouvé' });
    }
    incident.mediaAbsUrl = toAbsUrl(req, incident.mediaUrl || null);
    res.json(incident);
  } catch (error) {
    console.error("Erreur récupération incident par ID :", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

// --------- Répertoire des avatars ----------
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// --------- Multer ----------
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (!ok) return cb(new Error('Type de fichier invalide (jpg, png, webp uniquement)'));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// --------- Utils ----------
function publicBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('host');
  return `${proto}://${host}`;
}
function localPathFromPublicUrl(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith('/uploads/avatars/')) return null;
    return path.join(__dirname, '..', u.pathname);
  } catch {
    return null;
  }
}
async function deleteIfExists(filePath) {
  if (!filePath) return;
  try { await fs.promises.unlink(filePath); }
  catch (e) { if (e.code !== 'ENOENT') console.warn('⚠️ unlink avatar:', e.message); }
}

// --------- GET /api/me ----------
router.get('/me', auth, async (req, res) => {
  try {
    const { id, email } = req.user || {};
    let doc = null;

    if (id && isValidObjectId(id)) {
      doc = await User.findById(id).select('email role name communeId communeName photo');
      if (!doc && Admin) doc = await Admin.findById(id).select('email role name communeId communeName photo');
    }
    if (!doc && email) {
      doc = await User.findOne({ email }).select('email role name communeId communeName photo');
      if (!doc && Admin) doc = await Admin.findOne({ email }).select('email role name communeId communeName photo');
    }

    if (!doc) return res.status(404).json({ message: 'Utilisateur non trouvé' });
    return res.json({ user: doc });
  } catch (e) {
    console.error('GET /api/me error', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// --------- PATCH /api/me ----------
router.patch('/me', auth, async (req, res) => {
  try {
    const updatable = ['name', 'communeName', 'photo'];
    const updates = {};
    for (const k of updatable) if (k in req.body) updates[k] = req.body[k];

    const { id, email } = req.user || {};
    let doc = null;

    if (id && isValidObjectId(id)) {
      doc = await User.findByIdAndUpdate(id, updates, { new: true, select: 'email role name communeId communeName photo' });
      if (!doc && Admin) doc = await Admin.findByIdAndUpdate(id, updates, { new: true, select: 'email role name communeId communeName photo' });
    }
    if (!doc && email) {
      doc = await User.findOneAndUpdate({ email }, updates, { new: true, select: 'email role name communeId communeName photo' });
      if (!doc && Admin) doc = await Admin.findOneAndUpdate({ email }, updates, { new: true, select: 'email role name communeId communeName photo' });
    }

    if (!doc) return res.status(404).json({ message: 'Utilisateur non trouvé' });
    return res.json({ user: doc });
  } catch (e) {
    console.error('PATCH /api/me:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// --------- POST /api/me/photo ----------
router.post('/me/photo', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier envoyé' });

    const filename = `${(req.user?.id || 'user')}-${Date.now()}.webp`;
    const outPath = path.join(AVATAR_DIR, filename);

    await sharp(req.file.buffer)
      .rotate()
      .resize(512, 512, { fit: 'cover' })
      .toFormat('webp', { quality: 85 })
      .toFile(outPath);

    const url = `${publicBaseUrl(req)}/uploads/avatars/${filename}`;

    // Récupérer le doc actuel pour supprimer l’ancienne photo si locale
    const { id, email } = req.user || {};
    let doc = null;

    if (id && isValidObjectId(id)) {
      doc = await User.findById(id).select('email role name communeId communeName photo');
      if (!doc && Admin) doc = await Admin.findById(id).select('email role name communeId communeName photo');
    }
    if (!doc && email) {
      doc = await User.findOne({ email }).select('email role name communeId communeName photo');
      if (!doc && Admin) doc = await Admin.findOne({ email }).select('email role name communeId communeName photo');
    }
    if (!doc) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    if (doc.photo) {
      const localOld = localPathFromPublicUrl(doc.photo);
      await deleteIfExists(localOld);
    }

    // Mettre à jour la photo dans le bon modèle
    if (doc.constructor.modelName === 'User') {
      doc = await User.findByIdAndUpdate(doc._id, { photo: url }, { new: true, select: 'email role name communeId communeName photo' });
    } else {
      doc = await Admin.findByIdAndUpdate(doc._id, { photo: url }, { new: true, select: 'email role name communeId communeName photo' });
    }

    return res.json({ message: 'Photo mise à jour', url, user: doc });
  } catch (e) {
    console.error('POST /api/me/photo:', e);
    const msg = e.message?.includes('File too large')
      ? 'Fichier trop lourd (max 5 Mo)'
      : (e.message || 'Erreur interne du serveur');
    return res.status(500).json({ message: msg });
  }
});

module.exports = router;

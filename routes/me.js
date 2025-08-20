// backend/routes/me.js
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

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

// Mise à jour de soi (champs autorisés)
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

module.exports = router;

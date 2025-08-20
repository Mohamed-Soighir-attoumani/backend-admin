// backend/routes/admins.js
const express = require('express');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const ensureSelfOrRole = require('../middleware/ensureSelfOrRole');
const scopeByCommune = require('../middleware/scopeByCommune');
const User = require('../models/User');
let Admin = null; try { Admin = require('../models/Admin'); } catch (_) {}

const router = express.Router();

/**
 * GET /api/admins
 * - superadmin : liste tous (option: ?communeId=xxx)
 * - admin : (par défaut on ne l’expose pas) -> on peut renvoyer seulement sa commune si besoin
 */
router.get('/admins', auth, async (req, res) => {
  try {
    const isSuper = req.user?.role === 'superadmin';
    const filter = {};

    if (isSuper) {
      if (req.query.communeId) filter.communeId = req.query.communeId;
    } else {
      // Admin simple : ne renvoie que sa propre fiche (ou vide)
      const self = await User.findById(req.user.id).select('email role name communeId communeName photo');
      return res.json({ admins: self ? [self] : [] });
    }

    const users = await User.find(filter).select('email role name communeId communeName photo');
    let admins = [];
    if (Admin) {
      admins = await Admin.find(filter).select('email role name communeId communeName photo');
    }
    return res.json({ users, admins });
  } catch (e) {
    console.error('GET /api/admins:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// GET /api/admins/self — sa propre fiche
router.get('/admins/self', auth, async (req, res) => {
  try {
    let doc = await User.findById(req.user.id).select('email role name communeId communeName photo');
    if (!doc && Admin) doc = await Admin.findById(req.user.id).select('email role name communeId communeName photo');
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('GET /api/admins/self:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// PATCH /api/admins/self — met à jour sa fiche (champs autorisés)
router.patch('/admins/self', auth, async (req, res) => {
  try {
    const updatable = ['name', 'communeName', 'photo'];
    const updates = {};
    for (const k of updatable) if (k in req.body) updates[k] = req.body[k];

    let doc = await User.findByIdAndUpdate(req.user.id, updates, { new: true, select: 'email role name communeId communeName photo' });
    if (!doc && Admin) {
      doc = await Admin.findByIdAndUpdate(req.user.id, updates, { new: true, select: 'email role name communeId communeName photo' });
    }
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('PATCH /api/admins/self:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// GET /api/admins/:id — soi-même ou superadmin
router.get('/admins/:id', auth, ensureSelfOrRole('superadmin'), async (req, res) => {
  try {
    let doc = await User.findById(req.params.id).select('email role name communeId communeName photo');
    if (!doc && Admin) doc = await Admin.findById(req.params.id).select('email role name communeId communeName photo');
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('GET /api/admins/:id:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// PATCH /api/admins/:id — soi-même ou superadmin
router.patch('/admins/:id', auth, ensureSelfOrRole('superadmin'), async (req, res) => {
  try {
    const updatable = ['name', 'communeName', 'photo', 'role']; // role modifiable seulement par superadmin (grâce au middleware)
    const updates = {};
    for (const k of updatable) if (k in req.body) updates[k] = req.body[k];

    let doc = await User.findByIdAndUpdate(req.params.id, updates, { new: true, select: 'email role name communeId communeName photo' });
    if (!doc && Admin) {
      doc = await Admin.findByIdAndUpdate(req.params.id, updates, { new: true, select: 'email role name communeId communeName photo' });
    }
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('PATCH /api/admins/:id:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

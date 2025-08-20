// backend/routes/admins.js
const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// MODELE UNIQUE (recommandé)
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
// Helpers d'autorisation locales (évite d’ajouter des fichiers)
// ─────────────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    const r = req.user?.role;
    if (!r || !roles.includes(r)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }
    next();
  };
}

function ensureSelfOrRole(...roles) {
  return (req, res, next) => {
    const isSelf = req.user?.id && req.params?.id && String(req.user.id) === String(req.params.id);
    if (isSelf) return next();
    const r = req.user?.role;
    if (!r || !roles.includes(r)) {
      return res.status(403).json({ message: 'Accès interdit' });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────
// GET /api/admins
// - superadmin : liste complète (filtre ?communeId=...)
// - admin : renvoie uniquement SA FICHE (pas la liste globale)
// ─────────────────────────────────────────────────────────────
router.get('/admins', auth, async (req, res) => {
  try {
    const isSuper = req.user?.role === 'superadmin';

    if (!isSuper) {
      const self = await User.findById(req.user.id)
        .select('email role name communeId communeName photo');
      return res.json({ admins: self ? [self] : [] });
    }

    const filter = {};
    if (req.query.communeId) filter.communeId = req.query.communeId;

    const admins = await User.find(filter)
      .select('email role name communeId communeName photo createdAt updatedAt')
      .sort({ createdAt: -1 });

    return res.json({ admins });
  } catch (e) {
    console.error('GET /api/admins:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/admins  (superadmin)
// Body: { email, password, name?, communeId?, communeName?, role? }  (role par défaut: "admin")
// ─────────────────────────────────────────────────────────────
router.post('/admins', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const {
      email,
      password,
      name = '',
      communeId = '',
      communeName = '',
      role = 'admin',
      photo = ''
    } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'email et password requis' });
    }

    // Empêcher doublon email
    const exists = await User.findOne({ email }).select('_id');
    if (exists) {
      return res.status(409).json({ message: 'Cet email existe déjà' });
    }

    // Hash du mot de passe
    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hash,
      role: role === 'superadmin' ? 'superadmin' : 'admin', // sécurité : pas d’élévation involontaire
      name,
      communeId,
      communeName,
      photo
    });

    return res.status(201).json({
      admin: {
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
        communeId: user.communeId,
        communeName: user.communeName,
        photo: user.photo
      }
    });
  } catch (e) {
    console.error('POST /api/admins:', e);
    if (e?.code === 11000) {
      return res.status(409).json({ message: 'Conflit: email déjà utilisé' });
    }
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admins/self — sa propre fiche
// ─────────────────────────────────────────────────────────────
router.get('/admins/self', auth, async (req, res) => {
  try {
    const doc = await User.findById(req.user.id)
      .select('email role name communeId communeName photo');
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('GET /api/admins/self:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/admins/self — met à jour sa fiche (champs autorisés)
// ─────────────────────────────────────────────────────────────
router.patch('/admins/self', auth, async (req, res) => {
  try {
    const updatable = ['name', 'communeName', 'photo'];
    const updates = {};
    for (const k of updatable) if (k in req.body) updates[k] = req.body[k];

    const doc = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, select: 'email role name communeId communeName photo' }
    );
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('PATCH /api/admins/self:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admins/:id — soi-même ou superadmin
// ─────────────────────────────────────────────────────────────
router.get('/admins/:id', auth, ensureSelfOrRole('superadmin'), async (req, res) => {
  try {
    const doc = await User.findById(req.params.id)
      .select('email role name communeId communeName photo');
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('GET /api/admins/:id:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/admins/:id — soi-même ou superadmin
// - Seul superadmin peut changer `role` / `communeId`
// ─────────────────────────────────────────────────────────────
router.patch('/admins/:id', auth, ensureSelfOrRole('superadmin'), async (req, res) => {
  try {
    const updatable = ['name', 'communeName', 'photo'];
    if (req.user.role === 'superadmin') {
      updatable.push('role', 'communeId', 'communeName'); // superadmin: ok
    }

    const updates = {};
    for (const k of updatable) if (k in req.body) updates[k] = req.body[k];

    // Sécurité : si non superadmin, ne pas laisser modifier le role
    if (req.user.role !== 'superadmin') delete updates.role;

    const doc = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, select: 'email role name communeId communeName photo' }
    );
    if (!doc) return res.status(404).json({ message: 'Introuvable' });
    return res.json({ admin: doc });
  } catch (e) {
    console.error('PATCH /api/admins/:id:', e);
    return res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;

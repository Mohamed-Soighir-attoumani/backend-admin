// backend/routes/admins.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');

const router = express.Router();

/* --- Ping debug: GET /api/admins/ping --- */
router.get('/admins/ping', (_req, res) => {
  res.json({ ok: true, route: '/api/admins/*', hint: 'Route admins montée ✅' });
});

function assertSuperadmin(req, res) {
  if (!req.user || req.user.role !== 'superadmin') {
    res.status(403).json({ message: 'Réservé au superadmin' });
    return false;
  }
  return true;
}

/* --- GET /api/admins  (liste, optionnel ?communeId=) --- */
router.get('/admins', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  try {
    const q = {};
    if (req.query.communeId) q.communeId = req.query.communeId;
    const list = await User.find(q)
      .select('email name role communeId communeName photo isActive createdAt updatedAt');
    res.json({ admins: list });
  } catch (e) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* --- POST /api/admins  (créer un admin) --- */
router.post('/admins', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  try {
    const { email, password, name, communeId, communeName, photo, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }
    const hash = await bcrypt.hash(password, 10);
    const doc = await User.create({
      email,
      password: hash,
      name: name || '',
      communeId: communeId || '',
      communeName: communeName || '',
      photo: photo || '',
      role: role === 'superadmin' ? 'superadmin' : 'admin',
      isActive: true,
    });
    res.status(201).json({
      admin: {
        id: doc._id,
        email: doc.email,
        role: doc.role,
        communeId: doc.communeId,
        communeName: doc.communeName,
        photo: doc.photo,
        isActive: doc.isActive
      }
    });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: 'Email déjà utilisé' });
    }
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* --- PATCH /api/admins/:id/disable  (activer/désactiver) --- */
router.patch('/admins/:id/disable', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  try {
    const isActive = !!req.body.isActive;
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).select('email name role communeId communeName photo isActive');
    if (!u) return res.status(404).json({ message: 'Admin introuvable' });
    res.json({ admin: u });
  } catch (e) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* --- POST /api/admins/:id/force-logout  (invalider tous ses tokens) --- */
router.post('/admins/:id/force-logout', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'Admin introuvable' });
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    await u.save();
    res.json({ ok: true, tokenVersion: u.tokenVersion });
  } catch (e) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* --- POST /api/admins/:id/impersonate  (se connecter comme) --- */
router.post('/admins/:id/impersonate', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin introuvable' });
    if (!target.isActive) return res.status(403).json({ message: 'Compte désactivé' });

    const payload = {
      id: target._id.toString(),
      email: target.email,
      role: target.role,
      communeId: target.communeId,
      communeName: target.communeName,
      tokenVersion: target.tokenVersion || 0,
      impersonated: true,
      origUserId: req.user.id,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.json({ token, target: { id: target._id, email: target.email } });
  } catch (e) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');

const router = express.Router();

function assertSuperadmin(req, res) {
  if (!req.user || req.user.role !== 'superadmin') {
    res.status(403).json({ message: 'Réservé au superadmin' });
    return false;
  }
  return true;
}

// PATCH /api/admins/:id/disable
router.patch('/admins/:id/disable', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  const { isActive } = req.body || {};
  try {
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: !!isActive },
      { new: true }
    ).select('email role isActive communeId communeName name photo');
    if (!u) return res.status(404).json({ message: 'Admin introuvable' });
    return res.json({ admin: u });
  } catch (e) {
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST /api/admins/:id/force-logout
router.post('/admins/:id/force-logout', auth, async (req, res) => {
  if (!assertSuperadmin(req, res)) return;
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'Admin introuvable' });
    u.tokenVersion += 1;
    await u.save();
    return res.json({ ok: true, tokenVersion: u.tokenVersion });
  } catch (e) {
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST /api/admins/:id/impersonate
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
      tokenVersion: target.tokenVersion,
      impersonated: true,
      origUserId: req.user.id,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token, target: { id: target._id, email: target.email } });
  } catch (e) {
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

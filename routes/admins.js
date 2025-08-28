// backend/routes/admins.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const Admin = require('../models/Admin');
const User  = require('../models/User');

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

router.use((req, _res, next) => {
  console.log(`[admins.js] ${req.method} ${req.originalUrl}`);
  next();
});

// GET /api/admins
router.get('/', auth, requireRole('superadmin'), async (req, res) => {
  const { q = '', communeId = '' } = req.query || {};

  const baseCond = {};
  if (q) baseCond.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  if (communeId) baseCond.communeId = String(communeId).trim().toLowerCase();

  const adminsA = await Admin.find(baseCond)
    .select('name email role communeId communeName photo isActive createdAt updatedAt')
    .lean();

  const condUser = { ...baseCond, role: { $in: ['admin', 'superadmin'] } };
  const adminsB = await User.find(condUser)
    .select('name email role communeId communeName photo isActive createdAt updatedAt')
    .lean();

  const byEmail = new Map();
  for (const a of adminsB) byEmail.set(a.email, { ...a, _source: 'User' });
  for (const a of adminsA) byEmail.set(a.email, { ...a, _source: 'Admin' });

  res.json({ admins: Array.from(byEmail.values()) });
});

// POST /api/admins
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  try {
    let {
      name = '',
      email = '',
      password = '',
      role = 'admin',
      communeId = '',
      communeName = '',
      photo = '',
    } = req.body || {};

    email = String(email).trim();
    const emailLower = email.toLowerCase();
    communeId = String(communeId || '').trim().toLowerCase();

    if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });
    if (!['admin','superadmin'].includes(role)) role = 'admin';

    // Doublon normalisé (emailLower, communeId)
    const existsAdmin = await Admin.findOne({ emailLower, communeId }).lean();
    if (existsAdmin) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé pour cette commune.' });
    }

    const hash = await bcrypt.hash(password, 10);

    const doc = await Admin.create({
      name,
      email,       // affichage
      emailLower,  // normalisé pour unicité
      password: hash,
      role,
      communeId,
      communeName,
      photo,
      isActive: true,
      tokenVersion: 0,
    });

    res.status(201).json({ id: String(doc._id), message: 'Admin créé.' });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé pour cette commune.' });
    }
    console.error('POST /api/admins error:', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PUT /api/admins/:id
router.put('/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Impossible de modifier votre propre rôle ici.' });

  const target = await Admin.findById(id).select('email emailLower role communeId');
  if (!target) return res.status(404).json({ message: 'Admin introuvable.' });
  if (target.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  const payload = {};
  if (typeof req.body.name === 'string') payload.name = req.body.name;

  if (typeof req.body.email === 'string') {
    const email = req.body.email.trim();
    payload.email = email;
    payload.emailLower = email.toLowerCase();
  }
  if (typeof req.body.role === 'string' && ['admin','superadmin'].includes(req.body.role)) payload.role = req.body.role;
  if (typeof req.body.communeId === 'string') payload.communeId = req.body.communeId.trim().toLowerCase();
  if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;
  if (typeof req.body.photo === 'string') payload.photo = req.body.photo;

  const nextEmailLower = payload.emailLower ?? target.emailLower;
  const nextCommuneId  = payload.communeId  ?? target.communeId;

  // Doublon si on change email/commune
  if (nextEmailLower !== target.emailLower || nextCommuneId !== target.communeId) {
    const dupe = await Admin.findOne({
      _id: { $ne: id },
      emailLower: nextEmailLower,
      communeId: nextCommuneId,
    }).lean();
    if (dupe) return res.status(409).json({ message: 'Déjà utilisé pour cette commune.' });
  }

  await Admin.updateOne({ _id: id }, { $set: payload });
  res.json({ message: 'Admin mis à jour.' });
});

// POST /api/admins/:id/reset-password
router.post('/:id/reset-password', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });
  if (typeof newPassword !== 'string' || newPassword.trim().length < 8) {
    return res.status(400).json({ message: 'Nouveau mot de passe invalide (min 8 caractères).' });
  }

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Utilisez /api/change-password pour votre propre compte.' });

  const doc = await Admin.findById(id).select('+password role tokenVersion');
  if (!doc) return res.status(404).json({ message: 'Admin introuvable.' });
  if (doc.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  doc.password = await bcrypt.hash(newPassword, 10);
  doc.tokenVersion = (doc.tokenVersion || 0) + 1;
  await doc.save();

  res.json({ message: 'Mot de passe réinitialisé.' });
});

// POST /api/admins/:id/toggle-active
router.post('/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { active } = req.body || {};
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Impossible de désactiver votre propre compte.' });

  const doc = await Admin.findById(id).select('role isActive tokenVersion');
  if (!doc) return res.status(404).json({ message: 'Admin introuvable.' });
  if (doc.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  doc.isActive = !!active;
  doc.tokenVersion = (doc.tokenVersion || 0) + 1;
  await doc.save();

  res.json({ message: doc.isActive ? 'Compte réactivé.' : 'Compte désactivé.' });
});

// POST /api/admins/:id/impersonate
router.post('/:id/impersonate', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const target = await Admin.findById(id).select('email role name communeId communeName isActive tokenVersion');
  if (!target) return res.status(404).json({ message: 'Admin introuvable.' });
  if (target.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });
  if (target.isActive === false) return res.status(403).json({ message: 'Compte désactivé.' });

  const payload = {
    id: String(target._id),
    email: target.email,
    role: target.role,
    communeId: target.communeId || '',
    communeName: target.communeName || '',
    tv: target.tokenVersion || 0,
    impersonated: true,
    origUserId: String(req.user.id),
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, target: { id: String(target._id), email: target.email } });
});

// DELETE /api/admins/:id
router.delete('/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Impossible de supprimer votre propre compte.' });

  const doc = await Admin.findById(id).select('role');
  if (!doc) return res.status(404).json({ message: 'Admin introuvable.' });
  if (doc.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  await Admin.deleteOne({ _id: id });
  res.json({ message: 'Admin supprimé.' });
});

module.exports = router;

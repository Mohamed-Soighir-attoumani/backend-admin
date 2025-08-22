// backend/routes/admins.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const Admin = require('../models/Admin'); // nouveaux comptes
const User  = require('../models/User');  // anciens "admins" stockés côté User

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// (debug) log
router.use((req, _res, next) => {
  console.log(`[admins.js] ${req.method} baseUrl=${req.baseUrl} path=${req.path}`);
  next();
});

/**
 * GET /api/admins
 * Renvoie la liste fusionnée des administrateurs (Admin + User[role in admin/superadmin])
 * Query: ?q= (recherche name/email), ?communeId=
 * Réponse: { admins: [...] }
 */
router.get('/', auth, requireRole('superadmin'), async (req, res) => {
  const { q = '', communeId = '' } = req.query || {};

  const baseCond = {};
  if (q) baseCond.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  if (communeId) baseCond.communeId = communeId;

  // 1) Admins (nouveau modèle)
  const adminsA = await Admin.find(baseCond)
    .select('name email role communeId communeName photo isActive createdAt updatedAt')
    .lean();

  // 2) Admins historiques dans User
  const condUser = { ...baseCond, role: { $in: ['admin', 'superadmin'] } };
  const adminsB = await User.find(condUser)
    .select('name email role communeId communeName photo isActive createdAt updatedAt')
    .lean();

  // Fusion + dédup par email (Admin prioritaire)
  const byEmail = new Map();
  for (const a of adminsB) byEmail.set(a.email, { ...a, _source: 'User' });
  for (const a of adminsA) byEmail.set(a.email, { ...a, _source: 'Admin' });

  const admins = Array.from(byEmail.values());

  return res.json({ admins });
});

/**
 * POST /api/admins
 * Crée un admin (dans la collection Admin)
 * body: { name, email, password, role?, communeId?, communeName?, photo? }
 */
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

    email = String(email).trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });
    if (!['admin', 'superadmin'].includes(role)) role = 'admin';

    // Empêche doublon par email (dans Admin)
    const existsAdmin = await Admin.findOne({ email }).lean();
    if (existsAdmin) return res.status(409).json({ message: 'Un compte existe déjà avec cet email.' });

    // Info: il peut exister un "ancien" compte dans User avec le même email.
    // On autorise la création côté Admin (de toute façon la liste fusionne).

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const doc = await Admin.create({
      name,
      email,
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
    if (e.code === 11000) return res.status(409).json({ message: 'Email déjà utilisé.' });
    console.error('POST /api/admins error:', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * PUT /api/admins/:id
 * Met à jour un admin (dans Admin) — pas le mot de passe ici
 */
router.put('/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Impossible de modifier votre propre rôle ici.' });

  const target = await Admin.findById(id).select('email role');
  if (!target) return res.status(404).json({ message: 'Admin introuvable.' });
  if (target.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  const payload = {};
  if (typeof req.body.name === 'string') payload.name = req.body.name;
  if (typeof req.body.email === 'string') payload.email = req.body.email.trim().toLowerCase();
  if (typeof req.body.role === 'string' && ['admin','superadmin'].includes(req.body.role)) payload.role = req.body.role;
  if (typeof req.body.communeId === 'string') payload.communeId = req.body.communeId;
  if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;
  if (typeof req.body.photo === 'string') payload.photo = req.body.photo;

  if (payload.email && payload.email !== target.email) {
    const dupe = await Admin.findOne({ email: payload.email, _id: { $ne: id } }).lean();
    if (dupe) return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
  }

  await Admin.updateOne({ _id: id }, { $set: payload });
  res.json({ message: 'Admin mis à jour.' });
});

/**
 * POST /api/admins/:id/reset-password
 * Réinitialise le mot de passe (dans Admin) — si l’admin ciblé est encore un "ancien" User, cette route ne le touchera pas.
 */
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

  const salt = await bcrypt.genSalt(10);
  doc.password = await bcrypt.hash(newPassword, salt);
  if (typeof doc.tokenVersion === 'number') doc.tokenVersion += 1;
  await doc.save();

  res.json({ message: 'Mot de passe réinitialisé.' });
});

/**
 * POST /api/admins/:id/toggle-active
 * Active/désactive un admin (Admin seulement)
 * body: { active: boolean }
 */
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
  if (typeof doc.tokenVersion === 'number') doc.tokenVersion += 1;
  await doc.save();

  res.json({ message: doc.isActive ? 'Compte réactivé.' : 'Compte désactivé.' });
});

/**
 * POST /api/admins/:id/force-logout
 * Invalide tous les tokens (Admin seulement)
 */
router.post('/:id/force-logout', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const doc = await Admin.findById(id).select('tokenVersion');
  if (!doc) return res.status(404).json({ message: 'Admin introuvable.' });

  if (typeof doc.tokenVersion !== 'number') return res.status(400).json({ message: 'tokenVersion non supporté.' });

  doc.tokenVersion += 1;
  await doc.save();

  res.json({ ok: true, tokenVersion: doc.tokenVersion });
});

/**
 * POST /api/admins/:id/impersonate
 * Se connecter comme l’admin ciblé (Admin seulement)
 */
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
    tv: typeof target.tokenVersion === 'number' ? target.tokenVersion : 0,
    impersonated: true,
    origUserId: String(req.user.id),
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, target: { id: String(target._id), email: target.email } });
});

/**
 * DELETE /api/admins/:id
 * Supprime un admin (Admin seulement)
 */
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

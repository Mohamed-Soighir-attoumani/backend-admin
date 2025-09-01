// backend/routes/admins.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

const Admin = require('../models/Admin'); // nouveaux comptes admins
const User  = require('../models/User');  // anciens comptes "admin/superadmin" éventuels

const router = express.Router();

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Petite utilitaire pour échapper une valeur en RegExp
const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// (debug) log
router.use((req, _res, next) => {
  console.log(`[admins.js] ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * GET /api/admins
 * Liste fusionnée des administrateurs (Admin + User[role in admin/superadmin])
 * Query:
 *   - q (recherche partielle sur nom/email)
 *   - communeId (filtre strict, insensible à la casse)
 * Réponse: { admins: [...] }
 */
router.get('/', auth, requireRole('superadmin'), async (req, res) => {
  const { q = '', communeId = '' } = req.query || {};

  const andA = [];
  if (q) {
    andA.push({
      $or: [
        { name:  { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
    });
  }
  if (communeId) {
    andA.push({ communeId: { $regex: `^${escapeRegex(communeId)}$`, $options: 'i' } });
  }
  const condA = andA.length ? { $and: andA } : {};

  // 1) Admins (nouvel ensemble)
  const adminsA = await Admin.find(condA)
    .select('name email role communeId communeName photo isActive createdAt updatedAt')
    .lean();

  // 2) Admins historiques stockés dans User
  const andB = [];
  if (q) {
    andB.push({
      $or: [
        { name:  { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
    });
  }
  if (communeId) {
    andB.push({ communeId: { $regex: `^${escapeRegex(communeId)}$`, $options: 'i' } });
  }
  andB.push({ role: { $in: ['admin', 'superadmin'] } });
  const condB = andB.length ? { $and: andB } : {};

  const adminsB = await User.find(condB)
    .select('name email role communeId communeName photo isActive createdAt updatedAt')
    .lean();

  // Fusion + dédup par email (Admin prioritaire)
  const byEmail = new Map();
  for (const a of adminsB) byEmail.set(String(a.email).toLowerCase(), { ...a, _source: 'User' });
  for (const a of adminsA) byEmail.set(String(a.email).toLowerCase(), { ...a, _source: 'Admin' });

  return res.json({ admins: Array.from(byEmail.values()) });
});

/**
 * POST /api/admins
 * Crée un admin dans la collection Admin
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

    const emailRaw = String(email || '').trim();
    const emailLower = emailRaw.toLowerCase();
    const communeIdRaw = String(communeId || '').trim();
    const communeIdLower = communeIdRaw.toLowerCase();

    if (!emailRaw || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis.' });
    }
    if (!['admin', 'superadmin'].includes(role)) role = 'admin';

    // 🔎 Doublon UNIQUEMENT dans Admin, par (email, communeId) insensible à la casse
    const existsAdmin = await Admin.findOne({
      email:     { $regex: `^${escapeRegex(emailRaw)}$`,     $options: 'i' },
      communeId: { $regex: `^${escapeRegex(communeIdRaw)}$`, $options: 'i' },
    }).lean();

    if (existsAdmin) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé pour cette commune.' });
    }

    // (⚠️ Non-bloquant : on NE bloque PAS si un ancien User a le même email.
    //  Débloque votre cas de faux-positifs.)
    // const existsUser = await User.findOne({
    //   email:     { $regex: `^${escapeRegex(emailRaw)}$`, $options: 'i' },
    //   communeId: { $regex: `^${escapeRegex(communeIdRaw)}$`, $options: 'i' },
    // }).lean();
    // if (existsUser) {
    //   return res.status(409).json({ message: 'Cet email est déjà utilisé pour cette commune (ancien compte).' });
    // }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // on normalise l'email pour éviter les variantes de casse
    const doc = await Admin.create({
      name,
      email: emailLower,            // on stocke en minuscule
      password: hash,
      role,
      communeId: communeIdRaw,      // garde la casse d'affichage
      communeName,
      photo,
      isActive: true,
      tokenVersion: 0,
    });

    res.status(201).json({ id: String(doc._id), message: 'Admin créé.' });
  } catch (e) {
    if (e && e.code === 11000) {
      // Conflit index unique (au cas où vous en avez un)
      return res.status(409).json({ message: 'Cet email est déjà utilisé pour cette commune.' });
    }
    console.error('POST /api/admins error:', e);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * PUT /api/admins/:id
 * Met à jour un admin (pas le mot de passe ici)
 */
router.put('/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) {
    return res.status(400).json({ message: 'Impossible de modifier votre propre rôle ici.' });
  }

  const target = await Admin.findById(id).select('email role communeId');
  if (!target) return res.status(404).json({ message: 'Admin introuvable.' });
  if (String(target.role) === 'superadmin') {
    return res.status(403).json({ message: 'Action interdite sur un superadmin.' });
  }

  // Prépare payload
  const payload = {};
  const nextEmailRaw = typeof req.body.email === 'string' ? String(req.body.email).trim() : target.email;
  const nextCommuneRaw = typeof req.body.communeId === 'string' ? String(req.body.communeId).trim() : (target.communeId || '');

  if (typeof req.body.name === 'string') payload.name = req.body.name;
  if (typeof req.body.email === 'string') payload.email = nextEmailRaw.toLowerCase(); // normalise
  if (typeof req.body.role === 'string' && ['admin', 'superadmin'].includes(req.body.role)) payload.role = req.body.role;
  if (typeof req.body.communeId === 'string') payload.communeId = nextCommuneRaw;
  if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;
  if (typeof req.body.photo === 'string') payload.photo = req.body.photo;

  // Vérif doublon (email, communeId) sur un AUTRE document
  const dupe = await Admin.findOne({
    _id: { $ne: id },
    email:     { $regex: `^${escapeRegex(nextEmailRaw)}$`,     $options: 'i' },
    communeId: { $regex: `^${escapeRegex(nextCommuneRaw)}$`,   $options: 'i' },
  }).lean();

  if (dupe) {
    return res.status(409).json({ message: 'Cet email est déjà utilisé pour cette commune.' });
  }

  await Admin.updateOne({ _id: id }, { $set: payload });
  res.json({ message: 'Admin mis à jour.' });
});

/**
 * POST /api/admins/:id/reset-password
 * Réinitialise le mot de passe (collection Admin)
 */
router.post('/:id/reset-password', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  if (typeof newPassword !== 'string' || newPassword.trim().length < 8) {
    return res.status(400).json({ message: 'Nouveau mot de passe invalide (min 8 caractères).' });
  }

  const meId = String(req.user.id);
  if (meId === id) {
    return res.status(400).json({ message: 'Utilisez /api/change-password pour votre propre compte.' });
  }

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
 * Active/désactive un admin
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
 * Invalide tous les tokens (augmente tokenVersion)
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
 * Génère un token pour se connecter en tant que l’admin ciblé
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
 * Supprime un admin
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

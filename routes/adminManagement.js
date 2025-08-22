// backend/routes/adminManagement.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const Admin = require('../models/Admin');

const router = express.Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

// LISTER les admins (filtrable)
router.get('/', auth, requireRole('superadmin'), async (req, res) => {
  const { q = '', communeId = '' } = req.query || {};
  const cond = {};
  if (q) cond.$or = [
    { name: new RegExp(q, 'i') },
    { email: new RegExp(q, 'i') },
  ];
  if (communeId) cond.communeId = communeId;

  const admins = await Admin.find(cond)
    .select('name email role communeId communeName photo createdAt updatedAt');
  res.json({ items: admins });
});

// CRÉER un admin
router.post('/', auth, requireRole('superadmin'), async (req, res) => {
  let { name = '', email = '', password = '', role = 'admin', communeId = '', communeName = '', photo = '' } = req.body || {};
  email = String(email).trim().toLowerCase();
  if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });
  if (!['admin','superadmin'].includes(role)) role = 'admin';

  const exists = await Admin.findOne({ email }).lean();
  if (exists) return res.status(409).json({ message: 'Un compte existe déjà avec cet email.' });

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);

  const doc = await Admin.create({ name, email, password: hash, role, communeId, communeName, photo });
  res.status(201).json({ id: String(doc._id), message: 'Admin créé.' });
});

// METTRE À JOUR (nom, email, rôle, commune, photo) — pas le mot de passe ici
router.put('/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Impossible de modifier votre propre rôle ici.' });

  const target = await Admin.findById(id).select('email role');
  if (!target) return res.status(404).json({ message: 'Admin introuvable.' });

  // Interdit de rétrograder/supprimer un autre superadmin
  if (target.role === 'superadmin') {
    return res.status(403).json({ message: 'Action interdite sur un superadmin.' });
  }

  const payload = {};
  if (typeof req.body.name === 'string') payload.name = req.body.name;
  if (typeof req.body.email === 'string') payload.email = req.body.email.trim().toLowerCase();
  if (typeof req.body.role === 'string' && ['admin','superadmin'].includes(req.body.role)) payload.role = req.body.role;
  if (typeof req.body.communeId === 'string') payload.communeId = req.body.communeId;
  if (typeof req.body.communeName === 'string') payload.communeName = req.body.communeName;
  if (typeof req.body.photo === 'string') payload.photo = req.body.photo;

  // email unique
  if (payload.email && payload.email !== target.email) {
    const dupe = await Admin.findOne({ email: payload.email, _id: { $ne: id } }).lean();
    if (dupe) return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
  }

  await Admin.updateOne({ _id: id }, { $set: payload });
  res.json({ message: 'Admin mis à jour.' });
});

// CHANGER le mot de passe d’un admin (par superadmin)
router.post('/:id/reset-password', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });
  if (typeof newPassword !== 'string' || newPassword.trim().length < 8) {
    return res.status(400).json({ message: 'Nouveau mot de passe invalide (min 8 caractères).' });
  }

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Utilisez /api/change-password pour votre propre compte.' });

  const doc = await Admin.findById(id).select('+password role');
  if (!doc) return res.status(404).json({ message: 'Admin introuvable.' });
  if (doc.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  const salt = await bcrypt.genSalt(10);
  doc.password = await bcrypt.hash(newPassword, salt);
  await doc.save();

  // Optionnel: invalider les sessions (si tu utilises tokenVersion sur Admin aussi)
  // doc.tokenVersion = (doc.tokenVersion || 0) + 1;

  res.json({ message: 'Mot de passe réinitialisé.' });
});

// DÉSACTIVER / RÉACTIVER (soft-delete)
router.post('/:id/toggle-active', auth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { active } = req.body || {};
  if (!isObjectId(id)) return res.status(400).json({ message: 'ID invalide.' });

  const meId = String(req.user.id);
  if (meId === id) return res.status(400).json({ message: 'Impossible de désactiver votre propre compte.' });

  const doc = await Admin.findById(id).select('role isActive');
  if (!doc) return res.status(404).json({ message: 'Admin introuvable.' });
  if (doc.role === 'superadmin') return res.status(403).json({ message: 'Action interdite sur un superadmin.' });

  const next = !!active;
  // Ajoute le champ sur le schéma Admin si absent: isActive:Boolean (default true)
  doc.isActive = next;
  // Invalider les tokens en cours si tu gères tokenVersion
  // doc.tokenVersion = (doc.tokenVersion || 0) + 1;
  await doc.save();

  res.json({ message: next ? 'Compte réactivé.' : 'Compte désactivé.' });
});

// SUPPRIMER (hard delete)
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

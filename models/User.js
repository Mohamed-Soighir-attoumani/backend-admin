// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Identité
    name: { type: String, default: '' },
    email: { type: String, required: true, unique: true, index: true },

    // Auth
    password: { type: String, required: true, select: false }, // hash bcrypt
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin', index: true },

    // Rattachement "tenant" (commune)
    communeId: { type: String, default: '', index: true },     // ex: ID interne ou code INSEE
    communeName: { type: String, default: '' },

    // UI
    photo: { type: String, default: '' }, // URL publique vers /uploads/avatars/...
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

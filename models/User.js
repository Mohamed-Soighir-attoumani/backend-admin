const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin', index: true },

    // Multi-communes
    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    // UI
    photo: { type: String, default: '' },

    // Super-pouvoirs
    isActive: { type: Boolean, default: true, index: true }, // si false → refus d’accès
    tokenVersion: { type: Number, default: 0 }, // pour invalider tous les jetons
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

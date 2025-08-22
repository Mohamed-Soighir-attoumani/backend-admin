// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false }, // aligné sur Admin
    role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user', index: true },

    // Multi-communes
    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    // UI
    photo: { type: String, default: '' },

    // Super-pouvoirs
    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// (optionnel) cacher password si jamais sélectionné par erreur
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);

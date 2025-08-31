// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: {
      type: String, required: true, unique: true, index: true, lowercase: true, trim: true,
    },

    // Auth
    passwordHash: { type: String, select: false },
    password: { type: String, select: false }, // compat

    // Rôle
    role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user', index: true },

    // Multi-communes
    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    // UI
    photo: { type: String, default: '' },

    // Statut
    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },

    // Abonnement
    subscriptionStatus: { type: String, enum: ['none', 'active', 'expired'], default: 'none', index: true },
    subscriptionEndAt: { type: Date, default: null, index: true },

    // Traçabilité
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.passwordHash;
    ret._idString = String(ret._id);
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);

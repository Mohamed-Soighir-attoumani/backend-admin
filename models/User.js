// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    // Le mot de passe chiffré est stocké ici
    password: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ['user', 'admin', 'superadmin'],
      default: 'user',
      index: true,
    },

    // Multi-communes
    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    // UI
    photo: { type: String, default: '' },

    // Super-pouvoirs
    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },

    // 🔔 Abonnement
    subscriptionStatus: {
      type: String,
      enum: ['none', 'active', 'expired'],
      default: 'none',
      index: true,
    },
    subscriptionEndAt: { type: Date, default: null },

    // Traçabilité (facultatif)
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

// (sécu) ne jamais exposer 'password'
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);

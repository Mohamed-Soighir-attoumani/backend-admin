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
    password: { type: String, required: true, select: false }, // hash
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

    // Abonnement
    subscriptionStatus: {
      type: String,
      enum: ['none', 'active', 'expired'],
      default: 'none',
      index: true,
    },
    subscriptionEndAt: { type: Date, default: null },

    // 💳 Montant/Devise/Mode stockés par le superadmin
    subscriptionPrice: { type: Number, default: 0 },       // ex: 29.9
    subscriptionCurrency: { type: String, default: 'EUR' },// ex: 'EUR'
    subscriptionMethod: { type: String, default: '' },     // ex: 'card'|'cash'|'transfer'

    // Audit
    createdBy: { type: String, default: '' },

    // Super-pouvoirs
    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ne jamais renvoyer le hash
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);

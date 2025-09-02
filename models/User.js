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

    // Abonnement (déjà partiellement présent → on complète)
    subscriptionStatus: {
      type: String,
      enum: ['none', 'active', 'expired'],
      default: 'none',
      index: true,
    },
    subscriptionStartAt: { type: Date, default: null },
    subscriptionEndAt: { type: Date, default: null },
    subscriptionPrice: { type: Number, default: 0 },           // montant TTC (€/autre)
    subscriptionCurrency: { type: String, default: 'EUR' },     // 'EUR', 'KMF', etc.
    subscriptionMethod: { type: String, default: '' },          // 'card' | 'cash' | 'transfer' ...

    // Infos de facturation (facultatives, utilisées sur la facture)
    billingName: { type: String, default: '' },                 // ex. mairie/association/nom complet
    billingEmail: { type: String, default: '' },
    billingPhone: { type: String, default: '' },
    billingAddress: { type: String, default: '' },
    billingCity: { type: String, default: '' },
    billingZip: { type: String, default: '' },
    billingCountry: { type: String, default: '' },
    vatNumber: { type: String, default: '' },                 
    invoiceNotes: { type: String, default: '' },               

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

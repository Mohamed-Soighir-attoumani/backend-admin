// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    /* Identité */
    name: { type: String, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    /* Auth */
    // On stocke le hash ici (compat login). Ne jamais renvoyer au client.
    passwordHash: { type: String, select: false },
    // Ancien champ éventuel : on le garde optionnel pour compat, jamais renvoyé
    password: { type: String, select: false },

    /* Rôle */
    role: {
      type: String,
      enum: ['user', 'admin', 'superadmin'],
      default: 'user',
      index: true,
    },

    /* Multi-communes */
    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    /* UI */
    photo: { type: String, default: '' },

    /* Statut compte */
    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },

    /* Abonnement (utilisé par /subscriptions et /invoices) */
    subscriptionStatus: {
      type: String,
      enum: ['none', 'active', 'expired'],
      default: 'none',
      index: true,
    },
    subscriptionEndAt: { type: Date, default: null, index: true },

    /* Traçabilité (facultatif) */
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

/* JSON safe */
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    // ne jamais exposer ces champs
    delete ret.password;
    delete ret.passwordHash;
    // Ajout d’un identifiant standardisé (utile au front)
    ret._idString = String(ret._id);
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);

// backend/models/Admin.js
const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },

    // on garde l'email "original" pour l'affichage
    email: { type: String, required: true, trim: true },

    // email normalisé pour l'unicité (toujours minuscule + trim)
    emailLower: { type: String, required: true, index: true },

    password: { type: String, required: true, select: false },

    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin', index: true },

    // multi-communes
    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    // UI
    photo: { type: String, default: '' },

    // statut & sécurité
    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Unicité sur (emailLower, communeId)
AdminSchema.index({ emailLower: 1, communeId: 1 }, { unique: true, name: 'uniq_email_commune' });

// Normalisation avant save
AdminSchema.pre('validate', function (next) {
  if (typeof this.email === 'string') {
    this.email = this.email.trim();
    this.emailLower = this.email.toLowerCase();
  }
  if (typeof this.communeId !== 'string') {
    this.communeId = '';
  }
  next();
});

// sécurité JSON
AdminSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('Admin', AdminSchema);

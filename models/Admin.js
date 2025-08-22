// backend/models/Admin.js
const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false }, // caché par défaut
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin', index: true },

    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    photo: { type: String, default: '' },
  },
  { timestamps: true }
);

// (optionnel) cacher password si jamais sélectionné par erreur
adminSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('Admin', adminSchema);

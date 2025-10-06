// backend/models/Info.js
const mongoose = require('mongoose');

const infoSchema = new mongoose.Schema(
  {
    // Contenu
    title:     { type: String, required: true, trim: true },
    content:   { type: String, required: true, trim: true },
    imageUrl:  { type: String, default: null },

    // Catégorie
    category:  { type: String, enum: ['sante', 'proprete', 'autres'], default: 'sante', index: true },

    // Portée multi-commune (même logique que notifications)
    visibility:       { type: String, enum: ['local', 'global', 'custom'], default: 'local', index: true },
    communeId:        { type: String, default: '', index: true },          // si local
    audienceCommunes: { type: [String], default: [], index: true },        // si custom

    // Fenêtre d’affichage (optionnelle)
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt:  { type: Date, default: null, index: true },
    endAt:    { type: Date, default: null, index: true },

    // Métadonnées simples (facultatives)
    location: {
      name:    { type: String, default: '' },
      address: { type: String, default: '' },
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
    },

    // Traçabilité
    authorId:    { type: String, default: '' },
    authorEmail: { type: String, default: '' },

    // Lecture
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

infoSchema.index({ visibility: 1, communeId: 1 });
infoSchema.index({ visibility: 1, audienceCommunes: 1 });
infoSchema.index({ createdAt: -1 });

/** Normalisation pour éviter les mismatches de casse entre panel/app */
infoSchema.pre('validate', function (next) {
  if (typeof this.communeId === 'string') {
    this.communeId = this.communeId.trim().toLowerCase();
  }
  if (Array.isArray(this.audienceCommunes)) {
    const normed = this.audienceCommunes
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean);
    this.audienceCommunes = Array.from(new Set(normed));
  }
  next();
});

module.exports = mongoose.model('Info', infoSchema);

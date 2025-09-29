// backend/models/Article.js
const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema(
  {
    title:     { type: String, required: true, trim: true },
    content:   { type: String, required: true, trim: true },
    imageUrl:  { type: String, default: null },

    // Portée multi-commune (aligné sur notifications/projets)
    visibility: {
      type: String,
      enum: ['local', 'global', 'custom'],
      default: 'local',
      index: true,
    },
    communeId:        { type: String, default: '', index: true },   // si local
    audienceCommunes: { type: [String], default: [], index: true }, // si custom

    // Options d’affichage
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt:  { type: Date, default: null, index: true },
    endAt:    { type: Date, default: null, index: true },

    // Traçabilité auteur (panel)
    authorId:    { type: String, default: '' },
    authorEmail: { type: String, default: '' },

    // 🔹 Métadonnées requises par Google Play pour la section "Annonces"
    publishedAt: { type: Date, default: Date.now, index: true }, // date de publication
    authorName:  { type: String, default: '' },                  // nom affiché (facultatif)
    publisher:   { type: String, default: 'Association Bellevue Dembeni' }, // éditeur affiché
    sourceUrl:   { type: String, default: '' },                  // lien vers source officielle si reprise
    status:      { type: String, enum: ['draft','published'], default: 'published', index: true }, // statut éditorial
  },
  { timestamps: true }
);

// Index utiles
articleSchema.index({ visibility: 1, communeId: 1 });
articleSchema.index({ visibility: 1, audienceCommunes: 1 });
articleSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Article', articleSchema);

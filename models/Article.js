// backend/models/Article.js
const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema(
  {
    // Contenu
    title:     { type: String, required: true, trim: true },
    content:   { type: String, required: true, trim: true },
    imageUrl:  { type: String, default: null },

    // Catégorie
    category:  { type: String, enum: ['annonce', 'actualite', 'evenement', 'autres'], default: 'annonce', index: true },

    // Portée multi-commune
    visibility:       { type: String, enum: ['local', 'global', 'custom'], default: 'local', index: true },
    communeId:        { type: String, default: '', index: true },          // si local (slug de préférence)
    audienceCommunes: { type: [String], default: [], index: true },        // si custom (slugs)

    // Fenêtre d’affichage (optionnelle)
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt:  { type: Date, default: null, index: true },
    endAt:    { type: Date, default: null, index: true },

    // Métadonnées de publication (utilisées dans les routes /public)
    status:      { type: String, enum: ['draft', 'published'], default: 'published', index: true },
    publishedAt: { type: Date, default: Date.now, index: true },
    authorName:  { type: String, default: '' },
    publisher:   { type: String, default: 'Association Bellevue Dembeni' },
    sourceUrl:   { type: String, default: '' },

    // Auteur technique (compte)
    authorId:    { type: String, default: '', index: true },
    authorEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

articleSchema.index({ visibility: 1, communeId: 1 });
articleSchema.index({ visibility: 1, audienceCommunes: 1 });
articleSchema.index({ createdAt: -1 });

/** Normalisation avant save */
articleSchema.pre('validate', function (next) {
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

module.exports = mongoose.model('Article', articleSchema);

// backend/models/Article.js
const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema(
  {
    title:     { type: String, required: true, trim: true },
    content:   { type: String, required: true, trim: true },
    imageUrl:  { type: String, default: null },

    // Multi-commune
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

    // Traçabilité panel
    authorId:    { type: String, default: '' },
    authorEmail: { type: String, default: '' },

    // Métadonnées Play
    publishedAt: { type: Date, default: Date.now, index: true },
    authorName:  { type: String, default: '' },
    publisher:   { type: String, default: 'Association Bellevue Dembeni' },
    sourceUrl:   { type: String, default: '' },
    status:      { type: String, enum: ['draft','published'], default: 'published', index: true },

    imagePublicId: { type: String, default: null },
  },
  { timestamps: true }
);

articleSchema.index({ visibility: 1, communeId: 1 });
articleSchema.index({ visibility: 1, audienceCommunes: 1 });
articleSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Article', articleSchema);

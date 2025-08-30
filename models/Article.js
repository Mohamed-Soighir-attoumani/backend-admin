// backend/models/Article.js
const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    imageUrl: { type: String, default: null }, // Cloudinary

    // Portée multi-commune
    visibility: { type: String, enum: ['local', 'global', 'custom'], default: 'local', index: true },
    communeId: { type: String, default: '', index: true },
    audienceCommunes: { type: [String], default: [], index: true },

    // Options d’affichage
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt: { type: Date, default: null, index: true },
    endAt: { type: Date, default: null, index: true },

    // Traçabilité
    authorId: { type: String, default: '' },
    authorEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

articleSchema.index({ visibility: 1, communeId: 1 });
articleSchema.index({ visibility: 1, audienceCommunes: 1 });
articleSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Article', articleSchema);

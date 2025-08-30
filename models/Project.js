// backend/models/Project.js
const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: '' },

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

projectSchema.index({ visibility: 1, communeId: 1 });
projectSchema.index({ visibility: 1, audienceCommunes: 1 });
projectSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Project', projectSchema);

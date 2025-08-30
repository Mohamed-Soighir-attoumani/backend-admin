// backend/models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false },

    // Portée multi-commune (ajout)
    visibility: { type: String, enum: ['local', 'global', 'custom'], default: 'local', index: true },
    communeId: { type: String, default: '', index: true },            // si local
    audienceCommunes: { type: [String], default: [], index: true },   // si custom

    // Options d’affichage (facultatif)
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt: { type: Date, default: null, index: true },
    endAt: { type: Date, default: null, index: true },

    // Traçabilité
    authorId: { type: String, default: '' },
    authorEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

// Index utiles
notificationSchema.index({ visibility: 1, communeId: 1 });
notificationSchema.index({ visibility: 1, audienceCommunes: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

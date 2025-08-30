// backend/models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title:   { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead:  { type: Boolean, default: false },

    // Multi-commune
    visibility:       { type: String, enum: ['local', 'global', 'custom'], default: 'local', index: true },
    communeId:        { type: String, default: '', index: true },
    audienceCommunes: { type: [String], default: [], index: true },

    // Options
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt:  { type: Date, default: null, index: true },
    endAt:    { type: Date, default: null, index: true },

    // Auteur
    authorId:    { type: String, default: '', index: true },
    authorEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

notificationSchema.index({ visibility: 1, communeId: 1 });
notificationSchema.index({ visibility: 1, audienceCommunes: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

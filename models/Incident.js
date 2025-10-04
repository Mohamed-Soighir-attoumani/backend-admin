// backend/models/Incident.js
const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  lieu: { type: String, required: true },

  mediaUrl: { type: String, default: null },
  mediaType: { type: String, enum: ['image', 'video'], default: 'image' },

  status: {
    type: String,
    enum: ['En attente', 'En cours', 'Résolu', 'Rejeté'],
    default: 'En attente'
  },

  adminComment: { type: String, default: '' },

  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  adresse: { type: String, default: '' },

  deviceId: { type: String, required: true, index: true },
  userId: { type: String, default: null },

  // 🔑 multi-commune (slug canonique conseillé)
  communeId: { type: String, index: true },

  // 🔁 flag de notification côté app
  updated: { type: Boolean, default: false, index: true },

  messages: [
    {
      text: String,
      date: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

// Indexes utiles
incidentSchema.index({ deviceId: 1, createdAt: -1 });
incidentSchema.index({ communeId: 1, createdAt: -1 });

module.exports = mongoose.model('Incident', incidentSchema);

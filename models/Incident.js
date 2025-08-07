const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  lieu: {
    type: String,
    required: true
  },
  mediaUrl: {
    type: String,
    default: null
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image'
  },
  status: {
    type: String,
    enum: ['En attente', 'En cours', 'Résolu', 'Rejeté'],
    default: 'En attente'
  },
  adminComment: {
    type: String,
    default: ''
  },
  latitude: { 
    type: Number, 
    required: true 
  }, 
  longitude: { 
    type: Number, 
    required: true 
  },
  adresse: {
    type: String,
    default: ''
  },
  deviceId: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    default: null
  },
  messages: [
    {
      text: String,
      date: { type: Date, default: Date.now }
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('Incident', incidentSchema);

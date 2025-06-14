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
  photoUri: {
    type: String,
    default: null
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

  userId: {
    type: String,
    default: null // utile si tu veux lier l'incident à un utilisateur plus tard
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

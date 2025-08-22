// backend/models/Device.js
const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  installationId: { type: String, required: true, unique: true, index: true }, // ID d'installation (UUID)
  platform: { type: String, enum: ['ios','android','web'], index: true },
  brand: { type: String, default: '', index: true },
  model: { type: String, default: '', index: true },
  osVersion: { type: String, default: '' },
  appVersion: { type: String, default: '' },
  pushToken: { type: String, default: '' },

  // Lien optionnel vers utilisateur / commune si utile
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  communeId: { type: String, default: '', index: true },
  communeName: { type: String, default: '' },

  firstSeenAt: { type: Date, default: Date.now, index: true },
  lastSeenAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);

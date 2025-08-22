const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  installationId: { type: String, required: true, unique: true, index: true },
  platform: { type: String, default: '' },
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  osVersion: { type: String, default: '' },
  appVersion: { type: String, default: '' },
  pushToken: { type: String, default: '' },

  communeId: { type: String, default: '', index: true },
  communeName: { type: String, default: '' },

  userId: { type: String, default: '' },

  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);

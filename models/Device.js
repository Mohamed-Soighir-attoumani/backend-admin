// backend/models/Device.js
const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  installationId: { type: String, required: true, index: true, unique: true },

  // legacy facultatifs
  deviceId:    { type: String },
  platform:    { type: String, default: '' }, // android | ios | web ou legacy
  brand:       { type: String, default: '' },
  model:       { type: String, default: '' },
  osVersion:   { type: String, default: '' },
  appVersion:  { type: String, default: '' },
  pushToken:   { type: String, default: '' },

  firstSeenAt: { type: Date },
  lastSeenAt:  { type: Date },

  // filtres
  communeId:   { type: String, default: '' },
  communeName: { type: String, default: '' },

  // lien user éventuel
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true, // createdAt / updatedAt auto
});

module.exports = mongoose.model('Device', deviceSchema);
